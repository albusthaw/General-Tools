// Transcribes one audio part with the service chosen when the recording finished.
// Before any service is paid, the part's real length is measured from the file and
// the minutes are settled for it (svc_segment_measured).
import { audioSeconds } from "../../_shared/audio-length.ts";
import { ProviderError } from "../../_shared/errors.ts";
import * as elevenlabs from "../../_shared/providers/elevenlabs.ts";
import * as gemini from "../../_shared/providers/gemini.ts";
import { sleep } from "../../_shared/providers/request.ts";
import { TRANSCRIBE_SYSTEM } from "../../_shared/prompts.ts";
import { getSecret } from "../../_shared/secrets.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import { buildSpeakerTranscript } from "../../_shared/transcript.ts";
import { runGeminiInteraction } from "../gemini-flow.ts";
import { downloadAudio } from "../storage.ts";
import { FINISHED, type Job, type JobContext, JobError, later, type Outcome } from "../types.ts";

interface Segment {
  id: string;
  scribe_id: string;
  seq: number;
  storage_path: string;
  mime_type: string;
  duration_seconds: number;
  status: string;
  transcript: string | null;
  provider_duration_seconds: number | null;
  measured_seconds: number | null;
  audio_deleted: boolean;
}

interface ScribeInfo {
  id: string;
  owner_id: string;
  status: string;
  provider: "elevenlabs" | "gemini";
  model: string;
  language: string;
  zero_retention: boolean;
}

async function recordUsage(scribe: ScribeInfo, seconds: number | null, tokens: gemini.Usage | null): Promise<void> {
  await rpc("svc_record_usage", {
    p_user: scribe.owner_id,
    p_kind: "transcription",
    p_provider: scribe.provider,
    p_model: scribe.model,
    p_input_tokens: tokens?.inputTokens ?? null,
    p_output_tokens: tokens?.outputTokens ?? null,
    p_audio_seconds: seconds,
    p_ok: true,
  }).catch(() => {});
}

export async function transcribeSegment(job: Job, ctx: JobContext): Promise<Outcome> {
  const db = adminClient();
  const { data: segment } = await db
    .from("scribe_segments")
    .select("id, scribe_id, seq, storage_path, mime_type, duration_seconds, status, transcript, provider_duration_seconds, measured_seconds, audio_deleted")
    .eq("id", job.segment_id)
    .maybeSingle<Segment>();
  const { data: scribe } = segment
    ? await db
      .from("scribes")
      .select("id, owner_id, status, provider, model, language, zero_retention")
      .eq("id", segment.scribe_id)
      .maybeSingle<ScribeInfo>()
    : { data: null };

  // The recording was deleted or stopped: nothing to do.
  if (!segment || !scribe || scribe.status !== "processing") {
    await rpc("svc_job_done", { p_id: job.id, p_worker: ctx.workerId });
    return FINISHED;
  }
  if (segment.status === "done") {
    await rpc("svc_segment_done", {
      p_job_id: job.id,
      p_worker: ctx.workerId,
      p_segment_id: segment.id,
      p_transcript: segment.transcript ?? "",
      p_provider_duration: segment.provider_duration_seconds,
    });
    return FINISHED;
  }
  if (segment.audio_deleted) {
    throw new JobError("Audio already deleted.", "The audio for this recording is no longer available.", false);
  }

  await rpc("svc_segment_started", { p_segment_id: segment.id });

  // A part is measured once; a later attempt or "Try again" uses the saved length.
  let audio: Blob | null = null;
  if (segment.measured_seconds === null) {
    audio = await downloadAudio(segment.storage_path);
    const seconds = audioSeconds(new Uint8Array(await audio.arrayBuffer()), segment.mime_type);
    const verdict = await rpc<string>("svc_segment_measured", {
      p_segment_id: segment.id,
      p_measured: seconds,
      p_byte_size: audio.size,
    });
    if (verdict === "gone") {
      await rpc("svc_job_done", { p_id: job.id, p_worker: ctx.workerId });
      return FINISHED;
    }
    if (verdict !== "ok") {
      throw new JobError(`Part ${segment.seq} refused when measured: ${verdict} (${seconds ?? "no"} seconds).`, MEASURE_MESSAGES[verdict] ?? MEASURE_MESSAGES.unreadable, false);
    }
  }

  return scribe.provider === "elevenlabs"
    ? await withElevenLabs(job, ctx, segment, scribe, audio)
    : await withGemini(job, ctx, segment, scribe, audio);
}

// What the person sees when a part cannot be processed for its length.
const MEASURE_MESSAGES: Record<string, string> = {
  not_enough_credit: "There are not enough transcription minutes for the real length of this recording. Ask your administrator to add more, then use Try again.",
  too_long: "This recording is longer than the longest recording allowed, so it was not processed.",
  changed: "The audio of this recording changed after it was saved, so it was not processed.",
  unreadable: "The length of this recording's audio could not be checked, so it was not processed. Please record again.",
};

