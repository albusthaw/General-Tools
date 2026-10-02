// Small input checks. Each failure becomes a plain-language message.
import { AppError } from "./http.ts";
import { stripControl } from "./text.ts";

function invalid(message: string): never {
  throw new AppError("invalid_input", message, 400);
}

export function text(
  value: unknown,
  options: { label: string; min?: number; max: number; trim?: boolean; multiline?: boolean },
): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") invalid(`${options.label} is not valid.`);
  let out = options.trim === false ? value : value.trim();
  // Remove control characters other than tabs and line breaks.
  out = stripControl(out, Boolean(options.multiline));
  const min = options.min ?? 0;
  if (out.length < min) {
    invalid(min <= 1 ? `Enter ${options.label.toLowerCase()}.` : `${options.label} must be at least ${min} characters.`);
  }
  if (out.length > options.max) invalid(`${options.label} must be ${options.max} characters or fewer.`);
  return out;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalid(`Choose a valid ${label.toLowerCase()}.`);
  }
  return value as T;
}

export function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  invalid("One of the switches is not valid.");
}

export function number(value: unknown, options: { label: string; min: number; max: number; integer?: boolean }): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) invalid(`${options.label} must be a number.`);
  if (options.integer && !Number.isInteger(n)) invalid(`${options.label} must be a whole number.`);
  if (n < options.min || n > options.max) invalid(`${options.label} must be between ${options.min} and ${options.max}.`);
  return n;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(value: unknown, label = "Person"): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid(`${label} is not valid.`);
  return value.toLowerCase();
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function email(value: unknown, label = "Email address"): string {
  const out = text(value, { label, min: 3, max: 254 }).toLowerCase();
  if (!EMAIL.test(out)) invalid(`${label} does not look right.`);
  return out;
}

// At least 10 characters with a letter and a number, matching the sign-in settings.
export function password(value: unknown): string {
  if (typeof value !== "string") invalid("Enter a password.");
  if (value.length < 10) invalid("The password must be at least 10 characters.");
  if (value.length > 72) invalid("The password must be 72 characters or fewer.");
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) invalid("The password must include letters and numbers.");
  return value;
}

export function modelName(value: unknown): string {
  const out = text(value, { label: "Model name", min: 2, max: 80 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$/.test(out)) invalid("That model name does not look right.");
  return out;
}

// A service key: one line, no spaces, a sensible length.
export function serviceKey(value: unknown): string {
  if (typeof value !== "string") invalid("Paste the key.");
  const out = value.trim();
  if (out.length < 8 || out.length > 4000 || /\s/.test(out)) invalid("That key does not look right. Copy it again and paste it here.");
  return out;
}
