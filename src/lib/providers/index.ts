import type { ProviderId } from "../types";
import type { GenerateArgs, ProviderConfig } from "./base";
import { generateOllama } from "./ollama";
import { generateOpenAICompatible } from "./openai";
import { generateCodex } from "./codex";
import { generateDemo } from "./demo";

export async function generateWithProvider(
  provider: ProviderId,
  config: ProviderConfig,
  args: GenerateArgs,
): Promise<string> {
  switch (provider) {
    case "demo":
      return generateDemo(args);
    case "ollama":
      return generateOllama(config.ollama, args);
    case "openai":
      return generateOpenAICompatible(config.openai, args);
    case "codex":
      return generateCodex(config.codex, args);
  }
}

export { listOllamaModels } from "./ollama";
export { listOpenAIModels } from "./openai";
export { resolveCodex, codexVersion } from "./codex";
export { DEMO_MODELS } from "./demo";