async function withElevenLabs(job: Job, ctx: JobContext, segment: Segment, scribe: ScribeInfo, downloaded: Blob | null): Promise<Outcome> {
  const apiKey = await getSecret("elevenlabs_api_key");
  if (!apiKey) throw new ProviderError("not_set_up", "elevenlabs", "No ElevenLabs key saved.");

  const audio = downloaded ?? await downloadAudio(segment.storage_path);
  const extension = segment.storage_path.split(".").pop() ?? "webm";
  let result: elevenlabs.ElevenLabsResult;
  try {
    result = await elevenlabs.transcribe({
      apiKey,
      audio,
      filename: `part-${segment.seq}.${extension}`,
      model: scribe.model,
      language: scribe.language,
      zeroRetention: scribe.zero_retention,
      timeoutMs: Math.max(30_000, Math.min(150_000, ctx.remaining() - 5000)),
    });
  } catch (error) {
    throw scribe.zero_retention ? await elevenlabs.explainRefusal(error, apiKey, scribe.model) : error;
  }
  const transcript = buildSpeakerTranscript(
    result.words.map((word) => ({ text: word.text, type: word.type, speaker: word.speaker_id ?? null })),
    result.text,
  );

  await recordUsage(scribe, result.durationSeconds ?? Number(segment.duration_seconds), null);
  await rpc("svc_segment_done", {
    p_job_id: job.id,
    p_worker: ctx.workerId,
    p_segment_id: segment.id,
    p_transcript: transcript,
    p_provider_duration: result.durationSeconds,
  });
  return FINISHED;
}

function transcriptionBody(model: string, uri: string, mime: string, language: string): Record<string, unknown> {
  if (gemini.isTranscribeModel(model)) {
    return {
      model,
      input: [{ type: "audio", uri, mime_type: mime }],
      generation_config: {
        transcription_config: {
          language_codes: language ? [language] : [],
          // Word timings are what carry the speaker labels.
          mode: { type: "verbatim", diarization_mode: "speaker", timestamp_granularities: ["word"] },
        },
      },
    };
  }
  return {
    model,
    system_instruction: TRANSCRIBE_SYSTEM,
    input: [
      { type: "text", text: language ? `Transcribe this recording. Its main language is ${language}.` : "Transcribe this recording." },
      { type: "audio", uri, mime_type: mime },
    ],
    generation_config: { thinking_level: "low", max_output_tokens: 32768 },
  };
}

async function withGemini(job: Job, ctx: JobContext, segment: Segment, scribe: ScribeInfo, downloaded: Blob | null): Promise<Outcome> {
  const apiKey = await getSecret("gemini_api_key");
  if (!apiKey) throw new ProviderError("not_set_up", "gemini", "No Gemini key saved.");
  const mime = gemini.geminiMime(segment.mime_type);
  let state: Record<string, unknown> = { ...job.state };

  try {
    if (typeof state.file_name !== "string") {
      const audio = downloaded ?? await downloadAudio(segment.storage_path);
      const file = await gemini.uploadFile(apiKey, audio, mime, `clinical-scribe-part-${segment.seq}`, 90_000);
      state = { file_name: file.name, file_uri: file.uri, file_ready: file.state === "ACTIVE" || !file.state };
      await ctx.saveState(state);
    }

    // Large files may need a moment before Gemini can use them.
    if (!state.file_ready) {
      for (let i = 0; i < 10 && ctx.remaining() > 15_000; i++) {
        const file = await gemini.getFile(apiKey, String(state.file_name));
        if (file.state === "FAILED") throw new ProviderError("bad_request", "gemini", "Gemini could not process the audio file.");
        if (file.state === "ACTIVE" || !file.state) {
          state = { ...state, file_ready: true };
          await ctx.saveState(state);
          break;
        }
        await sleep(2000);
      }
      if (!state.file_ready) return later(5, state);
    }

    const flow = await runGeminiInteraction(
      ctx,
      apiKey,
      state,
      () => transcriptionBody(scribe.model, String(state.file_uri), mime, scribe.language),
    );
    if (!flow.done) return later(5, flow.state);

    const interaction = flow.interaction;
    const text = gemini.interactionText(interaction);
    const transcript = gemini.isTranscribeModel(scribe.model)
      ? buildSpeakerTranscript(gemini.interactionWords(interaction), text)
      : text.trim();
    const usage = gemini.interactionUsage(interaction);
    const seconds = gemini.audioSecondsFromTokens(usage.audioTokens);

    await recordUsage(scribe, seconds ?? Number(segment.duration_seconds), usage);
    await rpc("svc_segment_done", {
      p_job_id: job.id,
      p_worker: ctx.workerId,
      p_segment_id: segment.id,
      p_transcript: transcript,
      p_provider_duration: seconds,
    });

    // Remove the audio and the stored result from Google straight away.
    const id = gemini.interactionId(interaction) ?? (typeof state.interaction_id === "string" ? state.interaction_id : "");
    await Promise.all([
      id ? gemini.deleteInteraction(apiKey, id) : Promise.resolve(),
      gemini.deleteFile(apiKey, String(state.file_name)),
    ]);
    return FINISHED;
  } catch (error) {
    // Start afresh on the next attempt, and leave nothing behind at Google.
    await Promise.all([
      typeof state.interaction_id === "string" ? gemini.deleteInteraction(apiKey, state.interaction_id) : Promise.resolve(),
      typeof state.file_name === "string" ? gemini.deleteFile(apiKey, state.file_name) : Promise.resolve(),
    ]);
    await ctx.saveState({}).catch(() => {});
    throw error;
  }
}
