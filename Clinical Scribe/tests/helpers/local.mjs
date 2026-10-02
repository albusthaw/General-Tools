// Helpers for tests against the local Supabase stack (`supabase start`) and the
// stand-in AI services (tests/mock-ai/server.mjs).
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
export const toolRoot = resolve(here, "../..");
export const MOCK_URL = process.env.MOCK_AI_URL ?? "http://127.0.0.1:54399";

let cached = null;

// Addresses and keys of the local stack, read from the Supabase CLI.
export function localStack() {
  if (cached) return cached;
  const output = execFileSync("supabase", ["status", "-o", "json"], { cwd: toolRoot, encoding: "utf8" });
  const start = output.indexOf("{");
  const data = JSON.parse(output.slice(start));
  cached = {
    url: data.API_URL,
    dbUrl: data.DB_URL,
    publishableKey: data.PUBLISHABLE_KEY ?? data.ANON_KEY,
    secretKey: data.SECRET_KEY ?? data.SERVICE_ROLE_KEY,
  };
  return cached;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function serverClient() {
  const { url, secretKey } = localStack();
  return createClient(url, secretKey, noSession);
}

export function browserClient() {
  const { url, publishableKey } = localStack();
  return createClient(url, publishableKey, noSession);
}

export async function signIn(email, password) {
  const client = browserClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

// Runs SQL as the database owner through psql (local stack only).
export function sql(query) {
  return execFileSync("psql", [localStack().dbUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
}

export async function waitFor(check, { timeoutMs = 90_000, intervalMs = 1000, label = "condition" } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await check();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function mock(path, body) {
  const response = await fetch(`${MOCK_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return await response.json();
}

// Calls an Edge Function the way the web app does and returns { data, error }.
export async function invoke(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    let payload = null;
    try {
      payload = await error.context?.json?.();
    } catch {
      payload = null;
    }
    return { data: null, error: payload?.error ?? { message: error.message }, status: error.context?.status };
  }
  return { data: data?.data ?? null, error: null, status: 200 };
}

export function friendlyCode(error) {
  return typeof error?.hint === "string" && error.hint.startsWith("cs:") ? error.hint.slice(3) : null;
}
