import type { ChatImage, GenerateArgs } from "./base";
import { ProviderError, errorBody } from "./base";

/**
 * Ollama adapter. Streams /api/chat so long generations don't trip idle
 * timeouts, and reports progress back to the build log.
 */
export async function generateOllama(
  config: { baseUrl: string },
  args: GenerateArgs,
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, "");
  const messages: unknown[] = [
    { role: "system", content: args.system },
    {
      role: "user",
      content: args.user,
      ...(args.images.length ? { images: args.images.map((i: ChatImage) => i.base64) } : {}),
    },
  ];

  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: args.model, messages, stream: true }),
      signal: args.signal,
    });
  } catch (e) {
    throw new ProviderError(
      `Could not reach Ollama at ${base}. Is it running? (${(e as Error).message})`,
    );
  }
  if (!res.ok || !res.body) {
    throw new ProviderError(
      `Ollama error ${res.status}: ${await errorBody(res)}. Is "${args.model}" installed? Try: ollama pull ${args.model}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  let lastReport = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: { message?: { content?: string }; error?: string; done?: boolean };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.error) throw new ProviderError(`Ollama: ${msg.error}`);
      if (msg.message?.content) {
        out += msg.message.content;
        const now = Date.now();
        if (args.onProgress && now - lastReport > 900) {
          lastReport = now;
          args.onProgress(`model writing… ${out.length.toLocaleString()} chars`);
        }
      }
    }
  }
  return out;
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/tags`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new ProviderError(`Ollama ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name).sort();
}
