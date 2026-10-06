import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export interface CompileResult {
  ok: boolean;
  errors: string[];
  log: string[];
}

/** Run OpenSCAD with a timeout, capturing combined output. */
async function runOpenSCAD(
  exe: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number; output: string; timedOut: boolean; aborted: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    let output = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let onAbortCleanup: (() => void) | null = null;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onAbortCleanup?.();
      resolve({ code, output, timedOut, aborted });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        aborted = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        settle(-2);
        return;
      }
      const onAbort = () => {
        aborted = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      onAbortCleanup = () => signal.removeEventListener("abort", onAbort);
    }

    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("error", (err) => {
      output += "\n" + String(err);
      settle(-1);
    });
    child.on("close", (code) => settle(code ?? -1));
  });
}

/** Compile a .scad file to a binary STL. Returns the compiler's error lines on failure. */
export async function compileSCAD(
  openscadPath: string,
  scadFile: string,
  stlFile: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CompileResult> {
  const { code, output, timedOut, aborted } = await runOpenSCAD(
    openscadPath,
    ["-o", stlFile, "--export-format=binstl", scadFile],
    timeoutMs,
    signal,
  );

  const log = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (aborted) {
    return { ok: false, errors: ["Cancelled by user."], log };
  }
  if (timedOut) {
    return { ok: false, errors: [`Compilation timed out after ${Math.round(timeoutMs / 1000)}s`], log };
  }

  const errors = log.filter((l) => l.startsWith("ERROR") || l.startsWith("Traceback"));

  if (code !== 0) {
    return { ok: false, errors: errors.length ? errors : [`OpenSCAD exited with code ${code}`], log };
  }

  let size = 0;
  try {
    size = fs.statSync(stlFile).size;
  } catch {
    return { ok: false, errors: ["OpenSCAD reported success but wrote no STL file."], log };
  }
  // 84 bytes = binary STL header with zero triangles -> "no top level geometry".
  if (size <= 84) {
    return {
      ok: false,
      errors: [
        "The model produced no solid geometry (empty result). Check that your difference()/intersection() logic does not remove everything.",
      ],
      log,
    };
  }
  return { ok: true, errors: [], log };
}

/** Render a thumbnail PNG. Best effort — failures are ignored. */
export async function renderThumbnail(
  openscadPath: string,
  scadFile: string,
  pngFile: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  const { code } = await runOpenSCAD(
    openscadPath,
    ["-o", pngFile, "--imgsize=512,384", "--projection=o", "--autocenter", "--viewall", scadFile],
    timeoutMs,
  );
  if (code !== 0) return false;
  try {
    return fs.statSync(pngFile).size > 100;
  } catch {
    return false;
  }
}

/** Extract the metadata comment header the model is instructed to write. */
export function parseMetaComments(scad: string): { name?: string; supports?: boolean; material?: string } {
  const grab = (re: RegExp) => scad.match(re)?.[1]?.trim();
  const name = grab(/^\s*\/\/\s*NAME:\s*(.+)$/im);
  const supportsRaw = grab(/^\s*\/\/\s*SUPPORTS:\s*(.+)$/im);
  const material = grab(/^\s*\/\/\s*MATERIAL:\s*(.+)$/im);
  return {
    name: name?.slice(0, 60),
    supports: supportsRaw ? /^(yes|true|1)$/i.test(supportsRaw) : undefined,
    material: material?.toUpperCase().slice(0, 8),
  };
}
