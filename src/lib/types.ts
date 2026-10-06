export type ProviderId = "demo" | "ollama" | "openai" | "codex";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  blurb: string;
  needsKey?: boolean;
  isSubscription?: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "demo",
    label: "Demo",
    blurb: "Built-in sample models. No AI, no setup — try the full pipeline instantly.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    blurb: "Models served locally by Ollama on this machine.",
  },
  {
    id: "openai",
    label: "OpenAI-compatible",
    blurb: "LM Studio, vLLM, llama.cpp, Ollama's OpenAI shim, or any /v1 endpoint.",
    needsKey: true,
  },
  {
    id: "codex",
    label: "Codex (ChatGPT subscription)",
    blurb: "Uses your ChatGPT/Codex plan via the Codex CLI OAuth sign-in. No API key.",
    isSubscription: true,
  },
];

export interface AppSettings {
  openscadPath: string;
  openscadTimeoutSec: number;
  maxRepairAttempts: number;
  activeProvider: ProviderId;
  providers: {
    demo: Record<string, never>;
    ollama: { baseUrl: string; model: string };
    openai: { baseUrl: string; apiKey: string; model: string };
    codex: { model: string };
  };
}

export interface GenStats {
  triangles: number;
  dims: { x: number; y: number; z: number };
  volumeMM3: number;
  areaMM2: number;
}

export interface GenerationMeta {
  id: string;
  name: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  createdAt: number;
  durationMs: number;
  attempts: number;
  hasImage: boolean;
  material: string;
  supports: boolean;
  stats: GenStats;
}

export interface GenerationSummary extends GenerationMeta {
  hasThumb: boolean;
}

/** One NDJSON line emitted by /api/generate while it works. */
export type StreamEvent =
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "result"; generation: GenerationMeta; scad: string }
  | { type: "error"; message: string };
