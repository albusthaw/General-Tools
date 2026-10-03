// Rules for the upload queue: where a part is stored, how long to wait before
// trying again, and which server answers mean that trying again cannot help.
import { UserError } from "../errors.js";

// Answers that mean the server will never accept this part (the recording was
// finished elsewhere or deleted), so the part is dropped instead of retried.
const PART_FINAL = new Set(["not_found", "not_recording", "invalid_input", "too_large", "too_long", "not_allowed"]);

// Reasons for not finishing a recording that trying again will not change.
// Anything else (no connection, parts still arriving) is retried.
const FINISH_REFUSED = new Set(["not_enough_credit", "too_short", "too_long", "not_set_up", "not_found", "not_allowed", "unsupported_audio"]);

// "<user>/<recording>/0003.webm"
export function partPath(part) {
  return `${part.prefix}/${String(part.seq).padStart(4, "0")}.${part.ext}`;
}

// 2, 4, 8, 16, 32 and then 60 seconds between tries.
export function retryDelayMs(attempt) {
  return Math.min(60_000, 2000 * 2 ** Math.min(Math.max(0, attempt), 5));
}

export function partCannotBeSaved(error) {
  return error instanceof UserError && PART_FINAL.has(error.code);
}

export function finishWasRefused(error) {
  return error instanceof UserError && FINISH_REFUSED.has(error.code);
}
