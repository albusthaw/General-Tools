// Removes invisible control characters from text people type or say. Line breaks
// and tabs can be kept for multi-line text.

// deno-lint-ignore no-control-regex
const CONTROL_KEEP_LINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// deno-lint-ignore no-control-regex
const CONTROL_ALL = /[\u0000-\u001F\u007F]/g;

export function stripControl(text: string, keepLines = true): string {
  return String(text ?? "").replace(keepLines ? CONTROL_KEEP_LINES : CONTROL_ALL, "");
}
