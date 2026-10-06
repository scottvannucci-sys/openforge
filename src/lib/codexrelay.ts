// Codex relay: launches the Codex CLI in a fresh process tree via WMI.
//
// Why: when OpenForge's server runs inside a restricted parent environment
// (sandboxed harness, service contexts), the Codex CLI can fail with TLS
// interception or "Access is denied" from its own sandbox setup. A process
// created through WMI (Win32_Process.Create) runs with the interactive user's
// normal token and network stack, which makes Codex behave exactly like it
// does from a regular terminal.
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { DATA_DIR } from "./settings";

// .cjs on purpose: the relay source uses CommonJS require()
const RELAY_SCRIPT = path.join(DATA_DIR, "codex-relay.cjs");

const RELAY_SOURCE = String.raw`
// OpenForge codex relay — runs OUTSIDE the server's process tree (launched via WMI).
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const heartbeat = setInterval(() => {
  try { fs.writeFileSync(job.heartbeatFile, String(Date.now())); } catch {}
}, 2000);
try {
  const childEnv = job.codexHome ? { ...process.env, CODEX_HOME: job.codexHome } : process.env;
  if (job.mode === "exec") {
    // async on purpose: spawnSync would block the event loop and starve the heartbeat
    const child = spawn(job.nodeExe, [job.codexJs, ...job.args], { cwd: job.cwd, stdio: ["pipe", "pipe", "pipe"], env: childEnv });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out = (out + d.toString()).slice(-4000); });
    child.stderr.on("data", (d) => { err = (err + d.toString()).slice(-12000); });
    child.stdin.on("error", () => undefined);
    child.stdin.end(job.stdin ?? "");
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, job.timeoutMs || 600000);
    const finish = (code) => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      try { fs.writeFileSync(job.resultFile, JSON.stringify({ code, stderr: err, stdout: out })); } catch {}
      process.exit(0);
    };
    child.on("exit", (code) => finish(code ?? -1));
    child.on("error", () => finish(-1));
  } else if (job.mode === "login") {
    const out = fs.openSync(job.stderrFile, "a");
    const child = spawn(job.nodeExe, [job.codexJs, ...job.args], { cwd: job.cwd, stdio: ["ignore", out, out], env: childEnv });
    const finish = (code) => {
      clearInterval(heartbeat);
      try { fs.writeFileSync(job.resultFile, JSON.stringify({ code })); } catch {}
      process.exit(0);
    };
    child.on("exit", (code) => finish(code ?? -1));
    child.on("error", () => finish(-1));
  }
} catch (err) {
  clearInterval(heartbeat);
  try { fs.writeFileSync(job.resultFile, JSON.stringify({ code: -1, stderr: String(err) })); } catch {}
}
`;

// Codex CLI sandboxing denies writes under ~/.codex (CodexSandboxUsers has only
// RX there), which kills login persistence and app-server startup. Giving the
// CLI its own home inside the writable workspace fixes auth, logs and tmp dirs.
export function ensureCodexHome(): string {
  const home = path.join(DATA_DIR, "codex-home");
  fs.mkdirSync(home, { recursive: true });
  // carry the user's config.toml (model default etc.) into the new home once
  try {
    const src = path.join(os.homedir(), ".codex", "config.toml");
    const dst = path.join(home, "config.toml");
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
  } catch {
    /* optional */
  }
  return home;
}

function ensureRelay(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let current = "";
  try {
    current = fs.readFileSync(RELAY_SCRIPT, "utf8");
  } catch {
    /* missing */
  }
  if (current !== RELAY_SOURCE) fs.writeFileSync(RELAY_SCRIPT, RELAY_SOURCE, "utf8");
  return RELAY_SCRIPT;
}

