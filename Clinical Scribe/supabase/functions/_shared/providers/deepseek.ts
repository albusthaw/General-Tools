// DeepSeek chat completions (OpenAI format), streamed so long answers keep the
// connection alive.
import { serviceBase } from "../env.ts";
import { ProviderError } from "../errors.ts";
import { send, sendJson } from "./request.ts";

export interface ChatResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function chat(options: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  json?: boolean;
  reasoning?: boolean;
  maxTokens: number;
  timeoutMs: number;
}): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: options.reasoning ? "enabled" : "disabled" },
    max_tokens: options.maxTokens,
  };
  if (!options.reasoning) body.temperature = 0.2;
  if (options.json) body.response_format = { type: "json_object" };

  const response = await send("deepseek", `${serviceBase("deepseek")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  }, options.timeoutMs);

  return await readStream(response, options.timeoutMs);
}

// Reads the server-sent events stream and joins the answer text.
export async function readStream(response: Response, timeoutMs: number): Promise<ChatResult> {
  if (!response.body) throw new ProviderError("invalid_output", "deepseek", "DeepSeek sent an empty answer.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const deadline = Date.now() + timeoutMs;
  let buffer = "";
  let content = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let finished = false;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      finished = true;
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event.error) {
      throw new ProviderError("unavailable", "deepseek", `DeepSeek stream error: ${JSON.stringify(event.error).slice(0, 300)}`);
    }
    const choices = Array.isArray(event.choices) ? event.choices : [];
    for (const choice of choices) {
      const delta = (choice as Record<string, unknown>).delta as Record<string, unknown> | undefined;
      if (delta && typeof delta.content === "string") content += delta.content;
    }
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      if (typeof usage.prompt_tokens === "number") inputTokens = usage.prompt_tokens;
      if (typeof usage.completion_tokens === "number") outputTokens = usage.completion_tokens;
    }
  };

  // Each read waits no longer than the time that is left.
  const readChunk = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new ProviderError("timeout", "deepseek", "DeepSeek did not finish in time."));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError("timeout", "deepseek", "DeepSeek did not finish in time.")), remaining);
    });
    return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
  };

  try {
    while (!finished) {
      const { value, done } = await readChunk();
      if (done) break;
      buffer += value;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    if (buffer) handleLine(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return { content, inputTokens, outputTokens };
}

export interface ModelChoice {
  id: string;
  label: string;
}

export async function listModels(apiKey: string): Promise<ModelChoice[]> {
  const result = await sendJson<{ data?: Array<{ id?: string }> }>("deepseek", `${serviceBase("deepseek")}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 20_000);
  return (result.data ?? [])
    .map((model) => String(model.id ?? ""))
    .filter((id) => /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(id))
    .sort()
    .map((id) => ({ id, label: id }));
}

export async function checkKey(apiKey: string): Promise<void> {
  await listModels(apiKey);
}
