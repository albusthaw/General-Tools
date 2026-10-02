// Live model lists from the AI services, for the choices in AI settings.
import { ProviderError, userMessage } from "../../_shared/errors.ts";
import { AppError } from "../../_shared/http.ts";
import * as deepseek from "../../_shared/providers/deepseek.ts";
import { ELEVENLABS_MODELS } from "../../_shared/providers/elevenlabs.ts";
import * as gemini from "../../_shared/providers/gemini.ts";
import { getSecret } from "../../_shared/secrets.ts";
import * as v from "../../_shared/validate.ts";
import type { AdminContext } from "../context.ts";

export async function list({ body }: AdminContext) {
  const provider = v.oneOf(body.provider, ["gemini", "deepseek", "elevenlabs"] as const, "service");
  const purpose = v.oneOf(body.purpose ?? "text", ["transcription", "text"] as const, "purpose");

  if (provider === "elevenlabs") return { models: ELEVENLABS_MODELS };

  const apiKey = await getSecret(provider === "gemini" ? "gemini_api_key" : "deepseek_api_key");
  if (!apiKey) return { models: [], needs_key: true };
  try {
    const models = provider === "gemini" ? await gemini.listModels(apiKey, purpose) : await deepseek.listModels(apiKey);
    return { models };
  } catch (error) {
    if (error instanceof ProviderError) throw new AppError(`provider_${error.kind}`, userMessage(error), 502);
    throw error;
  }
}
