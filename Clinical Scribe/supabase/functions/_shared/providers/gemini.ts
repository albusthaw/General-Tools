// Gemini: Files API (audio upload) and Interactions API (transcription and writing).
import { serviceBase } from "../env.ts";
import { ProviderError } from "../errors.ts";
import { type ModelChoice, mergeChoices } from "../models.ts";
import { send, sendJson } from "./request.ts";

export interface GeminiFile {
  name: string;
  uri: string;
  mimeType?: string;
  state?: string;
}

// deno-lint-ignore no-explicit-any
export type Interaction = Record<string, any>;

function base(): string {
  return serviceBase("gemini");
}

function headers(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "x-goog-api-key": apiKey, ...extra };
}

// Gemini expects M4A for the MP4 audio that Safari records.
export function geminiMime(mime: string): string {
  return mime === "audio/mp4" || mime === "audio/x-m4a" ? "audio/m4a" : mime;
}

export async function uploadFile(
  apiKey: string,
  audio: Blob,
  mime: string,
  displayName: string,
  timeoutMs: number,
): Promise<GeminiFile> {
  const start = await send("gemini", `${base()}/upload/v1beta/files`, {
    method: "POST",
    headers: headers(apiKey, {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(audio.size),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ file: { display_name: displayName } }),
  }, 30_000);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  await start.body?.cancel();
  if (!uploadUrl) throw new ProviderError("invalid_output", "gemini", "Gemini did not return an upload address.");
  // Only ever send audio back to the Gemini service itself.
  if (new URL(uploadUrl).origin !== new URL(base()).origin) {
    throw new ProviderError("invalid_output", "gemini", "Gemini returned an unexpected upload address.");
  }

  const result = await sendJson<{ file?: GeminiFile }>("gemini", uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: audio,
  }, timeoutMs);
  if (!result.file?.name || !result.file?.uri) {
    throw new ProviderError("invalid_output", "gemini", "Gemini did not confirm the upload.");
  }
  return result.file;
}

function checkFileName(name: string): string {
  if (!/^files\/[A-Za-z0-9_-]+$/.test(name)) throw new ProviderError("invalid_output", "gemini", "Unexpected file name.");
  return name;
}

export async function getFile(apiKey: string, name: string): Promise<GeminiFile> {
  return await sendJson<GeminiFile>("gemini", `${base()}/v1beta/${checkFileName(name)}`, {
    method: "GET",
    headers: headers(apiKey),
  }, 20_000);
}

export async function deleteFile(apiKey: string, name: string): Promise<void> {
  try {
    await send("gemini", `${base()}/v1beta/${checkFileName(name)}`, { method: "DELETE", headers: headers(apiKey) }, 15_000);
  } catch {
    // Files expire on their own after 48 hours.
  }
}

function interactionPath(id: string): string {
  if (!/^[A-Za-z0-9/_.-]{1,200}$/.test(id) || id.includes("..")) {
    throw new ProviderError("invalid_output", "gemini", "Unexpected interaction id.");
  }
  return id.startsWith("interactions/") ? id : `interactions/${id}`;
}

export async function createInteraction(apiKey: string, body: Record<string, unknown>, timeoutMs: number): Promise<Interaction> {
  return await sendJson<Interaction>("gemini", `${base()}/v1beta/interactions`, {
    method: "POST",
    headers: headers(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }, timeoutMs);
}

// Runs in Gemini's background mode when it is available, so long work never has to
// fit inside one function call. Falls back to a direct answer otherwise.
export async function startInteraction(
  apiKey: string,
  body: Record<string, unknown>,
  directTimeoutMs: number,
): Promise<{ interaction: Interaction; background: boolean }> {
  try {
    const interaction = await createInteraction(apiKey, { ...body, background: true, store: true }, 60_000);
    return { interaction, background: true };
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "bad_request" && /background|store/i.test(error.message)) {
      const interaction = await createInteraction(apiKey, { ...body, store: false }, directTimeoutMs);
      return { interaction, background: false };
    }
    throw error;
  }
}

