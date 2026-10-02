// Service keys are read from Supabase Vault through a server-only database
// function, kept in memory for a short time, and never written to logs.
import { adminClient } from "./supabase.ts";

export type SecretName =
  | "gemini_api_key"
  | "elevenlabs_api_key"
  | "deepseek_api_key"
  | "smtp_password"
  | "management_token";

const TTL_MS = 60_000;
const cache = new Map<string, { value: string | null; at: number }>();
const known = new Set<string>();

export async function getSecret(name: SecretName): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await adminClient().rpc("svc_get_secret", { p_name: name });
  if (error) throw new Error("The saved service key could not be read.");
  const value = typeof data === "string" && data.length > 0 ? data : null;
  cache.set(name, { value, at: Date.now() });
  if (value) known.add(value);
  return value;
}

export function forgetSecret(name: SecretName): void {
  cache.delete(name);
}

// Remembers a value so it is removed from any text that is logged or stored.
export function rememberSecret(value: string): void {
  if (value && value.length >= 8) known.add(value);
}

const PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_\-]{30,}/g, // Google API keys
  /\bsk[-_][A-Za-z0-9_\-]{16,}/g, // DeepSeek and ElevenLabs style keys
  /\bsbp_[A-Za-z0-9]{20,}/g, // Supabase access tokens
  /\bsb_(secret|publishable)_[A-Za-z0-9_\-]{10,}/g, // Supabase API keys
  /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, // JWTs
  /(bearer\s+)[A-Za-z0-9._\-]{12,}/gi,
  /([?&](key|api_key|token)=)[^&\s"']+/gi,
];

// Removes anything that looks like a key or token from text before it is logged
// or saved as an error message.
export function scrub(text: string): string {
  let out = String(text ?? "");
  for (const value of known) {
    if (value) out = out.split(value).join("[hidden]");
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (_match, prefix) => (typeof prefix === "string" && /bearer|[?&]/i.test(prefix) ? `${prefix}[hidden]` : "[hidden]"));
  }
  return out.slice(0, 1000);
}
