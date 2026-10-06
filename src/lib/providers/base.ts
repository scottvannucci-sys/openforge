export interface ChatImage {
  base64: string;
  mime: string;
}

export interface GenerateArgs {
  model: string;
  system: string;
  user: string;
  images: ChatImage[];
  onProgress?: (note: string) => void;
  signal?: AbortSignal;
  /** Scratch dir for adapters that need temp files (codex image input). */
  workDir: string;
}

export interface ProviderConfig {
  ollama: { baseUrl: string; model: string };
  openai: { baseUrl: string; apiKey: string; model: string };
  codex: { model: string };
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function errorBody(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 400);
  } catch {
    return res.statusText;
  }
}
