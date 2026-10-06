import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { GenerateArgs } from "./base";
import { ProviderError } from "./base";
import { PROJECT_ROOT } from "../settings";
import { runCodexViaRelay } from "../codexrelay";

export interface CodexCommand {
  cmd: string;
  preArgs: string[];
  /** true when cmd is a .cmd/.bat shim that must be launched through cmd.exe */
  viaCmd?: boolean;
}

/** Quote a single argument for a cmd.exe /c command line. */
function quoteForCmd(s: string): string {
  if (s === "" || /[\s"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build the final (cmd, argv) pair for a resolved CodexCommand.
 * Shared by the generate adapter and the login route.
 */
export function buildCodexSpawn(
  codex: CodexCommand,
  args: string[],
): { cmd: string; argv: string[] } {
  if (codex.viaCmd) {
    // cmd.exe /d /s /c takes the entire command line as ONE argument
    const line = [codex.cmd, ...args].map(quoteForCmd).join(" ");
    return { cmd: "cmd.exe", argv: ["/d", "/s", "/c", line] };
  }
  return { cmd: codex.cmd, argv: [...codex.preArgs, ...args] };
}

/**
 * Resolve a runnable Codex CLI:
 * 1. CODEX_PATH env var
 * 2. The project-local npm install (bin/codex.js launches the native binary;
 *    running it via node works under pnpm/npm/yarn alike).
 * 3. A `codex` on PATH (.cmd shims included).
 */
export async function resolveCodex(): Promise<CodexCommand | null> {
  if (process.env.CODEX_PATH && fs.existsSync(process.env.CODEX_PATH)) {
    return { cmd: process.env.CODEX_PATH, preArgs: [] };
  }

  const localJs = path.join(PROJECT_ROOT, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (fs.existsSync(localJs)) {
    return { cmd: process.execPath, preArgs: [localJs] };
  }

  try {
    const probe = await new Promise<string>((resolve) => {
      const child = spawn(process.platform === "win32" ? "where" : "which", ["codex"], { windowsHide: true });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("error", () => resolve(""));
      child.on("close", (code) => resolve(code === 0 ? out.split(/\r?\n/)[0].trim() : ""));
    });
    if (probe) {
      if (/\.(cmd|bat)$/i.test(probe)) {
        return { cmd: probe, preArgs: [], viaCmd: true };
      }
      return { cmd: probe, preArgs: [] };
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface RunOptions {
  stdin?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

function runCodex(
  codex: CodexCommand,
  args: string[],
  opts: RunOptions,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { cmd, argv } = buildCodexSpawn(codex, args);
    const child = spawn(cmd, argv, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      settle(() => reject(new ProviderError(`Codex CLI timed out after ${Math.round(opts.timeoutMs / 1000)}s`)));
    }, opts.timeoutMs);

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      settle(() => reject(new ProviderError("Cancelled")));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        settle(() => reject(new ProviderError("Cancelled")));
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    // A codex that exits without draining stdin must not crash us with EPIPE.
    child.stdin.on("error", () => undefined);
    child.on("error", (err) => {
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      settle(() => reject(new ProviderError(`Could not launch Codex CLI: ${err.message}`)));
    });
    child.on("close", (code) => {
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      settle(() => resolve({ code: code ?? -1, stdout, stderr }));
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}

export async function codexVersion(codex: CodexCommand): Promise<string> {
  const { stdout } = await runCodex(codex, ["--version"], { timeoutMs: 15000 });
  return stdout.trim() || "codex";
}

/**
 * Generate with the Codex CLI using the user's ChatGPT subscription
 * (`codex login`), never an API key.
 */
export async function generateCodex(
  config: { model: string },
  args: GenerateArgs,
): Promise<string> {
  const codex = await resolveCodex();
  if (!codex) {
    throw new ProviderError(
      "Codex CLI not found. Install it with: npm install -g @openai/codex — then run `codex login` to use your ChatGPT subscription.",
    );
  }
  if (args.signal?.aborted) throw new ProviderError("Cancelled");

  const outFile = path.join(args.workDir, "codex-last-message.txt");
  const cliArgs = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--output-last-message",
    outFile,
  ];
  if (config.model) cliArgs.push("--model", config.model);

  // Attach input images for multimodal requests (supported in recent CLI versions).
  let droppedImages = false;
  const imageArgs: string[] = [];
  if (args.images.length) {
    args.images.forEach((img, i) => {
      const ext = img.mime.includes("png") ? "png" : img.mime.includes("gif") ? "gif" : "jpg";
      const p = path.join(args.workDir, `input-${i}.${ext}`);
      try {
        fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
        imageArgs.push("--image", p);
      } catch {
        /* ignore */
      }
    });
  }

  const prompt = `${args.system}\n\n---\n\n${args.user}`;

  const runViaRelay = async (cliArgs2: string[]) => {
    if (process.platform !== "win32" || process.env.OPENFORGE_CODEX_DIRECT === "1" || codex.viaCmd) {
      return runCodex(codex, cliArgs2, { stdin: prompt, timeoutMs: 10 * 60_000, signal: args.signal });
    }
    // Local npm install: cmd = node, preArgs = [codex.js]. Relay it into a clean
    // process tree (WMI) so auth/TLS behave exactly like a normal terminal.
    if (codex.cmd === process.execPath && codex.preArgs.length === 1) {
      const abortPromise = new Promise<never>((_, reject) => {
        args.signal?.addEventListener("abort", () => reject(new ProviderError("Cancelled")), { once: true });
      });
      const relayPromise = runCodexViaRelay(codex.cmd, codex.preArgs[0], cliArgs2, {
        stdin: prompt,
        cwd: args.workDir,
        timeoutMs: 10 * 60_000,
      });
      return Promise.race([relayPromise, abortPromise]);
    }
    return runCodex(codex, cliArgs2, { stdin: prompt, timeoutMs: 10 * 60_000, signal: args.signal });
  };

  let run = await runViaRelay([...cliArgs, ...imageArgs]);

  // Older CLIs don't know --image: retry once without vision and say so.
  if (run.code !== 0 && imageArgs.length && /unknown option|unexpected argument|unrecognized/i.test(run.stderr)) {
    droppedImages = true;
    run = await runViaRelay([...cliArgs]);
  }

  // Very old CLIs may not read the prompt from stdin — fall back to argv.
  if (run.code !== 0 && !args.signal?.aborted && /no prompt|missing.*prompt|usage/i.test(run.stderr)) {
    run = await runViaRelay([...cliArgs, ...imageArgs, prompt]);
  }

  if (args.signal?.aborted) throw new ProviderError("Cancelled");
  if (run.code !== 0) {
    const tail = (run.stderr || run.stdout).trim().split(/\r?\n/).slice(-6).join("\n");
    if (/refresh_token_invalidated|session has ended|could not be refreshed/i.test(tail)) {
      throw new ProviderError(
        "Your Codex session has ended (OpenAI revoked the refresh token). Open Settings → Sign in with ChatGPT to log in again.",
      );
    }
    if (/app-server|Access is denied/i.test(tail)) {
      throw new ProviderError(
        `Codex CLI could not initialize its sandbox in this environment.\n${tail}\nTip: if OpenForge was launched from a restricted shell, start it from a normal terminal.`,
      );
    }
    if (/not logged in|login/i.test(tail)) {
      throw new ProviderError(`Codex CLI is not logged in. Use Settings → Sign in with ChatGPT.\n${tail}`);
    }
    throw new ProviderError(`Codex CLI failed (exit ${run.code}).\n${tail}`);
  }

  let message = "";
  try {
    message = fs.readFileSync(outFile, "utf8");
  } catch {
    message = run.stdout;
  }
  if (droppedImages && args.onProgress) {
    args.onProgress("note: installed Codex CLI rejected image input — generation used text only");
  }
  return message;
}
