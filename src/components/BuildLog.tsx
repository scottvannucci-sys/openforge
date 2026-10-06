"use client";

import { useEffect, useRef } from "react";

export interface LogLine {
  level: "info" | "warn" | "error";
  message: string;
  t: number;
}

export default function BuildLog({
  lines,
  working,
}: {
  lines: LogLine[];
  working: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const color = (level: LogLine["level"]) =>
    level === "error" ? "text-red-400" : level === "warn" ? "text-amber-300" : "text-zinc-400";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Build log
        </span>
        {working && (
          <span className="flex items-center gap-1.5 text-[11px] text-accent-300">
            <span className="working-dot h-1.5 w-1.5 rounded-full bg-accent-400" />
            working
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="min-h-[120px] flex-1 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900/80 p-3"
      >
        {lines.length === 0 && !working ? (
          <p className="log-line text-zinc-600">
            Pipeline events appear here — model streaming, OpenSCAD compile attempts, repairs, mesh
            stats.
          </p>
        ) : (
          lines.map((l, i) => (
            <p key={i} className={`log-line ${color(l.level)}`}>
              <span className="mr-2 text-zinc-700">
                {new Date(l.t).toLocaleTimeString([], { hour12: false })}
              </span>
              {l.message}
            </p>
          ))
        )}
        {working && (
          <p className="log-line mt-1 animate-pulse text-accent-300">▍</p>
        )}
      </div>
    </div>
  );
}
