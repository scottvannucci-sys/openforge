"use client";

import { useEffect, useState } from "react";
import type { AppSettings, ProviderId } from "@/lib/types";

interface Health {
  openscad: { found: boolean; path: string };
  codex: { installed: boolean; version: string; loggedIn: boolean; configuredModel?: string };
  ollama: { reachable: boolean };
}

export default function SettingsModal({
  open,
  onClose,
  settings,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaved: (s: AppSettings) => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [health, setHealth] = useState<Health | null>(null);
  const [saving, setSaving] = useState(false);
  const [loginMsg, setLoginMsg] = useState("");
  const [deviceCode, setDeviceCode] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setLoginMsg("");
      fetch("/api/health")
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => undefined);
    }
  }, [open, settings]);

  // Esc closes the modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const saved = (await res.json()) as AppSettings;
      onSaved(saved);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const codexLogin = async () => {
    setLoginMsg("Requesting a device code…");
    setDeviceCode(null);
    try {
      const res = await fetch("/api/codex-login", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message: string; deviceUrl?: string; deviceCode?: string };
      if (data.ok && data.deviceUrl && data.deviceCode) {
        setDeviceCode(data.deviceCode);
        setLoginMsg("Browser opened — enter the code below, then approve access. This dialog updates automatically.");
        window.open(data.deviceUrl, "_blank", "noopener");
        const startedAt = Date.now();
        // poll the auth file mtime — `codex login status` reports stale revoked
        // tokens as "logged in", so it can't be trusted for completion detection
        const deadline = Date.now() + 15 * 60_000;
        const poll = () => {
          if (Date.now() > deadline) {
            setLoginMsg("Still waiting for sign-in — codes expire after 15 min; request a new one if needed.");
            return;
          }
          fetch("/api/codex-login")
            .then((r) => r.json())
            .then((s) => {
              if (s?.authMtime > startedAt) {
                setLoginMsg("Signed in to ChatGPT ✓");
              } else if (s?.loginFinished) {
                setLoginMsg("The sign-in process exited without completing — request a new code and make sure to approve access.");
              } else {
                setTimeout(poll, 3000);
              }
            })
            .catch(() => setTimeout(poll, 3000));
        };
        setTimeout(poll, 5000);
      } else {
        setLoginMsg(data.message || "Could not start login.");
      }
    } catch (e) {
      setLoginMsg(`Login failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="panel max-h-[88vh] w-full max-w-2xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={onClose}>
            Esc
          </button>
        </div>

        {/* OpenSCAD */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-100">OpenSCAD engine</h3>
          <p className="mb-2 text-xs text-zinc-500">
            The geometry compiler. Auto-detected on save; a portable copy can live in
            <code className="mx-1 rounded bg-ink-800 px-1 py-0.5 text-[10px]">tools/OpenSCAD</code>.{" "}
            <a className="text-accent-300 hover:underline" href="https://openscad.org/downloads.html" target="_blank">
              Download ↗
            </a>
          </p>
          <div className="flex gap-2">
            <input
              className="field font-mono text-xs"
              value={draft.openscadPath}
              onChange={(e) => setDraft({ ...draft, openscadPath: e.target.value })}
              placeholder="C:\Program Files\OpenSCAD\openscad.exe"
            />
            <button
              className="btn-ghost shrink-0 text-xs"
              onClick={() => setDraft({ ...draft, openscadPath: health?.openscad.path || draft.openscadPath })}
            >
              Detect
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <StatusDot ok={health ? health.openscad.found : false} />
            <span className="text-zinc-400">
              {health ? (health.openscad.found ? "found" : "not found") : "checking…"}
            </span>
            <label className="ml-auto flex items-center gap-2 text-zinc-500">
              timeout
              <input
                type="number"
                min={10}
                max={600}
                className="field w-20 py-1 text-xs"
                value={draft.openscadTimeoutSec}
                onChange={(e) => setDraft({ ...draft, openscadTimeoutSec: Number(e.target.value) })}
              />
              s
            </label>
          </div>
        </section>

        {/* Demo */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-100">Demo provider</h3>
          <p className="text-xs text-zinc-500">
            Built-in sample templates (phone stand, gear, vase, calibration cube). Zero setup —
            great for verifying the pipeline and the P1S export path.
          </p>
        </section>

        {/* Ollama */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-100">Ollama (local)</h3>
          <div className="flex items-center gap-3">
            <input
              className="field font-mono text-xs"
              value={draft.providers.ollama.baseUrl}
              onChange={(e) =>
                setDraft({ ...draft, providers: { ...draft.providers, ollama: { ...draft.providers.ollama, baseUrl: e.target.value } } })
              }
              placeholder="http://localhost:11434"
            />
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <StatusDot ok={health ? health.ollama.reachable : false} />
              <span className="text-zinc-500">{health ? (health.ollama.reachable ? "running" : "not running") : "…"}</span>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-zinc-600">
            Install from ollama.com, then <code className="rounded bg-ink-800 px-1">ollama pull qwen2.5-coder:7b</code> (or any model). Vision models (e.g. <code className="rounded bg-ink-800 px-1">qwen2.5vl</code>) enable image input.
          </p>
        </section>

        {/* OpenAI-compatible */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-100">OpenAI-compatible endpoint</h3>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <input
              className="field font-mono text-xs"
              value={draft.providers.openai.baseUrl}
              onChange={(e) =>
                setDraft({ ...draft, providers: { ...draft.providers, openai: { ...draft.providers.openai, baseUrl: e.target.value } } })
              }
              placeholder="http://localhost:1234 (LM Studio / vLLM / llama.cpp)"
            />
            <input
              className="field font-mono text-xs"
              type="password"
              value={draft.providers.openai.apiKey}
              onChange={(e) =>
                setDraft({ ...draft, providers: { ...draft.providers, openai: { ...draft.providers.openai, apiKey: e.target.value } } })
              }
              placeholder="API key (optional)"
            />
          </div>
          <p className="mt-1 text-[11px] text-zinc-600">Stored locally in .data/settings.json only — this app never talks to the cloud unless you point it at a cloud URL.</p>
        </section>

        {/* Codex */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-100">Codex (ChatGPT subscription)</h3>
          <p className="mb-2 text-xs text-zinc-500">
            Uses your ChatGPT plan through the Codex CLI&apos;s OAuth sign-in — no API key. The CLI ships
            with this app; you only need to sign in once.
          </p>
          <div className="flex items-center gap-3 text-xs">
            <StatusDot ok={health ? health.codex.installed && health.codex.loggedIn : false} />
            <span className="text-zinc-400">
              {health
                ? health.codex.installed
                  ? health.codex.loggedIn
                    ? `signed in · ${health.codex.version}`
                    : "installed — sign in below"
                  : "not detected"
                : "checking…"}
            </span>
            <button className="btn-ghost ml-auto px-2.5 py-1 text-xs" onClick={codexLogin}>
              Sign in with ChatGPT
            </button>
          </div>
          {deviceCode && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-accent-500/30 bg-accent-500/10 p-2.5">
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-300">
                  One-time code (expires in 15 min)
                </span>
                <button
                  className="text-left font-mono text-lg font-bold tracking-widest text-white hover:underline"
                  title="Click to copy"
                  onClick={() => navigator.clipboard?.writeText(deviceCode)}
                >
                  {deviceCode}
                </button>
              </div>
              <span className="ml-auto text-[10px] text-zinc-400">click to copy · enter it on the browser page</span>
            </div>
          )}
          {loginMsg && <p className="mt-2 text-[11px] text-accent-300">{loginMsg}</p>}
          <label className="mt-3 flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Model (leave empty for your config.toml default)
            <input
              className="field py-1.5 font-mono text-xs"
              value={draft.providers.codex.model}
              onChange={(e) =>
                setDraft({ ...draft, providers: { ...draft.providers, codex: { model: e.target.value } } })
              }
              placeholder={`Default (${health?.codex.configuredModel || "config.toml model"})`}
            />
          </label>
        </section>

        {/* Generation */}
        <section className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-zinc-100">Generation</h3>
          <label className="flex items-center gap-3 text-xs text-zinc-400">
            Repair attempts (compile → error → retry)
            <input
              type="number"
              min={1}
              max={5}
              className="field w-16 py-1 text-xs"
              value={draft.maxRepairAttempts}
              onChange={(e) => setDraft({ ...draft, maxRepairAttempts: Number(e.target.value) })}
            />
          </label>
        </section>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-400 shadow-glow" : "bg-zinc-600"}`}
    />
  );
}
