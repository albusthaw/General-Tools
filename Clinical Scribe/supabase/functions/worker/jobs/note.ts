// Writes a note from a transcript with the template text saved on the note.
import { ProviderError } from "../../_shared/errors.ts";
import * as deepseek from "../../_shared/providers/deepseek.ts";
import * as gemini from "../../_shared/providers/gemini.ts";
import { cleanNote, noteSystem, noteUserPrompt, recordingMode, type Spelling } from "../../_shared/prompts.ts";
import { getSecret } from "../../_shared/secrets.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import { runGeminiInteraction } from "../gemini-flow.ts";
import { FINISHED, type Job, type JobContext, JobError, later, type Outcome } from "../types.ts";

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
  const system = noteSystem(note.spelling, mode);
  const user = noteUserPrompt(note.template_body, transcript, mode);

  let content = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  if (note.provider === "deepseek") {
    const apiKey = await getSecret("deepseek_api_key");
    if (!apiKey) throw new ProviderError("not_set_up", "deepseek", "No DeepSeek key saved.");
    const result = await deepseek.chat({
      apiKey,
      model: note.model,
      system,
      user,
      reasoning: note.reasoning,
      maxTokens: 8192,
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
        generation_config: { thinking_level: note.reasoning ? "high" : "low", max_output_tokens: 8192 },
      }));
    } catch (error) {
      if (typeof job.state.interaction_id === "string") await gemini.deleteInteraction(apiKey, job.state.interaction_id);
      await ctx.saveState({}).catch(() => {});
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

  const cleaned = cleanNote(content);
  if (!cleaned) throw new ProviderError("invalid_output", note.provider, "The note came back empty.");

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
