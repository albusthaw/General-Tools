// The server link a person types, tidied into a full address, and the places to
// ask for the server's connection details. Only https links are used; plain http
// is accepted for this computer only (local testing).

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HOST_AND_PORT = /^[^/:\s]+:\d{1,5}(\/|$)/;

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(hostname);
}

/**
 * tidyLink(" scribe.example.org/app ") → { url: "https://scribe.example.org/app/" }
 * or { error: "empty" | "invalid" | "not_https" }.
 */
export function tidyLink(input) {
  let text = String(input ?? "").trim();
  if (!text) return { error: "empty" };
  if (text.length > 500 || /\s/.test(text)) return { error: "invalid" };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !HOST_AND_PORT.test(text);
  if (!hasScheme) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "invalid" };
  if (url.username || url.password) return { error: "invalid" };
  const local = isLocalHost(url.hostname);
  if (url.protocol === "http:" && !local) return { error: "not_https" };
  if (!local && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return { error: "invalid" };
  url.search = "";
  url.hash = "";
  let path = url.pathname.replace(/\/index\.html?$/i, "/");
  if (!path.endsWith("/")) path = `${path}/`;
  url.pathname = path.replace(/\/{2,}/g, "/");
  return { url: url.toString() };
}

function isSupabaseHost(hostname) {
  return /\.supabase\.(co|in)$/i.test(hostname);
}

/**
 * Where to ask, in order: the site's connect.json, then the server's connect
 * function. For a server address the function is asked first.
 */
export function lookupTargets(link) {
  const url = new URL(link);
  const site = { kind: "site", url: new URL("connect.json", url).toString() };
  const server = { kind: "server", url: `${url.origin}/functions/v1/connect` };
  return isSupabaseHost(url.hostname) ? [server, site] : [site, server];
}

/** Name for the sign-in storage of one server, so sessions never mix. */
export function storageName(serverUrl) {
  const host = new URL(serverUrl).host.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `clinical-scribe-auth-${host}`;
}
