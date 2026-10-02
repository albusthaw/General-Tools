// Admin settings, people, keys, sign-in, recordings and the audit log.
import { config } from "../../config.js";
import { fromDatabase, fromFunction, UserError } from "../errors.js";
import { supabase } from "../supabase.js";

async function call(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw fromDatabase(error);
  return data;
}

async function action(name, payload = {}) {
  const { data, error } = await supabase.functions.invoke("admin", { body: { action: name, ...payload } });
  if (error) throw await fromFunction(error);
  return data?.data;
}

// Settings
export const getSettings = () => call("admin_get_settings");
export const updateSettings = (changes) => call("admin_update_settings", { p_changes: changes });
export const usageSummary = () => call("admin_usage_summary");
export const setClinicName = (name) => call("admin_set_clinic_name", { p_name: name });

// People
export const listUsers = ({ search = "", status = "", limit = 100, offset = 0 } = {}) =>
  call("admin_list_users", { p_search: search, p_status: status, p_limit: limit, p_offset: offset });
export const createUser = (person) => action("users.create", person);
export const setPassword = (userId, password) => action("users.set_password", { user_id: userId, password });
export const setStatus = (userId, status) => action("users.set_status", { user_id: userId, status });
export const removeUser = (userId, confirmEmail) => action("users.remove", { user_id: userId, confirm_email: confirmEmail });
export const setRole = (userId, role) => call("admin_set_role", { p_user: userId, p_role: role });
export const adjustCredit = ({ userId, provider, mode, minutes, note }) =>
  call("admin_adjust_credit", { p_user: userId, p_provider: provider, p_mode: mode, p_minutes: minutes, p_note: note ?? "" });
export const setUnlimited = (userId, unlimited) => call("admin_set_unlimited", { p_user: userId, p_unlimited: unlimited });
export const creditHistory = (userId, limit = 20) => call("admin_credit_history", { p_user: userId, p_limit: limit });

// Service keys and models
export const saveKey = (name, value) => action("keys.save", { name, value });
export const removeKey = (name) => action("keys.remove", { name });
export const checkKey = (name, model) => action("keys.check", { name, model });
export const modelCatalog = () => action("models.catalog");
export const refreshModels = () => action("models.refresh");
export const testModels = (choices) => action("models.test", choices);

// Google sign-in
export const getGoogle = () => action("google.get");
export const saveGoogle = (settings) => action("google.save", settings);
export const saveToken = (value) => action("google.token_save", { value });
export const removeToken = () => action("google.token_remove");

// Email (SMTP)
export const getEmail = () => action("email.get");
export const saveEmail = (settings) => action("email.save", settings);

// Recording audio
export const listRecordings = ({ person = null, audio = "", before = null, limit = 50 } = {}) =>
  call("admin_list_recordings", { p_person: person, p_audio: audio, p_before: before, p_limit: limit });
export const unlockRecording = (scribeId, reason, confirmed) => action("recordings.unlock", { scribe_id: scribeId, reason, confirmed });

// One part of a recording's audio, as a Blob. The functions client would read the
// bytes as text, so this request is made directly, with the person's own sign-in.
export async function recordingPart(scribeId, seq, { download = false } = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new UserError("Your session has ended. Please sign in again.", "not_signed_in");
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/functions/v1/admin`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: config.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recordings.part", scribe_id: scribeId, seq, download }),
    });
  } catch {
    throw new UserError("The server cannot be reached. Check your internet connection and try again.", "offline");
  }
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new UserError(payload?.error?.message ?? "The audio could not be loaded. Please try again.", payload?.error?.code ?? "error");
  }
  return await response.blob();
}

// Audit log
export const listAudit =({ group = "", person = null, from = null, to = null, beforeId = null, limit = 50 } = {}) =>
  call("admin_list_audit", {
    p_action_group: group,
    p_person: person,
    p_from: from,
    p_to: to,
    p_before_id: beforeId,
    p_limit: limit,
  });
