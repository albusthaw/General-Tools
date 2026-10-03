// ElevenLabs Speech to Text (Scribe).
import { serviceBase } from "../env.ts";
import { ProviderError } from "../errors.ts";
import { send, sendJson } from "./request.ts";

export interface ElevenLabsWord {
  text: string;
  type?: string;
  start?: number;
  end?: number;
  speaker_id?: string | null;
}

export interface ElevenLabsResult {
  text: string;
  words: ElevenLabsWord[];
  languageCode: string | null;
  durationSeconds: number | null;
}

interface RawResult {
  text?: string;
  words?: ElevenLabsWord[];
  language_code?: string;
  audio_duration_secs?: number;
  transcripts?: RawResult[];
}

// Models offered in AI settings. ElevenLabs has no public list of speech-to-text
// models, so the current ones are listed here (scribe_v1 is retired); any other
// name can be typed in.
export const ELEVENLABS_MODELS = [
  { id: "scribe_v2_medical", label: "Scribe v2 Medical", note: "Made for clinical audio", recommended: true },
  { id: "scribe_v2", label: "Scribe v2", note: "General speech" },
];

// Zero retention is asked for in the address, not in the form: the query value
// enable_logging=false on POST /v1/speech-to-text (ElevenLabs API reference).
// ElevenLabs allows it only for Enterprise accounts and refuses it for others.
export function speechToTextUrl(zeroRetention: boolean): string {
  return `${serviceBase("elevenlabs")}/v1/speech-to-text${zeroRetention ? "?enable_logging=false" : ""}`;
}

// When a request with zero retention is refused, the same key and model are tried
// once without it. If that works, the refusal was about zero retention itself.
export async function explainRefusal(error: unknown, apiKey: string, model: string): Promise<unknown> {
  if (!(error instanceof ProviderError) || !(error.kind === "auth" || error.kind === "bad_request" || error.kind === "model")) return error;
  try {
    await checkKey(apiKey, model);
  } catch {
    return error;
  }
  return new ProviderError("retention", "elevenlabs", `Zero retention refused: ${error.message}`, error.status);
}

export async function transcribe(options: {
  apiKey: string;
  audio: Blob;
  filename: string;
  model: string;
  language?: string;
  zeroRetention?: boolean;
  timeoutMs: number;
}): Promise<ElevenLabsResult> {
  const form = new FormData();
  form.append("model_id", options.model);
  form.append("file", options.audio, options.filename);
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  if (options.language) form.append("language_code", options.language.split("-")[0]);

  const raw = await sendJson<RawResult>("elevenlabs", speechToTextUrl(Boolean(options.zeroRetention)), {
    method: "POST",
    headers: { "xi-api-key": options.apiKey, Accept: "application/json" },
    body: form,
  }, options.timeoutMs);

  if (typeof raw.text !== "string" && !Array.isArray(raw.transcripts)) {
    throw new ProviderError("invalid_output", "elevenlabs", "ElevenLabs answered without a transcript.");
  }
  // A multi-channel answer wraps transcripts per channel; join them in order.
  const parts = Array.isArray(raw.transcripts) && raw.transcripts.length > 0 ? raw.transcripts : [raw];
  const text = parts.map((part) => part.text ?? "").join("\n").trim();
  const words = parts.flatMap((part) => (Array.isArray(part.words) ? part.words : []));
  return {
    text,
    words,
    languageCode: raw.language_code ?? parts[0]?.language_code ?? null,
    durationSeconds: typeof raw.audio_duration_secs === "number" ? raw.audio_duration_secs : null,
  };
}

// One second of silence as a 16 kHz mono WAV file, used to check a key and model.
export function silentWav(seconds = 1): Blob {
  const rate = 16000;
  const samples = rate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  return new Blob([buffer], { type: "audio/wav" });
}

// Checks the key (and the chosen model) with a tiny silent clip, with zero
// retention when asked.
export async function checkKey(apiKey: string, model: string, zeroRetention = false): Promise<void> {
  const form = new FormData();
  form.append("model_id", model);
  form.append("file", silentWav(1), "check.wav");
  await send("elevenlabs", speechToTextUrl(zeroRetention), {
    method: "POST",
    headers: { "xi-api-key": apiKey, Accept: "application/json" },
    body: form,
  }, 30_000);
}
