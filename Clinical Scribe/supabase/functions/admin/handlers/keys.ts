// Saving, removing and checking the AI service keys. Keys go straight into Vault
// and are never sent back to the browser.
import { ProviderError, userMessage } from "../../_shared/errors.ts";
import { AppError } from "../../_shared/http.ts";
import * as deepseek from "../../_shared/providers/deepseek.ts";
import * as elevenlabs from "../../_shared/providers/elevenlabs.ts";
import * as gemini from "../../_shared/providers/gemini.ts";
import { forgetSecret, getSecret, rememberSecret, type SecretName } from "../../_shared/secrets.ts";
import { adminClient, rpc } from "../../_shared/supabase.ts";
import * as v from "../../_shared/validate.ts";
import type { AdminContext } from "../context.ts";

const KEY_NAMES = ["gemini_api_key", "elevenlabs_api_key", "deepseek_api_key"] as const;

export async function save({ caller, body }: AdminContext) {
  const name = v.oneOf(body.name, KEY_NAMES, "service");
  const value = v.serviceKey(body.value);
  rememberSecret(value);
  await rpc("svc_set_secret", { p_name: name, p_value: value, p_actor: caller.id, p_user_agent: caller.userAgent });
  forgetSecret(name as SecretName);
  return { saved: true, last4: value.slice(-4) };
}

export async function remove({ caller, body }: AdminContext) {
  const name = v.oneOf(body.name, KEY_NAMES, "service");
  await rpc("svc_delete_secret", { p_name: name, p_actor: caller.id, p_user_agent: caller.userAgent });
  forgetSecret(name as SecretName);
  return { removed: true };
}

// Makes a small real call with the saved key. ElevenLabs is checked with a one
// second silent clip, which also confirms the chosen model is available.
export async function check({ caller, body }: AdminContext) {
  const name = v.oneOf(body.name, KEY_NAMES, "service");
  const apiKey = await getSecret(name as SecretName);
  if (!apiKey) throw new AppError("not_set_up", "Save a key first.", 409);

  let ok = true;
  let message = "The key works.";
  try {
    if (name === "gemini_api_key") {
      await gemini.checkKey(apiKey);
    } else if (name === "deepseek_api_key") {
      await deepseek.checkKey(apiKey);
    } else {
      let model = typeof body.model === "string" && body.model ? v.modelName(body.model) : "";
      if (!model) {
        const { data } = await adminClient().from("app_settings").select("elevenlabs_model").eq("id", true).single();
        model = data?.elevenlabs_model ?? "scribe_v2";
      }
      await elevenlabs.checkKey(apiKey, model);
      message = "The key works with the chosen model.";
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    ok = false;
    message = userMessage(error);
  }

  await rpc("svc_audit", {
    p_actor: caller.id,
    p_action: "secret.checked",
    p_target_user: null,
    p_details: { secret: name, ok },
    p_user_agent: caller.userAgent,
  });
  return { ok, message };
}
