import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { resolveCodex } from "@/lib/providers/codex";
import { startCodexLoginViaRelay, pollDeviceLogin, type CodexLoginHandle } from "@/lib/codexrelay";
import { appCodexAuthFile, codexAuthFile } from "@/lib/settings";

export const runtime = "nodejs";

// Module-level handle so repeated clicks reuse the in-flight login
// (each device code is tied to one polling `codex login` process).
let active: CodexLoginHandle | null = null;

function loginIsDone(h: CodexLoginHandle): boolean {
  try {
    return existsSync(h.resultFile);
  } catch {
    return true;
  }
}

/** Latest token write across both Codex homes (app home is authoritative). */
function authMtime(): number {
  const mtimes = [appCodexAuthFile(), codexAuthFile()].map((f) => {
    try {
      return statSync(f).mtimeMs;
    } catch {
      return 0;
    }
  });
  return Math.max(...mtimes);
}

/** Login truth: was ~/.codex/auth.json rewritten since the login started?
 *  (`codex login status` happily reports a stale revoked token as logged in.) */
export async function GET() {
  return NextResponse.json({
    ok: true,
    authMtime: authMtime(),
    loginStartedAt: active?.startedAt ?? 0,
    loginFinished: active ? loginIsDone(active) : true,
  });
}

/**
 * Start `codex login --device-auth` in a clean process tree (WMI relay) and
 * return the verification URL + one-time code. No local callback port involved:
 * the CLI polls OpenAI itself, so nothing can refuse the browser's redirect.
 */
export async function POST() {
  const codex = await resolveCodex();
  if (!codex) {
    return NextResponse.json(
      { ok: false, message: "Codex CLI is not installed. Install with: npm install -g @openai/codex" },
      { status: 400 },
    );
  }
  if (codex.cmd !== process.execPath || codex.preArgs.length !== 1) {
    return NextResponse.json(
      { ok: false, message: "Headless login requires the project-local Codex install (node + codex.js)." },
      { status: 400 },
    );
  }
  try {
    if (!active || loginIsDone(active)) {
      active = startCodexLoginViaRelay(codex.cmd, codex.preArgs[0], process.cwd());
    }
    const { login, done } = await pollDeviceLogin(active, 25000);
    if (login) {
      return NextResponse.json({
        ok: true,
        deviceUrl: login.url,
        deviceCode: login.code,
        message: "Enter this code in the browser page, then approve access.",
      });
    }
    if (done) {
      return NextResponse.json({ ok: false, message: "codex login exited before showing a code. Try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: false, message: "Device code did not appear in time. Try again." }, { status: 504 });
  } catch (err) {
    return NextResponse.json({ ok: false, message: `Could not start codex login: ${(err as Error).message}` }, { status: 500 });
  }
}
