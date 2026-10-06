import fs from "fs";
import path from "path";
import os from "os";
import type { AppSettings } from "./types";

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, ".data");
export const GENERATIONS_DIR = path.join(DATA_DIR, "generations");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export const DEFAULT_SETTINGS: AppSettings = {
  openscadPath: "",
  openscadTimeoutSec: 120,
  maxRepairAttempts: 3,
  activeProvider: "demo",
  providers: {
    demo: {},
    ollama: { baseUrl: "http://localhost:11434", model: "" },
    openai: { baseUrl: "http://localhost:1234", apiKey: "", model: "" },
    codex: { model: "" },
  },
};

/** Look for OpenSCAD in all the usual places; returns "" when not found. */
export function findOpenSCAD(): string {
  const candidates: string[] = [];

  if (process.env.OPENSCAD_PATH) candidates.push(process.env.OPENSCAD_PATH);

  if (process.platform === "win32") {
    candidates.push(
      path.join(PROJECT_ROOT, "tools", "OpenSCAD", "openscad-2021.01", "openscad.exe"),
      "C:\\Program Files\\OpenSCAD\\openscad.exe",
      "C:\\Program Files\\OpenSCAD (Nightly)\\openscad.exe",
      path.join(process.env.LOCALAPPDATA || "", "Programs", "OpenSCAD", "openscad.exe"),
    );
    // Any portable copy dropped into tools/OpenSCAD/**/openscad.exe
    try {
      const toolsDir = path.join(PROJECT_ROOT, "tools", "OpenSCAD");
      if (fs.existsSync(toolsDir)) {
        for (const entry of fs.readdirSync(toolsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const exe = path.join(toolsDir, entry.name, "openscad.exe");
            candidates.push(exe);
          }
        }
      }
    } catch {
      /* ignore */
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD");
  } else {
    candidates.push("/usr/bin/openscad", "/usr/local/bin/openscad", "/snap/bin/openscad");
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return "";
}

export async function loadSettings(): Promise<AppSettings> {
  let fileSettings: Partial<AppSettings> = {};
  try {
    fileSettings = JSON.parse(await fs.promises.readFile(SETTINGS_FILE, "utf8"));
  } catch {
    /* first run */
  }
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...fileSettings,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...(fileSettings.providers ?? {}),
      ollama: { ...DEFAULT_SETTINGS.providers.ollama, ...(fileSettings.providers?.ollama ?? {}) },
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...(fileSettings.providers?.openai ?? {}) },
      codex: { ...DEFAULT_SETTINGS.providers.codex, ...(fileSettings.providers?.codex ?? {}) },
    },
  };
  if (!merged.openscadPath) {
    merged.openscadPath = findOpenSCAD();
  }
  return merged;
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    openscadTimeoutSec: clampNumber(patch.openscadTimeoutSec ?? current.openscadTimeoutSec, 10, 3600, 120),
    maxRepairAttempts: clampNumber(patch.maxRepairAttempts ?? current.maxRepairAttempts, 1, 5, 3),
    providers: {
      ...current.providers,
      ...(patch.providers ?? {}),
      ollama: { ...current.providers.ollama, ...(patch.providers?.ollama ?? {}) },
      openai: { ...current.providers.openai, ...(patch.providers?.openai ?? {}) },
      codex: { ...current.providers.codex, ...(patch.providers?.codex ?? {}) },
    },
  };
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Where the Codex CLI stores subscription auth after `codex login`. */
export function codexAuthFile(): string {
  return path.join(os.homedir(), ".codex", "auth.json");
}

/** The app's own Codex home — writable even when ~/.codex is sandbox-denied. */
export function appCodexHome(): string {
  return path.join(DATA_DIR, "codex-home");
}

export function appCodexAuthFile(): string {
  return path.join(appCodexHome(), "auth.json");
}

/** Read `model = "…"` from the app's Codex home, falling back to ~/.codex (best-effort). */
export function codexConfiguredModel(): string {
  const homes = [appCodexHome(), path.join(os.homedir(), ".codex")];
  for (const home of homes) {
    try {
      const text = fs.readFileSync(path.join(home, "config.toml"), "utf8");
      const m = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    } catch {
      /* try next home */
    }
  }
  return "";
}

let loginStatusCache: { value: boolean; at: number } | null = null;

/**
 * True when the Codex CLI reports a valid login (`codex login status`).
 * Checks the app's Codex home first, then ~/.codex. Falls back to auth.json
 * existence when the CLI probe is unavailable. Cached for 5 s — the UI polls
 * /api/health while a login is in progress.
 */
export async function codexLoggedIn(): Promise<boolean> {
  if (loginStatusCache && Date.now() - loginStatusCache.at < 5000) return loginStatusCache.value;
  let value = false;
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const localJs = path.join(PROJECT_ROOT, "node_modules", "@openai", "codex", "bin", "codex.js");
    const homes = fs.existsSync(appCodexAuthFile())
      ? [appCodexHome(), path.join(os.homedir(), ".codex")]
      : [path.join(os.homedir(), ".codex"), appCodexHome()];
    for (const home of homes) {
      if (!fs.existsSync(path.join(home, "auth.json"))) continue;
      if (fs.existsSync(localJs)) {
        const out = await promisify(execFile)(process.execPath, [localJs, "login", "status"], {
          timeout: 20000,
          windowsHide: true,
          env: { ...process.env, CODEX_HOME: home },
        });
        // `codex login status` prints to stderr
        const text = `${out.stdout}${out.stderr}`;
        value = /logged in/i.test(text);
      } else {
        value = true;
      }
      if (value) break;
    }
  } catch {
    /* keep file-existence fallback */
    value = fs.existsSync(appCodexAuthFile()) || fs.existsSync(codexAuthFile());
  }
  loginStatusCache = { value, at: Date.now() };
  return value;
}

export async function ensureDataDirs(): Promise<void> {
  await fs.promises.mkdir(GENERATIONS_DIR, { recursive: true });
}
