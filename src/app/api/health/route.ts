import { NextResponse } from "next/server";
import { loadSettings, codexLoggedIn, findOpenSCAD, codexConfiguredModel } from "@/lib/settings";
import { resolveCodex, codexVersion } from "@/lib/providers/codex";
import { findBambuStudio, bambuProfilesReady } from "@/lib/bambu";

export const runtime = "nodejs";

export async function GET() {
  let settings = await loadSettings();
  if (!settings.openscadPath) {
    // re-probe once in case OpenSCAD was installed after settings were saved
    settings = { ...settings, openscadPath: findOpenSCAD() };
  }

  let codex = { installed: false, version: "", loggedIn: false, configuredModel: "" };
  try {
    const cmd = await resolveCodex();
    if (cmd) {
      codex.installed = true;
      codex.version = await codexVersion(cmd);
      codex.loggedIn = await codexLoggedIn();
      codex.configuredModel = await codexConfiguredModel();
    }
  } catch {
    /* codex probe failed */
  }

  let ollama = { reachable: false };
  try {
    const res = await fetch(`${settings.providers.ollama.baseUrl.replace(/\/+$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    ollama.reachable = res.ok;
  } catch {
    /* not running */
  }

  const bambuExe = findBambuStudio();
  const bambu = { found: Boolean(bambuExe), path: bambuExe ?? "", profilesReady: bambuProfilesReady() };

  return NextResponse.json({
    openscad: { found: Boolean(settings.openscadPath), path: settings.openscadPath },
    codex,
    ollama,
    bambu,
  });
}
