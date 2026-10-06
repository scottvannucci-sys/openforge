import type { GenerateArgs } from "./base";
import { ProviderError, errorBody } from "./base";

function normalizeBase(baseUrl: string): string {
  let b = baseUrl.replace(/\/+$/, "");
  if (!/\/v1$/.test(b)) b += "/v1";
  return b;
}

/**
 * OpenAI-compatible chat-completions adapter (LM Studio, vLLM, llama.cpp
 * server, Ollama's /v1 shim, …). Streams SSE and accumulates the message.
 */
export async function generateOpenAICompatible(
  config: { baseUrl: string; apiKey: string },
  args: GenerateArgs,
): Promise<string> {
  const base = normalizeBase(config.baseUrl);
  const content: unknown = args.images.length
    ? [
        { type: "text", text: args.user },
        ...args.images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mime};base64,${img.base64}` },
        })),
      ]
    : args.user;

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: args.model,
        stream: true,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content },
        ],
      }),
      signal: args.signal,
    });
  } catch (e) {
    throw new ProviderError(`Could not reach ${base} — ${(e as Error).message}`);
  }
  if (!res.ok || !res.body) {
    throw new ProviderError(`Endpoint error ${res.status}: ${await errorBody(res)}`);
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
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let msg: { choices?: { delta?: { content?: string } }[] };
      try {
        msg = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = msg.choices?.[0]?.delta?.content;
      if (delta) {
        out += delta;
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

export async function listOpenAIModels(
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const res = await fetch(`${normalizeBase(baseUrl)}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new ProviderError(`Endpoint ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id).sort();
}
