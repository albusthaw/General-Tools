// Writes a note from a transcript with the template text saved on the note. A note
// is saved only when the AI service finished its answer: an answer cut off at the
// output limit is never saved as if it were the whole note. Every information gap
// marked in the transcript (a pause for a call or other sound) is pointed out in the
// note, whatever the template.
import { ProviderError } from "../../_shared/errors.ts";
import * as deepseek from "../../_shared/providers/deepseek.ts";
import * as gemini from "../../_shared/providers/gemini.ts";
import { cleanNote, gapTimes, noteSystem, noteUserPrompt, recordingMode, type Spelling, withGapSentences } from "../../_shared/prompts.ts";
import { getSecret } from "../../_shared/secrets.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import { runGeminiInteraction } from "../gemini-flow.ts";
import { FINISHED, type Job, type JobContext, JobError, later, type Outcome } from "../types.ts";

// Room for the whole note and the model's thinking, which both count toward the
// output limit. Current Gemini and DeepSeek writing models allow more than this.
export const NOTE_OUTPUT_TOKENS = 64_000;

const CUT_OFF_MESSAGE =
  "The note was longer than the chosen AI model can write in one answer, so it was not saved. Please try again, or ask an administrator to choose another note model in AI settings.";

interface NoteInfo {
  id: string;
  scribe_id: string;
  owner_id: string;
  template_body: string;
  provider: "gemini" | "deepseek";
  model: string;
  reasoning: boolean;
  spelling: Spelling;
  status: string;
}

export async function generateNote(job: Job, ctx: JobContext): Promise<Outcome> {
  const db = adminClient();
  const { data: note } = await db
    .from("notes")
    .select("id, scribe_id, owner_id, template_body, provider, model, reasoning, spelling, status")
    .eq("id", job.note_id)
    .maybeSingle<NoteInfo>();
  if (!note || note.status === "done") {
    await rpc("svc_job_done", { p_id: job.id, p_worker: ctx.workerId });
    return FINISHED;
  }
  const { data: scribe } = await db
    .from("scribes")
    .select("transcript, mode")
    .eq("id", note.scribe_id)
    .maybeSingle<{ transcript: string | null; mode: string }>();
  const transcript = scribe?.transcript?.trim() ?? "";
  // A Voice Note is one clinician dictating, and the rules say so.
  const mode = recordingMode(scribe?.mode);
  if (!transcript) {
    throw new JobError("No transcript.", "There is no transcript to write a note from.", false);
  }

  await rpc("svc_note_started", { p_note_id: note.id });
  const gaps = gapTimes(transcript);
  const system = noteSystem(note.spelling, mode, { gaps: gaps.length > 0 });
  const user = noteUserPrompt(note.template_body, transcript, mode, gaps);

  // Careful reasoning thinks at length, and the thinking uses the same output limit
  // as the note. After an answer was cut off, the note is written once more with
  // light thinking, which leaves the room to the note itself.
  const lighter = job.state.lighter === true;
  const careful = note.reasoning && !lighter;
  const keep = lighter ? { lighter: true } : {};

  let content = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  try {
    if (note.provider === "deepseek") {
      const apiKey = await getSecret("deepseek_api_key");
      if (!apiKey) throw new ProviderError("not_set_up", "deepseek", "No DeepSeek key saved.");
      const result = await deepseek.chat({
        apiKey,
        model: note.model,
        system,
        user,
        reasoning: careful,
        maxTokens: NOTE_OUTPUT_TOKENS,
        timeoutMs: Math.max(30_000, Math.min(150_000, ctx.remaining() - 5000)),
      });
      content = result.content;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } else {
      const apiKey = await getSecret("gemini_api_key");
      if (!apiKey) throw new ProviderError("not_set_up", "gemini", "No Gemini key saved.");
      let flow;
      try {
        flow = await runGeminiInteraction(ctx, apiKey, job.state, () => ({
          model: note.model,
          system_instruction: system,
          input: user,
          generation_config: { thinking_level: careful ? "high" : "low", max_output_tokens: NOTE_OUTPUT_TOKENS },
        }));
      } catch (error) {
        if (typeof job.state.interaction_id === "string") await gemini.deleteInteraction(apiKey, job.state.interaction_id);
        await ctx.saveState(keep).catch(() => {});
        throw error;
      }
      if (!flow.done) return later(4, flow.state);
      content = gemini.interactionText(flow.interaction);
      const usage = gemini.interactionUsage(flow.interaction);
      inputTokens = usage.inputTokens;
      outputTokens = usage.outputTokens;
      const id = gemini.interactionId(flow.interaction) ?? (typeof job.state.interaction_id === "string" ? job.state.interaction_id : "");
      if (id) await gemini.deleteInteraction(apiKey, id);
    }
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "too_long") {
      if (careful) return later(1, { lighter: true });
      throw new JobError(`Note cut off at the output limit (${note.provider} ${note.model}).`, CUT_OFF_MESSAGE, false);
    }
    throw error;
  }

  const written = cleanNote(content);
  if (!written) throw new ProviderError("invalid_output", note.provider, "The note came back empty.");
  const cleaned = withGapSentences(written, gaps);

  await rpc("svc_record_usage", {
    p_user: note.owner_id,
    p_kind: "note",
    p_provider: note.provider,
    p_model: note.model,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_audio_seconds: null,
    p_ok: true,
  }).catch(() => {});
  await rpc("svc_note_done", { p_job_id: job.id, p_worker: ctx.workerId, p_note_id: note.id, p_content: cleaned });
  return FINISHED;
}