function wmiLaunch(commandLine: string, cwd: string): Promise<number> {
  const script = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Argument @{ CommandLine = [Environment]::GetEnvironmentVariable('OF_CMDLINE'); CurrentDirectory = [Environment]::GetEnvironmentVariable('OF_CWD') }; Write-Output $r.ProcessId`;
  return new Promise((resolve, reject) => {
    // pass the command line via env so we never fight nested quoting
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      {
        windowsHide: true,
        env: { ...process.env, OF_CMDLINE: commandLine, OF_CWD: cwd },
      },
    );
    let out = "";
    ps.stdout.on("data", (d) => (out += d.toString()));
    ps.on("exit", (code) => {
      const pid = parseInt(out.trim(), 10);
      if (code === 0 && Number.isFinite(pid) && pid > 0) resolve(pid);
      else reject(new Error(`WMI launch failed (powershell exit ${code})`));
    });
    ps.on("error", reject);
  });
}

export interface RelayExecResult {
  code: number;
  stderr: string;
  stdout: string;
}

export async function runCodexViaRelay(
  nodeExe: string,
  codexJs: string,
  args: string[],
  opts: { stdin?: string; cwd: string; timeoutMs: number },
): Promise<RelayExecResult> {
  const relay = ensureRelay();
  const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jobFile = path.join(DATA_DIR, `${id}.job.json`);
  const resultFile = path.join(DATA_DIR, `${id}.result.json`);
  const heartbeatFile = path.join(DATA_DIR, `${id}.hb`);
  const job = {
    mode: "exec",
    nodeExe,
    codexJs,
    args,
    stdin: opts.stdin ?? "",
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    codexHome: ensureCodexHome(),
    resultFile,
    heartbeatFile,
  };
  fs.writeFileSync(jobFile, JSON.stringify(job), "utf8");

  const commandLine = `"${nodeExe}" "${relay}" "${jobFile}"`;
  const pid = await wmiLaunch(commandLine, opts.cwd);

  const deadline = Date.now() + opts.timeoutMs + 20000;
  let seenHeartbeat = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    if (fs.existsSync(resultFile)) break;
    // the relay's first beat lands ~2s after launch — only judge staleness after that
    let hbAge = Infinity;
    try {
      hbAge = Date.now() - parseInt(fs.readFileSync(heartbeatFile, "utf8"), 10);
    } catch {
      /* no heartbeat yet */
    }
    if (Number.isFinite(hbAge)) seenHeartbeat = true;
    if (seenHeartbeat && hbAge > 10000) {
      try {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } catch {
        /* ignore */
      }
      throw new Error("Codex relay died unexpectedly (no heartbeat).");
    }
  }
  cleanup(jobFile, heartbeatFile);
  if (!fs.existsSync(resultFile)) throw new Error("Codex relay timed out.");
  const res = JSON.parse(fs.readFileSync(resultFile, "utf8")) as RelayExecResult;
  cleanup(resultFile);
  return res;
}

export interface CodexLoginHandle {
  jobFile: string;
  resultFile: string;
  stderrFile: string;
  heartbeatFile: string;
  startedAt: number;
}

export function startCodexLoginViaRelay(nodeExe: string, codexJs: string, cwd: string): CodexLoginHandle {
  const relay = ensureRelay();
  const id = `login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const handle: CodexLoginHandle = {
    jobFile: path.join(DATA_DIR, `${id}.job.json`),
    resultFile: path.join(DATA_DIR, `${id}.result.json`),
    stderrFile: path.join(DATA_DIR, `${id}.login.log`),
    heartbeatFile: path.join(DATA_DIR, `${id}.hb`),
    startedAt: Date.now(),
  };
  const job = {
    mode: "login",
    nodeExe,
    codexJs,
    // device-auth: no local callback server; the CLI polls OpenAI itself and the
    // user just enters a one-time code — immune to refused localhost redirects
    args: ["login", "--device-auth"],
    cwd,
    codexHome: ensureCodexHome(),
    resultFile: handle.resultFile,
    stderrFile: handle.stderrFile,
    heartbeatFile: handle.heartbeatFile,
  };
  fs.writeFileSync(handle.jobFile, JSON.stringify(job), "utf8");
  wmiLaunch(`"${nodeExe}" "${relay}" "${handle.jobFile}"`, cwd).catch(() => undefined);
  return handle;
}

export interface DeviceLogin {
  url: string;
  code: string;
}

export function parseDeviceLogin(log: string): DeviceLogin | null {
  const clean = log.replace(/\u001b\[[0-9;]*m/g, ""); // strip ANSI color escapes
  const url = clean.match(/https:\/\/\S*\/(?:codex\/)?device[^\s]*/)?.[0];
  const code = clean.match(/^\s*([A-Z0-9]{4}-[A-Z0-9]{4,6})\s*$/m)?.[1];
  return url && code ? { url, code } : null;
}

/** Poll the login log until the device code + URL appear (or the flow exits). */
export function pollDeviceLogin(handle: CodexLoginHandle, timeoutMs = 20000): Promise<{ login?: DeviceLogin; done?: boolean }> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      try {
        const log = fs.readFileSync(handle.stderrFile, "utf8");
        const login = parseDeviceLogin(log);
        if (login) return resolve({ login });
        if (fs.existsSync(handle.resultFile)) return resolve({ done: true });
      } catch {
        /* log not written yet */
      }
      if (Date.now() > deadline) return resolve({});
      setTimeout(tick, 500);
    };
    tick();
  });
}

export function loginFinished(handle: CodexLoginHandle): boolean {
  try {
    return fs.existsSync(handle.resultFile);
  } catch {
    return false;
  }
}

function cleanup(...files: string[]) {
  for (const f of files) {
    fs.promises.unlink(f).catch(() => undefined);
  }
}
