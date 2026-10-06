import { NextRequest, NextResponse } from "next/server";
import { loadSettings, codexLoggedIn, codexConfiguredModel } from "@/lib/settings";
import { listOllamaModels } from "@/lib/providers/ollama";
import { listOpenAIModels } from "@/lib/providers/openai";
import { DEMO_MODELS } from "@/lib/providers/demo";

export const runtime = "nodejs";

const CODEX_FALLBACK = [
  { id: "", label: "Default (uses your Codex config)" },
  { id: "__custom__", label: "Custom…" },
];

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider");
  const settings = await loadSettings();

  switch (provider) {
    case "demo":
      return NextResponse.json({ models: DEMO_MODELS.map((id) => ({ id, label: "Sample templates" })) });
    case "ollama": {
      try {
        const models = await listOllamaModels(settings.providers.ollama.baseUrl);
        return NextResponse.json({ models: models.map((id) => ({ id, label: id })) });
      } catch (e) {
        return NextResponse.json(
          { models: [], error: e instanceof Error ? e.message : "Ollama unreachable" },
        );
      }
    }
    case "openai": {
      const { baseUrl, apiKey } = settings.providers.openai;
      try {
        const models = await listOpenAIModels(baseUrl, apiKey);
        return NextResponse.json({ models: models.map((id) => ({ id, label: id })) });
      } catch (e) {
        return NextResponse.json(
          { models: [], error: e instanceof Error ? e.message : "Endpoint unreachable" },
        );
      }
    }
    case "codex": {
      const configured = codexConfiguredModel();
      const models = configured
        ? [
            { id: "", label: `Default (config: ${configured})` },
            { id: configured, label: `${configured} (your config default)` },
            { id: "__custom__", label: "Custom…" },
          ]
        : CODEX_FALLBACK;
      return NextResponse.json({ models, custom: true, configuredModel: configured });
    }
    default:
      return NextResponse.json({ models: [], error: "Unknown provider" });
  }
}
