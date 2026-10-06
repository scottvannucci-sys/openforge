"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Viewport from "@/components/Viewport";
import SettingsModal from "@/components/SettingsModal";
import BuildLog, { type LogLine } from "@/components/BuildLog";
import ModelPanel from "@/components/ModelPanel";
import { PROVIDERS, type AppSettings, type GenerationMeta, type GenerationSummary, type StreamEvent, type ProviderId } from "@/lib/types";

interface ModelOption {
  id: string;
  label: string;
}

const EXAMPLES = [
  "Hexagonal desk organizer with three compartments, 120 mm wide",
  "A phone stand with a 60° lean and a cable notch",
  "Parametric spur gear, 14 teeth, 8 mm bore",
  "Small vase with twisted fluted walls, 100 mm tall",
  "Wall hook that holds 3 kg, with two 4 mm screw holes",
];

export default function StudioPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState<{
    openscad: { found: boolean; path: string };
    codex: { installed: boolean; version: string; loggedIn: boolean };
    ollama: { reachable: boolean };
    bambu?: { found: boolean; path: string; profilesReady: boolean };
  } | null>(null);

  const [provider, setProvider] = useState<ProviderId>("demo");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState("");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; base64: string; mime: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [working, setWorking] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const [current, setCurrent] = useState<{ meta: GenerationMeta; scad: string } | null>(null);
  const [stlUrl, setStlUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<GenerationSummary[]>([]);
  const [refineMode, setRefineMode] = useState(false);

  const [infill, setInfill] = useState(15);
  const [material, setMaterial] = useState("PLA");

  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [showPlate, setShowPlate] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [screenshotSignal, setScreenshotSignal] = useState(0);

  const log = useCallback((level: LogLine["level"], message: string) => {
    setLines((prev) => [...prev.slice(-250), { level, message, t: Date.now() }]);
  }, []);

  // --- boot ---
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: AppSettings) => {
        setSettings(s);
        setProvider(s.activeProvider);
      })
      .catch(() => undefined);
    refreshHealth();
  }, []);

  const refreshHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  const refreshHistory = useCallback(() => {
    fetch("/api/generations")
      .then((r) => r.json())
      .then((d: { generations: GenerationSummary[] }) => setHistory(d.generations ?? []))
      .catch(() => undefined);
  }, []);
  useEffect(refreshHistory, [refreshHistory]);

  // --- models for provider ---
  const [modelsReady, setModelsReady] = useState(false);
  useEffect(() => {
    if (!provider) return;
    setModelsReady(false);
    setModels([]);
    setModelsError("");
    setCustomModel(false);
    let stale = false;
    fetch(`/api/models?provider=${provider}`)
      .then((r) => r.json())
      .then((d: { models: ModelOption[]; error?: string; custom?: boolean }) => {
        if (stale) return;
        setModels(d.models ?? []);
        if (d.error) setModelsError(d.error);
        if (d.custom) setCustomModel(false);
        // keep a saved selection even if it's not in the list; only default when empty
        const saved =
          provider === "ollama"
            ? settings?.providers.ollama.model
            : provider === "openai"
              ? settings?.providers.openai.model
              : provider === "codex"
                ? settings?.providers.codex.model
                : "sample-templates";
        const first = d.models?.[0]?.id ?? "";
        setModel(saved || first);
        setModelsReady(true);
      })
      .catch(() => {
        if (!stale) setModelsError("Could not list models");
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // persist provider/model choice — only once this provider's list has loaded,
  // so boot races and failed listings can't wipe saved selections
  useEffect(() => {
    if (!settings || !modelsReady) return;
    const patch: Partial<AppSettings> = { activeProvider: provider };
    if (provider === "ollama") patch.providers = { ...settings.providers, ollama: { ...settings.providers.ollama, model } };
    if (provider === "openai") patch.providers = { ...settings.providers, openai: { ...settings.providers.openai, model } };
    if (provider === "codex") patch.providers = { ...settings.providers, codex: { ...settings.providers.codex, model } };
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, model, modelsReady]);

  // --- image input: file picker, drag-drop, clipboard paste ---
  const acceptImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setImage({
        dataUrl,
        base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        mime: file.type,
      });
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) acceptImageFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [acceptImageFile]);

  // --- generate ---
  const generate = async () => {
    if (working) return;
    setWorking(true);
    setLines([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider,
          model,
          imageBase64: image?.base64,
          imageMime: image?.mime,
          refineScad: refineMode ? current?.scad : undefined,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "log") log(event.level, event.message);
          else if (event.type === "result") {
            setCurrent({ meta: event.generation, scad: event.scad });
            setStlUrl(`/api/generations/${event.generation.id}/stl`);
            setMaterial(event.generation.material || "PLA");
            setRefineMode(true);
            refreshHistory();
            refreshHealth();
          } else if (event.type === "error") {
            log("error", event.message);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") log("warn", "Cancelled by user.");
      else log("error", (e as Error).message);
    } finally {
      setWorking(false);
      abortRef.current = null;
    }
  };

  const providerStatus = (id: ProviderId): boolean => {
    if (!health) return id === "demo";
    if (id === "demo") return true;
    if (id === "ollama") return health.ollama.reachable;
    if (id === "codex") return health.codex.installed;
    if (id === "openai") return Boolean(settings?.providers.openai.baseUrl);
    return false;
  };

  const overlayBtn = (active: boolean) =>
    `rounded-lg border px-2 py-1.5 text-xs transition-colors ${
      active
        ? "border-accent-500/70 bg-accent-500/15 text-accent-300"
        : "border-ink-600 bg-ink-850/80 text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-400 to-ember-500 text-lg shadow-glow">
            ⬢
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide text-white">
              Open<span className="text-accent-300">Forge</span>
            </h1>
            <p className="text-[10px] text-zinc-500">prompt → OpenSCAD → print · tuned for the Bambu P1S</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`chip ${
              health?.openscad.found
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/40 bg-red-500/10 text-red-300"
            }`}
            title={health?.openscad.path || "OpenSCAD not detected"}
          >
            OpenSCAD {health?.openscad.found ? "ready" : "missing"}
          </span>
          <span className="chip border-ink-600 bg-ink-800/60 text-zinc-400">
            {PROVIDERS.find((p) => p.id === provider)?.label}
            {model ? ` · ${model || "default"}` : ""}
          </span>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[360px_minmax(0,1fr)_330px] xl:overflow-hidden">
        {/* Left: input */}
        <aside
          className={`panel flex min-h-0 flex-col gap-4 p-4 xl:overflow-y-auto ${
            dragOver ? "ring-2 ring-accent-500/60" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) acceptImageFile(file);
          }}
        >
          {/* provider pills */}
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                title={p.blurb}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  provider === p.id
                    ? "border-accent-500/70 bg-accent-500/10"
                    : "border-ink-700 bg-ink-900/40 hover:border-ink-600"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${providerStatus(p.id) ? "bg-emerald-400" : "bg-zinc-600"}`}
                  />
                  <span className={`text-xs font-medium ${provider === p.id ? "text-accent-200" : "text-zinc-300"}`}>
                    {p.label}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="-mt-2 text-[11px] leading-relaxed text-zinc-500">
            {PROVIDERS.find((p) => p.id === provider)?.blurb}
          </p>

          {/* model selector */}
          <div className="flex gap-2">
            {customModel ? (
              <input
                className="field font-mono text-xs"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id"
              />
            ) : (
              <select
                className="field text-xs"
                value={model}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomModel(true);
                    setModel("");
                  } else {
                    setModel(e.target.value);
                  }
                }}
                disabled={!models.length}
              >
                {models.length === 0 && <option value="">no models found</option>}
                {models
                  .filter((m) => m.id !== "__custom__")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                <option value="__custom__">Custom…</option>
              </select>
            )}
            <button
              className="btn-ghost shrink-0 px-2.5 text-xs"
              title="Refresh model list"
              onClick={() => {
                fetch(`/api/models?provider=${provider}`)
                  .then((r) => r.json())
                  .then((d) => setModels(d.models ?? []))
                  .catch(() => undefined);
              }}
            >
              ⟳
            </button>
            <button
              className="btn-ghost shrink-0 px-2.5 text-xs"
              title="Type a custom model id"
              onClick={() => setCustomModel((c) => !c)}
            >
              {customModel ? "☰" : "✎"}
            </button>
          </div>
          {modelsError && <p className="-mt-2 text-[11px] text-amber-400">{modelsError}</p>}

          {/* prompt */}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <textarea
              className="field min-h-[110px] flex-1 resize-none leading-relaxed"
              placeholder={
                refineMode && current
                  ? `Describe how to change "${current.meta.name}"…`
                  : "Describe the part to forge… e.g. “cylindrical planter, 90 mm tall, with a drainage tray”"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
              }}
            />

            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  className="rounded-full border border-ink-700 px-2.5 py-1 text-[10px] text-zinc-500 transition-colors hover:border-accent-500/50 hover:text-accent-300"
                  onClick={() => setPrompt(ex)}
                >
                  {ex.split(",")[0]}
                </button>
              ))}
            </div>

            {/* image attach */}
            <div className="flex items-center gap-2">
              <label className="btn-ghost cursor-pointer text-xs">
                🖼 Attach image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) acceptImageFile(f);
                  }}
                />
              </label>
              {image && (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.dataUrl} alt="reference" className="h-10 w-14 rounded-lg border border-ink-600 object-cover" />
                  <button
                    className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border border-ink-600 bg-ink-800 text-[9px] text-zinc-400 hover:text-red-400"
                    onClick={() => setImage(null)}
                  >
                    ✕
                  </button>
                </div>
              )}
              <span className="text-[10px] text-zinc-600">drop or paste screenshots too</span>
            </div>

            {/* generate / stop */}
            <div className="flex gap-2">
              {working ? (
                <button className="btn-primary flex-1" onClick={() => abortRef.current?.abort()}>
                  ■ Stop
                </button>
              ) : (
                <button
                  className="btn-primary flex-1 py-2.5 text-sm font-semibold"
                  onClick={generate}
                  disabled={!prompt.trim() && !image && !(refineMode && current)}
                >
                  {refineMode && current ? "⚒ Refine model" : "⚒ Forge model"}
                </button>
              )}
            </div>

            {current && (
              <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2">
                <label className="flex items-center gap-2 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={refineMode}
                    onChange={(e) => setRefineMode(e.target.checked)}
                    className="accent-accent-500"
                  />
                  Refine current: <span className="font-medium text-zinc-100">{current.meta.name}</span>
                </label>
                <button
                  className="text-[11px] text-zinc-500 hover:text-zinc-300"
                  onClick={() => {
                    setRefineMode(false);
                    setCurrent(null);
                    setStlUrl(null);
                  }}
                >
                  clear
                </button>
              </div>
            )}
          </div>

          <BuildLog lines={lines} working={working} />
        </aside>

        {/* Center: viewport */}
        <section className="relative min-h-[430px] xl:min-h-0">
          <Viewport
            stlUrl={stlUrl}
            wireframe={wireframe}
            edges={showEdges}
            autoRotate={autoRotate}
            showPlate={showPlate}
            resetSignal={resetSignal}
            screenshotSignal={screenshotSignal}
          />
          <div className="absolute right-3 top-3 flex gap-1.5">
            <button className={overlayBtn(autoRotate)} title="Turntable" onClick={() => setAutoRotate((v) => !v)}>
              ⏱
            </button>
            <button className={overlayBtn(wireframe)} title="Wireframe" onClick={() => setWireframe((v) => !v)}>
              ⬡
            </button>
            <button className={overlayBtn(showEdges)} title="CAD edges" onClick={() => setShowEdges((v) => !v)}>
              ◫
            </button>
            <button className={overlayBtn(showPlate)} title="Build plate" onClick={() => setShowPlate((v) => !v)}>
              ▦
            </button>
            <button className={overlayBtn(false)} title="Reset view" onClick={() => setResetSignal((n) => n + 1)}>
              ⟳
            </button>
            <button
              className={overlayBtn(false)}
              title="Save screenshot"
              onClick={() => setScreenshotSignal((n) => n + 1)}
            >
              📷
            </button>
          </div>
          {current && (
            <div className="absolute left-3 top-3 rounded-lg border border-ink-600 bg-ink-850/85 px-2.5 py-1.5 text-[11px] text-zinc-300 backdrop-blur">
              <span className="font-medium text-white">{current.meta.name}</span>
              <span className="mx-1.5 text-zinc-600">·</span>
              {current.meta.stats.dims.x.toFixed(0)}×{current.meta.stats.dims.y.toFixed(0)}×
              {current.meta.stats.dims.z.toFixed(0)} mm
              <span className="mx-1.5 text-zinc-600">·</span>
              {current.meta.stats.triangles.toLocaleString()} tris
            </div>
          )}
        </section>

        {/* Right: model panel */}
        <aside className="panel min-h-0 p-4 xl:overflow-visible">
          <ModelPanel
            gen={current}
            infill={infill}
            setInfill={setInfill}
            material={material}
            setMaterial={setMaterial}
            history={history}
            bambuReady={Boolean(health?.bambu?.found && health.bambu.profilesReady)}
            onSliceLog={(msg) => {
              setLines((prev) => [...prev, { level: "info" as const, message: `[slicer] ${msg}`, t: Date.now() }]);
            }}
            onSelectHistory={(g) => {
              setStlUrl(`/api/generations/${g.id}/stl`);
              setRefineMode(false);
              // load the scad too, so refining a reloaded model keeps its base code
              fetch(`/api/generations/${g.id}/scad`)
                .then((r) => (r.ok ? r.text() : ""))
                .then((scad) => setCurrent({ meta: g, scad }))
                .catch(() => setCurrent({ meta: g, scad: "" }));
            }}
            onDeleteHistory={async (id) => {
              await fetch(`/api/generations?id=${id}`, { method: "DELETE" });
              if (current?.meta.id === id) {
                setCurrent(null);
                setStlUrl(null);
              }
              refreshHistory();
            }}
          />
        </aside>
      </main>

      {settingsOpen && settings && (
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onSaved={(s) => {
            setSettings(s);
            refreshHealth();
          }}
        />
      )}
    </div>
  );
}
