"use client";

import { useState } from "react";
import { estimateGrams, fitsBuildVolume, BUILD_VOLUME } from "@/lib/stl";
import type { GenerationMeta, GenerationSummary } from "@/lib/types";

function fmtMm(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export default function ModelPanel({
  gen,
  infill,
  setInfill,
  material,
  setMaterial,
  history,
  onSelectHistory,
  onDeleteHistory,
  bambuReady = false,
  onSliceLog,
}: {
  gen: { meta: GenerationMeta; scad: string } | null;
  infill: number;
  setInfill: (n: number) => void;
  material: string;
  setMaterial: (m: string) => void;
  history: GenerationSummary[];
  onSelectHistory: (g: GenerationSummary) => void;
  onDeleteHistory: (id: string) => void;
  bambuReady?: boolean;
  onSliceLog?: (msg: string) => void;
}) {
  const [slicing, setSlicing] = useState(false);
  const [sliceResult, setSliceResult] = useState<{
    ok: boolean;
    error?: string;
    warning?: string;
    predictSeconds?: number;
    filamentGrams?: number;
  } | null>(null);

  const sliceForP1S = async () => {
    if (!gen || slicing) return;
    setSlicing(true);
    setSliceResult(null);
    onSliceLog?.("Slice for P1S requested…");
    try {
      const res = await fetch(`/api/generations/${gen.meta.id}/slice`, { method: "POST" });
      const data = await res.json();
      setSliceResult(data);
      if (data.ok) {
        onSliceLog?.(`Done — download p1s-print.3mf below and send it to the printer.`);
      } else {
        onSliceLog?.(`Slicer error: ${data.error ?? "unknown"}`);
      }
    } catch (e) {
      setSliceResult({ ok: false, error: (e as Error).message });
    } finally {
      setSlicing(false);
    }
  };

  const stats = gen?.meta.stats;
  const fits = stats ? fitsBuildVolume(stats.dims) : true;
  const est = stats ? estimateGrams(stats, infill, material) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      {/* Current model */}
      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Model</h2>
          {gen && (
            <span className="text-[10px] text-zinc-500">
              {new Date(gen.meta.createdAt).toLocaleTimeString([], { hour12: false })}
            </span>
          )}
        </div>

        {!gen || !stats ? (
          <p className="text-xs leading-relaxed text-zinc-500">
            Stats, material estimate and exports show up here after the first successful forge.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">{gen.meta.name}</h3>
              {gen.meta.supports ? (
                <span className="chip border-amber-500/40 bg-amber-500/10 text-amber-300">
                  supports
                </span>
              ) : (
                <span className="chip border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                  no supports
                </span>
              )}
            </div>

            <div className={`chip w-fit ${fits ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`}>
              {fits
                ? `Fits P1S plate (${BUILD_VOLUME.x} mm)`
                : `Too big for P1S — scale to ${Math.ceil(
                    (256 / Math.max(stats.dims.x, stats.dims.y, stats.dims.z)) * 100,
                  )}%`}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Dimensions"
                value={`${fmtMm(stats.dims.x)} × ${fmtMm(stats.dims.y)} × ${fmtMm(stats.dims.z)} mm`}
              />
              <Stat label="Triangles" value={stats.triangles.toLocaleString()} />
              <Stat
                label="Solid volume"
                value={`${(stats.volumeMM3 / 1000).toFixed(1)} cm³`}
                sub={`${est ? est.solidGrams.toFixed(0) : "–"} g solid`}
              />
              <Stat
                label={`Est. material @ ${infill}% ${material}`}
                value={est ? `≈ ${est.grams.toFixed(0)} g` : "–"}
                sub="rough — slice for real numbers"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Infill
                <select
                  className="field py-1.5 text-xs"
                  value={infill}
                  onChange={(e) => setInfill(Number(e.target.value))}
                >
                  {[10, 15, 20, 25, 40, 50, 100].map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Material
                <select
                  className="field py-1.5 text-xs"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                >
                  {["PLA", "PETG", "ABS", "TPU"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a className="btn-primary text-xs" href={`/api/generations/${gen.meta.id}/stl`}>
                STL ↓
              </a>
              <a className="btn-ghost text-xs" href={`/api/generations/${gen.meta.id}/3mf`}>
                3MF ↓
              </a>
              <a className="btn-ghost text-xs" href={`/api/generations/${gen.meta.id}/scad`}>
                SCAD ↓
              </a>
              <a
                className="btn-ghost text-xs"
                href={`/api/generations/${gen.meta.id}/thumb`}
                target="_blank"
              >
                Render
              </a>
            </div>

            {bambuReady && (
              <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Slice for P1S
                  </div>
                  <button className="btn-primary text-xs" onClick={sliceForP1S} disabled={slicing}>
                    {slicing ? "Slicing…" : "Slice now"}
                  </button>
                </div>
                <div className="text-[10px] leading-relaxed text-zinc-500">
                  Uses the installed Bambu Studio (headless) — P1S · 0.4 nozzle · 0.20 mm Standard · Bambu PLA.
                </div>
                {sliceResult && (
                  <div className="flex flex-col gap-1">
                    {sliceResult.ok ? (
                      <>
                        <div className="flex items-center gap-2 text-[11px] text-emerald-300">
                          <span>
                            ≈ {Math.max(1, Math.round((sliceResult.predictSeconds ?? 0) / 60))} min ·{" "}
                            {sliceResult.filamentGrams?.toFixed(1) ?? "?"} g
                          </span>
                        </div>
                        <a className="btn-primary text-xs" href={`/api/generations/${gen.meta.id}/sliced`}>
                          p1s-print.3mf ↓ (print-ready)
                        </a>
                      </>
                    ) : (
                      <div className="text-[11px] text-red-400">{sliceResult.error}</div>
                    )}
                    {sliceResult.warning && (
                      <div className="text-[10px] leading-relaxed text-amber-400/90">{sliceResult.warning}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Slicer checklist */}
      <section className="panel p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-100">Bambu Studio checklist</h2>
        <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-zinc-400">
          <li>1. Import the STL (drag & drop) into Bambu Studio.</li>
          <li>2. Printer profile: <span className="text-zinc-200">Bambu Lab P1S · 0.4 nozzle</span>.</li>
          <li>3. Layer height 0.20 mm, 2–3 walls.</li>
          <li>
            4. Supports:{" "}
            <span className="text-zinc-200">
              {gen?.meta.supports ? "recommended by the model — enable tree supports" : "not needed per the model"}
            </span>{" "}
            (verify overhangs).
          </li>
          <li>5. Infill {infill}% · {material} · P1S bed {material === "PLA" ? "60" : material === "PETG" ? "80" : "100"} °C.</li>
          <li>6. Slice → print. The P1S handles the rest.</li>
        </ul>
      </section>

      {/* History */}
      <section className="panel flex min-h-0 flex-1 flex-col p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-100">History</h2>
        {history.length === 0 ? (
          <p className="text-xs text-zinc-500">Nothing forged yet.</p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {history.map((g) => (
              <li key={g.id}>
                <div
                  className={`group flex cursor-pointer items-center gap-2.5 rounded-xl border p-2 transition-colors ${
                    gen?.meta.id === g.id
                      ? "border-accent-500/60 bg-accent-500/5"
                      : "border-ink-700 bg-ink-900/40 hover:border-ink-600"
                  }`}
                  onClick={() => onSelectHistory(g)}
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-ink-700 bg-ink-800">
                    {g.hasThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/generations/${g.id}/thumb`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                        ⬡
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-200">{g.name}</p>
                    <p className="truncate text-[10px] text-zinc-500">
                      {fmtMm(g.stats.dims.x)}×{fmtMm(g.stats.dims.y)}×{fmtMm(g.stats.dims.z)} mm ·{" "}
                      {g.provider}
                    </p>
                  </div>
                  <button
                    className="rounded-lg px-1.5 py-1 text-xs text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteHistory(g.id);
                    }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
