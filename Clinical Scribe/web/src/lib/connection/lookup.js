// Finds the server behind a server link: asks the site (connect.json) or the
// server's connect function for the connection details, checks every field, then
// proves the details work by asking the server for its public settings.
import { lookupTargets, tidyLink } from "./link.js";
import { cleanName, readAnswer } from "./validate.js";
import { serverTooOld } from "./versions.js";

const TIMEOUT_MS = 15000;
const MAX_ANSWER = 20000;

function keyHeaders(key) {
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

async function request(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, credentials: "omit", cache: "no-store", signal: controller.signal });
    const text = await response.text();
    if (!response.ok) return { status: response.status };
    if (text.length > MAX_ANSWER) return { status: response.status, unreadable: true };
    try {
      return { status: response.status, json: JSON.parse(text) };
    } catch {
      return { status: response.status, unreadable: true };
    }
  } catch {
    return { offline: true };
  } finally {
    clearTimeout(timer);
  }
}

// The server must answer its public settings with this key, and be new enough.
async function checkServer(connection, fetchImpl, timeoutMs) {
  const result = await request(
    fetchImpl,
    `${connection.serverUrl}/rest/v1/rpc/get_public_config`,
    {
      method: "POST",
      redirect: "error",
      headers: { ...keyHeaders(connection.publishableKey), "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    },
    timeoutMs,
  );
  if (result.offline) return { error: "offline" };
  if (!result.json || typeof result.json !== "object") return { error: "not_found" };
  const version = result.json.server_version;
  if (serverTooOld(version)) return { error: "server_old" };
  return {
    version,
    googleEnabled: Boolean(result.json.google_enabled),
    name: cleanName(result.json.clinic_name),
  };
}

/**
 * lookupServer("scribe.example.org") → { connection } or { error }, where error is
 * one of: empty, invalid, not_https, not_found, offline, server_old, secret_key.
 */
export async function lookupServer(input, { fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = TIMEOUT_MS } = {}) {
  const tidy = tidyLink(input);
  if (tidy.error) return { error: tidy.error };
  let offline = false;
  let outdated = false;
  let secret = false;
  for (const target of lookupTargets(tidy.url)) {
    const result = await request(fetchImpl, target.url, { method: "GET", redirect: "follow", headers: { Accept: "application/json" } }, timeoutMs);
    if (result.offline) {
      offline = true;
      continue;
    }
    if (!result.json) continue;
    const answer = readAnswer(result.json);
    if (answer.error === "secret_key") {
      secret = true;
      continue;
    }
    if (answer.error) {
      outdated ||= answer.error === "bad_answer";
      continue;
    }
    const check = await checkServer(answer.connection, fetchImpl, timeoutMs);
    if (check.error) return { error: check.error };
    return {
      connection: {
        ...answer.connection,
        // The server's own name is the current one; the answer may come from a file made at deploy time.
        name: check.name || answer.connection.name,
        version: check.version,
        googleEnabled: check.googleEnabled,
        link: tidy.url,
      },
    };
  }
  if (secret) return { error: "secret_key" };
  if (outdated) return { error: "server_old" };
  if (offline) return { error: "offline" };
  return { error: "not_found" };
}