export async function getInteraction(apiKey: string, id: string): Promise<Interaction> {
  return await sendJson<Interaction>("gemini", `${base()}/v1beta/${interactionPath(id)}`, {
    method: "GET",
    headers: headers(apiKey),
  }, 20_000);
}

export async function deleteInteraction(apiKey: string, id: string): Promise<void> {
  try {
    await send("gemini", `${base()}/v1beta/${interactionPath(id)}`, { method: "DELETE", headers: headers(apiKey) }, 15_000);
  } catch {
    // Stored interactions also expire on their own.
  }
}

// Collects text written by the model, skipping any reasoning ("thinking") parts.
export function interactionText(interaction: Interaction): string {
  if (typeof interaction?.output_text === "string" && interaction.output_text.trim()) return interaction.output_text;
  const texts: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
    if (type === "thinking" || type === "thought" || type === "user_input" || obj.thought === true) return;
    if (type === "text" && typeof obj.text === "string") {
      texts.push(obj.text);
      return;
    }
    for (const key of ["steps", "outputs", "content", "parts", "model_output"]) {
      if (key in obj) visit(obj[key], depth + 1);
    }
  };
  visit(interaction?.steps, 0);
  if (texts.length === 0) visit(interaction?.outputs, 0);
  return texts.join("");
}

export interface WordInfo {
  text: string;
  speaker: string | null;
}

// Word-level speaker labels from the transcription model.
export function interactionWords(interaction: Interaction): WordInfo[] {
  const words: WordInfo[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "word_info" && typeof obj.text === "string") {
      words.push({ text: obj.text, speaker: typeof obj.speaker === "string" ? obj.speaker : null });
      return;
    }
    for (const key of ["steps", "outputs", "content", "annotations"]) {
      if (key in obj) visit(obj[key], depth + 1);
    }
  };
  visit(interaction?.steps ?? interaction?.outputs, 0);
  return words;
}

export type InteractionState = "done" | "running" | "failed";

export function interactionState(interaction: Interaction): InteractionState {
  const status = String(interaction?.status ?? "").toLowerCase();
  if (["completed", "complete", "succeeded", "done"].includes(status)) return "done";
  // "requires_action" only happens with tools, which are never used here.
  if (["failed", "cancelled", "canceled", "expired", "error", "requires_action"].includes(status)) return "failed";
  // Stopped early (for example at the output limit): use the text if there is any.
  if (status === "incomplete" || status === "budget_exceeded") return interactionText(interaction).trim() ? "done" : "failed";
  if (!status && interactionText(interaction).trim()) return "done";
  return "running";
}

export function interactionId(interaction: Interaction): string | null {
  const id = interaction?.id ?? interaction?.name;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function interactionError(interaction: Interaction): string {
  const error = interaction?.error;
  if (error && typeof error === "object") return String((error as Record<string, unknown>).message ?? "").slice(0, 300);
  return typeof error === "string" ? error.slice(0, 300) : "";
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  audioTokens: number | null;
}

export function interactionUsage(interaction: Interaction): Usage {
  const usage = (interaction?.usage ?? interaction?.usage_metadata ?? {}) as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  let audio: number | null = null;
  const byModality = usage.input_tokens_by_modality ?? usage.prompt_tokens_details;
  if (Array.isArray(byModality)) {
    for (const entry of byModality) {
      const item = entry as Record<string, unknown>;
      if (/audio/i.test(String(item.modality ?? ""))) audio = num(item.tokens ?? item.token_count);
    }
  }
  return {
    inputTokens: num(usage.total_input_tokens ?? usage.input_tokens ?? usage.prompt_token_count),
    outputTokens: num(usage.total_output_tokens ?? usage.output_tokens ?? usage.candidates_token_count),
    audioTokens: audio,
  };
}

// Gemini counts 32 tokens for each second of audio.
export function audioSecondsFromTokens(tokens: number | null): number | null {
  return tokens && tokens > 0 ? Math.round((tokens / 32) * 100) / 100 : null;
}

export type Purpose = "transcription" | "text";

// Models known to work for each job, shown first and marked. Gemini's own list
// adds the others it offers to the key.
export const GEMINI_MODELS: Record<Purpose, ModelChoice[]> = {
  transcription: [
    { id: "gemini-3.5-transcribe", label: "Gemini 3.5 Transcribe", note: "Made for transcription, with speaker labels", recommended: true },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "General model that also accepts audio" },
  ],
  text: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Fast and capable", recommended: true },
  ],
};

