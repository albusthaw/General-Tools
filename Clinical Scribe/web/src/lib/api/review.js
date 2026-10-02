// Admin review of other people's records. Every call is written to the audit log
// on the server before any data is returned.
import { fromDatabase } from "../errors.js";
import { supabase } from "../supabase.js";

async function call(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw fromDatabase(error);
  return data;
}

export const currentReview = () => call("admin_review_current");
export const startReview = (userId, reason, confirmed) =>
  call("admin_review_start", { p_target_user: userId, p_reason: reason, p_confirmed: confirmed });
export const listRecords = (reviewId) => call("admin_review_list", { p_review_id: reviewId });
export const openRecord = (reviewId, scribeId) => call("admin_review_open", { p_review_id: reviewId, p_scribe_id: scribeId });
export const recordCopy = (reviewId, scribeId, what, noteId = null) =>
  call("admin_review_copied", { p_review_id: reviewId, p_scribe_id: scribeId, p_what: what, p_note_id: noteId });
export const endReview = (reviewId) => call("admin_review_end", { p_review_id: reviewId });
