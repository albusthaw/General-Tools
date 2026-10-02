// Recordings, their audio parts and notes.
import { fromDatabase, UserError } from "../errors.js";
import { supabase } from "../supabase.js";

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw fromDatabase(error);
  return data;
}

export const startScribe = ({ templateId, title, mimeType }) =>
  call("start_scribe", { p_template_id: templateId ?? null, p_title: title ?? "", p_mime_type: mimeType });

export const registerSegment = ({ scribeId, seq, durationSeconds, mimeType }) =>
  call("register_segment", {
    p_scribe_id: scribeId,
    p_seq: seq,
    p_duration_seconds: Math.round(durationSeconds * 100) / 100,
    p_mime_type: mimeType,
  });

export const finishScribe = (scribeId, segmentCount) =>
  call("finish_scribe", { p_scribe_id: scribeId, p_segment_count: segmentCount ?? null });

export const retryScribe = (scribeId) => call("retry_scribe", { p_scribe_id: scribeId });
export const discardScribe = (scribeId) => call("discard_scribe", { p_scribe_id: scribeId });
export const deleteScribe = (scribeId) => call("delete_scribe", { p_scribe_id: scribeId });
export const renameScribe = (scribeId, title) => call("rename_scribe", { p_scribe_id: scribeId, p_title: title });
export const requestNote = (scribeId, templateId) => call("request_note", { p_scribe_id: scribeId, p_template_id: templateId });
export const retryNote = (noteId) => call("retry_note", { p_note_id: noteId });

const LIST_COLUMNS = "id, title, status, duration_seconds, started_at, transcribed_at, error_message, notes(count)";

export async function listScribes({ search = "", before = null, limit = 30 } = {}) {
  let query = supabase.from("scribes").select(LIST_COLUMNS).order("started_at", { ascending: false }).limit(limit);
  if (before) query = query.lt("started_at", before);
  const term = search.trim().replace(/[%_,()]/g, " ").slice(0, 80);
  if (term) query = query.ilike("title", `%${term}%`);
  const { data, error } = await query;
  if (error) throw fromDatabase(error);
  return (data ?? []).map((row) => ({ ...row, note_count: row.notes?.[0]?.count ?? 0 }));
}

export async function getScribe(id) {
  const { data, error } = await supabase
    .from("scribes")
    .select("id, title, status, duration_seconds, segment_count, started_at, finished_at, transcribed_at, transcript, error_message, audio_deleted_at, template_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromDatabase(error);
  return data;
}

export async function getSegments(scribeId) {
  const { data, error } = await supabase
    .from("scribe_segments")
    .select("id, seq, status, duration_seconds")
    .eq("scribe_id", scribeId)
    .order("seq");
  if (error) throw fromDatabase(error);
  return data ?? [];
}

export async function getNotes(scribeId) {
  const { data, error } = await supabase
    .from("notes")
    .select("id, template_name, status, content, error_message, created_at, completed_at")
    .eq("scribe_id", scribeId)
    .order("created_at", { ascending: false });
  if (error) throw fromDatabase(error);
  return data ?? [];
}

export async function getNote(noteId) {
  const { data, error } = await supabase
    .from("notes")
    .select("id, scribe_id, template_name, status, content, error_message, created_at, completed_at")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw fromDatabase(error);
  return data;
}

// Uploads one audio part. An earlier upload of the same part counts as done.
export async function uploadPart(path, blob, mimeType) {
  const { error } = await supabase.storage.from("recordings").upload(path, blob, {
    contentType: mimeType,
    upsert: false,
    cacheControl: "no-store",
  });
  if (!error) return;
  const status = String(error.statusCode ?? error.status ?? "");
  if (status === "409" || /already exists|duplicate/i.test(error.message ?? "")) return;
  if (status === "413" || /too large|maximum allowed size/i.test(error.message ?? "")) {
    throw new UserError("This part of the recording is too large to save.", "too_large");
  }
  throw new UserError("Audio could not be saved yet. It will be sent again.", "upload_failed");
}
