// Drafts or revises a note template with the template service chosen in AI settings.
import type { Caller } from "../_shared/auth.ts";
import { ProviderError, type ProviderName, userMessage } from "../_shared/errors.ts";
import { AppError } from "../_shared/http.ts";
import * as deepseek from "../_shared/providers/deepseek.ts";
import * as gemini from "../_shared/providers/gemini.ts";
import {
  parseTemplateDraft,
  TEMPLATE_SYSTEM,
  type TemplateDraft,
  templateDraftPrompt,
  templateRevisePrompt,
} from "../_shared/prompts.ts";
import { getSecret, scrub } from "../_shared/secrets.ts";
import { adminClient, rpc } from "../_shared/supabase.ts";

const DRAFTS_PER_HOUR = 20;
const TIMEOUT_MS = 110_000;

interface TemplateSettings {
  template_provider: "gemini" | "deepseek";
  gemini_template_model: string;
  deepseek_template_model: string;
}

async function settings(): Promise<{ provider: ProviderName; model: string }> {
  const { data, error } = await adminClient()
    .from("app_settings")
    .select("template_provider, gemini_template_model, deepseek_template_model")
    .eq("id", true)
    .single<TemplateSettings>();
  if (error || !data) throw new Error("Settings could not be read.");
  return data.template_provider === "deepseek"
    ? { provider: "deepseek", model: data.deepseek_template_model }
    : { provider: "gemini", model: data.gemini_template_model };
}

async function ask(provider: ProviderName, model: string, apiKey: string, prompt: string) {
  if (provider === "deepseek") {
    const result = await deepseek.chat({
      apiKey,
      model,
      system: TEMPLATE_SYSTEM,
      user: prompt,
      json: true,
      maxTokens: 4096,
      timeoutMs: TIMEOUT_MS,
    });
    return { text: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  }
  const interaction = await gemini.createInteraction(apiKey, {
    model,
    system_instruction: TEMPLATE_SYSTEM,
    input: prompt,
    generation_config: { thinking_level: "low", max_output_tokens: 4096 },
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
        },
        required: ["name", "description", "body"],
      },
    },
    store: false,
  }, TIMEOUT_MS);
  if (gemini.interactionState(interaction) === "failed") {
    throw new ProviderError("unavailable", "gemini", `Template draft failed: ${gemini.interactionError(interaction)}`);
  }
  const usage = gemini.interactionUsage(interaction);
  return { text: gemini.interactionText(interaction), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

export async function draftTemplate(
  caller: Caller,
  request: { mode: "draft"; description: string } | { mode: "revise"; current: TemplateDraft; changes: string },
): Promise<TemplateDraft> {
  const used = await rpc<number>("svc_template_drafts_last_hour", { p_user: caller.id });
  if ((used ?? 0) >= DRAFTS_PER_HOUR) {
    throw new AppError("too_many", "You have made a lot of drafts in the last hour. Please try again a little later.", 429);
  }

  const { provider, model } = await settings();
  const keyName = provider === "deepseek" ? "deepseek_api_key" : "gemini_api_key";
  const apiKey = await getSecret(keyName);
  if (!apiKey) {
    throw new AppError("not_set_up", "The template helper is not set up yet. Ask your administrator to add the service key in AI settings.", 409);
  }

  const prompt = request.mode === "draft"
    ? templateDraftPrompt(request.description)
    : templateRevisePrompt(request.current, request.changes);

  let ok = false;
  let tokens: { inputTokens: number | null; outputTokens: number | null } = { inputTokens: null, outputTokens: null };
  try {
    // One more try if the answer cannot be read as a template.
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await ask(provider, model, apiKey, prompt);
      tokens = answer;
      const draft = parseTemplateDraft(answer.text);
      if (draft) {
        ok = true;
        return draft;
      }
    }
    throw new AppError("unreadable", "The template could not be created this time. Please try again, perhaps with a little more detail.", 502);
  } catch (error) {
    if (error instanceof ProviderError) {
      console.warn(`Template draft failed: ${scrub(error.message)}`);
      throw new AppError(`provider_${error.kind}`, userMessage(error), error.kind === "rate" ? 429 : 502);
    }
    throw error;
  } finally {
    await rpc("svc_record_usage", {
      p_user: caller.id,
      p_kind: "template",
      p_provider: provider,
      p_model: model,
      p_input_tokens: tokens.inputTokens,
      p_output_tokens: tokens.outputTokens,
      p_audio_seconds: null,
      p_ok: ok,
    }).catch(() => {});
  }
}
