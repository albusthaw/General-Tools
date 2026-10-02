// Signing in and out, and what the signed-in person can do.
import { appAddress } from "../../config.js";
import { fromDatabase, UserError } from "../errors.js";
import { supabase } from "../supabase.js";

function authMessage(error) {
  const code = error?.code ?? "";
  const status = error?.status ?? 0;
  if (code === "invalid_credentials" || /invalid login credentials/i.test(error?.message ?? "")) {
    return "The email address or password is not right.";
  }
  if (code === "user_banned" || /banned/i.test(error?.message ?? "")) {
    return "This account is suspended. Ask your administrator.";
  }
  if (status === 429 || code === "over_request_rate_limit") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (code === "email_provider_disabled") return "Signing in with a password is switched off. Ask your administrator.";
  if (code === "weak_password") return "Choose a stronger password: at least 10 characters with letters and numbers.";
  if (code === "same_password") return "The new password must be different from the current one.";
  if (/fetch|network/i.test(error?.message ?? "")) return "The server cannot be reached. Check your internet connection and try again.";
  return "Signing in did not work. Please try again.";
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new UserError(authMessage(error), error.code ?? "auth");
  return data.session;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: appAddress(), queryParams: { prompt: "select_account" } },
  });
  if (error) throw new UserError("Google sign-in could not start. Please try again.", "oauth");
}

export async function signOut() {
  await supabase.auth.signOut({ scope: "local" });
}

export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export function onSessionChange(listener) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => listener(event, session));
  return () => data.subscription.unsubscribe();
}

export async function loadContext() {
  const { data, error } = await supabase.rpc("get_my_context");
  if (error) throw fromDatabase(error);
  return data;
}

export async function loadPublicConfig() {
  const { data, error } = await supabase.rpc("get_public_config");
  if (error) return { google_enabled: false, server_version: null };
  return data ?? { google_enabled: false, server_version: null };
}

// Checks the current password before setting a new one.
export async function changePassword(email, current, next) {
  const check = await supabase.auth.signInWithPassword({ email, password: current });
  if (check.error) {
    if (check.error.code === "invalid_credentials") throw new UserError("The current password is not right.", "wrong_password");
    throw new UserError(authMessage(check.error), check.error.code ?? "auth");
  }
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) throw new UserError(authMessage(error), error.code ?? "auth");
}

export async function updateMyName(name) {
  const { error } = await supabase.rpc("update_my_name", { p_full_name: name });
  if (error) throw fromDatabase(error);
}