const NOT_FOR_TEXT =
  /(image|tts|live|embedding|robotics|veo|lyria|imagen|aqa|computer-use|native-audio|translate|omni|deep-research|antigravity|nano-banana|transcribe)/i;

// Which models from Gemini's list suit a job. Transcription offers only models made
// for it, and never the live-streaming ones, which cannot take a recorded file.
export function suitsPurpose(id: string, purpose: Purpose): boolean {
  if (!/^gemini-/.test(id)) return false;
  if (purpose === "transcription") return /transcribe/i.test(id) && !/live/i.test(id);
  return !NOT_FOR_TEXT.test(id);
}

/** Every model Gemini offers to this key, as { id, label }. */
export async function availableModels(apiKey: string): Promise<ModelChoice[]> {
  const found = new Map<string, ModelChoice>();
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url = `${base()}/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const result = await sendJson<{ models?: Array<Record<string, unknown>>; nextPageToken?: string }>(
      "gemini",
      url,
      { method: "GET", headers: headers(apiKey) },
      20_000,
    );
    for (const model of result.models ?? []) {
      const id = String(model.name ?? "").replace(/^models\//, "");
      if (/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(id)) found.set(id, { id, label: String(model.displayName ?? id).slice(0, 80) });
    }
    pageToken = result.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return [...found.values()];
}

/** The choices for one job, from the models Gemini offers to the key. */
export function choicesFor(purpose: Purpose, available: ModelChoice[]): ModelChoice[] {
  return mergeChoices(GEMINI_MODELS[purpose], available.filter((m) => suitsPurpose(m.id, purpose)), available);
}

export async function checkKey(apiKey: string): Promise<void> {
  await sendJson("gemini", `${base()}/v1beta/models?pageSize=1`, { method: "GET", headers: headers(apiKey) }, 20_000);
}

export function isTranscribeModel(model: string): boolean {
  return /transcribe/i.test(model);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function checkTest(interaction: Interaction, purpose: Purpose): void {
  if (interactionState(interaction) !== "failed") return;
  const detail = interactionError(interaction) || "no answer";
  throw new ProviderError(purpose === "transcription" ? "bad_request" : "invalid_output", "gemini", `Test failed: ${detail}`);
}

// Tiny requests that show whether a model works for a job with this key.
export async function testText(apiKey: string, model: string): Promise<void> {
  const interaction = await createInteraction(apiKey, {
    model,
    input: "Reply with the single word: ready",
    generation_config: { thinking_level: "low", max_output_tokens: 256 },
    store: false,
  }, 60_000);
  checkTest(interaction, "text");
}

export async function testAudio(apiKey: string, model: string, wav: Uint8Array): Promise<void> {
  const audio = { type: "audio", data: toBase64(wav), mime_type: "audio/wav" };
  const body = isTranscribeModel(model)
    ? { model, input: [audio], generation_config: { transcription_config: { mode: { type: "verbatim" } } }, store: false }
    : {
      model,
      input: [{ type: "text", text: "Transcribe this recording." }, audio],
      generation_config: { thinking_level: "low", max_output_tokens: 256 },
      store: false,
    };
  checkTest(await createInteraction(apiKey, body, 60_000), "transcription");
}
