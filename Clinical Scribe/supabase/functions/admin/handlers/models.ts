// Model choices in AI settings: lists kept up to date from each AI service, and
// tiny test requests that show whether the chosen models work with the saved keys.
import { ProviderError, userMessage } from "../../_shared/errors.ts";
import type { ModelChoice } from "../../_shared/models.ts";
import * as deepseek from "../../_shared/providers/deepseek.ts";
import * as elevenlabs from "../../_shared/providers/elevenlabs.ts";
import * as gemini from "../../_shared/providers/gemini.ts";
import { getSecret, type SecretName } from "../../_shared/secrets.ts";
import { rpc } from "../../_shared/supabase.ts";
import * as v from "../../_shared/validate.ts";
import type { AdminContext } from "../context.ts";

type Provider = "elevenlabs" | "gemini" | "deepseek";
type Purpose = "transcription" | "text";

interface ModelList {
  provider: Provider;
  purpose: Purpose;
  models: ModelChoice[];
  source: "service" | "built_in";
  updated_at: string | null;
}

const LISTS: Array<[Provider, Purpose]> = [
  ["elevenlabs", "transcription"],
  ["gemini", "transcription"],
  ["gemini", "text"],
  ["deepseek", "text"],
];

const NAMES: Record<Provider, string> = { elevenlabs: "ElevenLabs", gemini: "Gemini", deepseek: "DeepSeek" };
const KEYS: Record<Provider, SecretName> = {
  elevenlabs: "elevenlabs_api_key",
  gemini: "gemini_api_key",
  deepseek: "deepseek_api_key",
};

function builtIn(provider: Provider, purpose: Purpose): ModelChoice[] {
  if (provider === "elevenlabs") return elevenlabs.ELEVENLABS_MODELS;
  if (provider === "gemini") return gemini.GEMINI_MODELS[purpose];
  return deepseek.DEEPSEEK_MODELS;
}

// The saved lists, with the built-in ones where nothing has been saved yet.
export async function catalog(_: AdminContext): Promise<{ lists: ModelList[] }> {
  const saved = (await rpc<ModelList[]>("svc_model_catalog")) ?? [];
  return {
    lists: LISTS.map(([provider, purpose]) =>
      saved.find((row) => row.provider === provider && row.purpose === purpose) ??
        { provider, purpose, models: builtIn(provider, purpose), source: "built_in", updated_at: null }
    ),
  };
}

// Asks each service with a saved key for the models it offers now, and saves the
// lists. ElevenLabs publishes no list, so its current models are built in.
export async function refresh(ctx: AdminContext) {
  const problems: Array<{ provider: Provider; message: string }> = [];
  const lists: Array<Omit<ModelList, "updated_at">> = [];
  let geminiModels: ModelChoice[] | null = null;
  let deepseekModels: ModelChoice[] | null = null;

  for (const provider of ["gemini", "deepseek"] as const) {
    const apiKey = await getSecret(KEYS[provider]);
    if (!apiKey) {
      problems.push({ provider, message: `Save the ${NAMES[provider]} key to get its current list.` });
      continue;
    }
    try {
      if (provider === "gemini") geminiModels = await gemini.availableModels(apiKey);
      else deepseekModels = await deepseek.listModels(apiKey);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      problems.push({ provider, message: userMessage(error) });
    }
  }

  for (const [provider, purpose] of LISTS) {
    if (provider === "gemini" && geminiModels) {
      lists.push({ provider, purpose, models: gemini.choicesFor(purpose, geminiModels), source: "service" });
    } else if (provider === "deepseek" && deepseekModels) {
      lists.push({ provider, purpose, models: deepseekModels, source: "service" });
    } else {
      lists.push({ provider, purpose, models: builtIn(provider, purpose), source: "built_in" });
    }
  }

  await rpc("svc_save_model_catalog", { p_entries: lists, p_actor: ctx.caller.id, p_user_agent: ctx.caller.userAgent });
  return { ...(await catalog(ctx)), problems };
}

function testMessage(error: ProviderError, job: string): string {
  switch (error.kind) {
    case "auth":
      return `${NAMES[error.provider]} refused the saved key. Check it under Service keys.`;
    case "quota":
      return `The ${NAMES[error.provider]} account has no credit left.`;
    case "model":
      return "This model is not available to your account. Choose another one.";
    case "bad_request":
      return job === "transcription" ? "This model did not accept audio. Choose a model marked as recommended." : "This model did not accept the request. Choose another one.";
    case "rate":
      return `${NAMES[error.provider]} is busy. Try again in a minute.`;
    case "timeout":
      return "There was no answer in time. Try again.";
    case "invalid_output":
      return "The model answered, but not in a usable way. Choose another one.";
    default:
      return `${NAMES[error.provider]} had a problem. Try again later.`;
  }
}

async function testOne(job: string, provider: Provider, model: string): Promise<{ ok: boolean; message: string }> {
  const apiKey = await getSecret(KEYS[provider]);
  if (!apiKey) return { ok: false, message: `Save the ${NAMES[provider]} key first.` };
  try {
    if (job === "transcription" && provider === "elevenlabs") {
      await elevenlabs.checkKey(apiKey, model);
    } else if (job === "transcription") {
      await gemini.testAudio(apiKey, model, new Uint8Array(await elevenlabs.silentWav(1).arrayBuffer()));
    } else if (provider === "gemini") {
      await gemini.testText(apiKey, model);
    } else {
      await deepseek.testText(apiKey, model);
    }
    return { ok: true, message: "Works." };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return { ok: false, message: testMessage(error, job) };
  }
}

// Sends each chosen model a tiny request: a second of silence for transcription,
// a one-word question for writing.
export async function test({ body }: AdminContext) {
  const results = [];
  for (const job of ["transcription", "notes", "templates"] as const) {
    const choice = body[job];
    if (!choice || typeof choice !== "object") continue;
    const picked = choice as Record<string, unknown>;
    const allowed = job === "transcription" ? (["elevenlabs", "gemini"] as const) : (["gemini", "deepseek"] as const);
    const provider = v.oneOf(picked.provider, allowed, "service") as Provider;
    const model = v.modelName(picked.model);
    results.push({ job, provider, model, ...(await testOne(job, provider, model)) });
  }
  return { results };
}
