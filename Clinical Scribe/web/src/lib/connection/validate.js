// Checks a server's connection details field by field before anything is used or
// saved. A secret key is refused outright: only public keys may ever reach a phone.
import { isLocalHost } from "./link.js";

const PUBLISHABLE = /^sb_publishable_[A-Za-z0-9_-]{16,200}$/;
const SECRET = /^sb_(secret|service)_/i;
const TOKEN = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** The role written inside an older-style key, or null. */
export function tokenRole(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** "ok" for a public key, "secret" for anything secret, "invalid" otherwise. */
export function checkKey(key) {
  if (typeof key !== "string" || key.length > 2000) return "invalid";
  if (SECRET.test(key)) return "secret";
  if (PUBLISHABLE.test(key)) return "ok";
  if (TOKEN.test(key)) {
    const role = tokenRole(key);
    if (role === "anon") return "ok";
    if (role) return "secret";
  }
  return "invalid";
}

/** The server's origin (https only; http on this computer), or null. */
export function checkServerUrl(value) {
  if (typeof value !== "string" || value.length > 300) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const local = isLocalHost(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return url.origin;
}

function optionalAddress(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    const local = isLocalHost(url.hostname);
    if (url.username || url.password) return "";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

/** Plain text of at most 80 characters, without control characters. */
export function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * readAnswer(json) → { connection } or { error: "not_found" | "bad_answer" | "secret_key" }.
 */
export function readAnswer(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { error: "not_found" };
  if (json.app !== "clinical-scribe") return { error: "not_found" };
  const key = checkKey(json.publishable_key);
  if (key === "secret") return { error: "secret_key" };
  const serverUrl = checkServerUrl(json.server_url);
  if (!serverUrl || key !== "ok") return { error: "bad_answer" };
  if (typeof json.version !== "string" || !VERSION.test(json.version)) return { error: "bad_answer" };
  return {
    connection: {
      serverUrl,
      publishableKey: json.publishable_key,
      name: cleanName(json.name),
      version: json.version,
      siteUrl: optionalAddress(json.site_url),
      appUrl: optionalAddress(json.app_url),
    },
  };
}

/** True when a saved connection still has a sensible shape. */
export function isSavedConnection(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      checkServerUrl(value.serverUrl) === value.serverUrl &&
      checkKey(value.publishableKey) === "ok" &&
      typeof value.link === "string",
  );
}
