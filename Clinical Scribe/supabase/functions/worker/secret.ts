// The shared secret the database sends when it wakes the worker.
import { rpc } from "../_shared/supabase.ts";

const CACHE_MS = 5 * 60_000;
const REFRESH_GAP_MS = 10_000;

let cached: { value: string; at: number } | null = null;

async function load(): Promise<string | null> {
  const value = await rpc<string | null>("svc_get_worker_secret");
  cached = value ? { value, at: Date.now() } : null;
  return value;
}

// Compares in constant time so the secret cannot be guessed from response times.
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

// True when the given value matches the database's secret. If it does not match
// the remembered value, the secret is read again (at most every 10 seconds) in
// case it was replaced, for example after the database was rebuilt.
export async function isWorkerSecret(given: string): Promise<boolean> {
  if (!given) return false;
  if (!cached || Date.now() - cached.at > CACHE_MS) await load();
  if (cached && sameSecret(given, cached.value)) return true;
  if (cached && Date.now() - cached.at < REFRESH_GAP_MS) return false;
  await load();
  return cached !== null && sameSecret(given, cached.value);
}
