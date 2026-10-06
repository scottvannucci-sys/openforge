// Bambu Studio CLI integration: slice an STL for the P1S into a .gcode.3mf.
//
// Validated against Bambu Studio 2.08 (Windows):
//   bambu-studio.exe --debug 2 --orient 1 --arrange 1
//     --load-settings "machine.json;process.json" --load-filaments "filament.json"
//     --slice 0 --export-3mf OUT.3mf INPUT.stl
// The process working directory is set to the generation directory so the CLI's
// result.json (return code, time prediction, filament grams) lands there.
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export interface BambuSliceResult {
  ok: boolean;
  code: number;
  error?: string;
  warning?: string;
  predictSeconds?: number;
  filamentGrams?: number;
  triangles?: number;
}

const CANDIDATE_DIRS = [
  "C:\\Program Files\\Bambu Studio",
  "C:\\Program Files\\Bambu Studio Global",
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Bambu Studio"),
];

export function findBambuStudio(): string | null {
  for (const dir of CANDIDATE_DIRS) {
    if (!dir) continue;
    const exe = path.join(dir, "bambu-studio.exe");
    try {
      if (fs.existsSync(exe)) return exe;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function profilesDir(): string {
  return path.join(process.cwd(), "resources", "bambu");
}

export function bambuProfilesReady(): boolean {
  const dir = profilesDir();
  return (
    fs.existsSync(path.join(dir, "machine-p1s-0.4.json")) &&
    fs.existsSync(path.join(dir, "process-020-standard.json")) &&
    fs.existsSync(path.join(dir, "filament-pla-basic.json"))
  );
}

export async function sliceForP1S(
  workDir: string,
  stlPath: string,
  opts: { onProgress?: (msg: string) => void; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<BambuSliceResult> {
  const exe = findBambuStudio();
  if (!exe) return { ok: false, code: -1, error: "Bambu Studio is not installed." };
  if (!bambuProfilesReady()) return { ok: false, code: -1, error: "P1S profiles missing from resources/bambu." };

  const dir = profilesDir();
  const machine = path.join(dir, "machine-p1s-0.4.json");
  const process_ = path.join(dir, "process-020-standard.json");
  const filament = path.join(dir, "filament-pla-basic.json");
  const out3mf = path.join(workDir, "p1s-print.3mf");

  const args = [
    "--debug", "2",
    "--orient", "1",
    "--arrange", "1",
    "--load-settings", `${machine};${process_}`,
    "--load-filaments", filament,
    "--slice", "0",
    "--export-3mf", out3mf,
    stlPath,
  ];

  opts.onProgress?.("Slicing with Bambu Studio (P1S, 0.4 nozzle, Bambu PLA)…");
  const child = spawn(exe, args, { cwd: workDir, windowsHide: true });
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const result = await new Promise<{ code: number }>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ code: -999 });
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -998 });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -997 });
    });
  });
  opts.signal?.removeEventListener("abort", onAbort);
  if (aborted) return { ok: false, code: -1, error: "Cancelled by user." };

  if (result.code === -999) return { ok: false, code: -999, error: "Slicing timed out." };
  if (result.code === -997 || result.code === -998) return { ok: false, code: result.code, error: "Failed to launch Bambu Studio CLI." };

  // The CLI writes result.json into its working directory (our gen dir).
  let info: Record<string, unknown> = {};
  try {
    info = JSON.parse(fs.readFileSync(path.join(workDir, "result.json"), "utf8"));
  } catch {
    /* optional */
  }
  const returnCode = typeof info.return_code === "number" ? info.return_code : result.code;
  const plates = Array.isArray(info.sliced_plates) ? (info.sliced_plates as Record<string, unknown>[]) : [];
  const plate0 = plates[0] ?? {};
  const base: BambuSliceResult = {
    ok: returnCode === 0 && fs.existsSync(out3mf),
    code: returnCode,
    error:
      returnCode !== 0 && typeof info.error_string === "string" && info.error_string
        ? info.error_string
        : undefined,
    warning: typeof plate0.warning_message === "string" ? plate0.warning_message : undefined,
    predictSeconds: typeof plate0.total_predication === "number" ? plate0.total_predication : undefined,
    triangles: typeof plate0.triangle_count === "number" ? plate0.triangle_count : undefined,
    filamentGrams: (() => {
      const fils = Array.isArray(plate0.filaments) ? (plate0.filaments as Record<string, number>[]) : [];
      const total = fils.reduce((acc, f) => acc + (typeof f.total_used_g === "number" ? f.total_used_g : 0), 0);
      return total > 0 ? total : undefined;
    })(),
  };
  if (base.ok) opts.onProgress?.(`Sliced: ~${Math.round((base.predictSeconds ?? 0) / 60)} min, ${base.filamentGrams?.toFixed(1) ?? "?"} g of filament`);
  return base;
}
