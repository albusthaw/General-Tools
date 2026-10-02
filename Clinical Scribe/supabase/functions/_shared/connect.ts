// What the Clinical Scribe apps need to connect to this server. Built only from
// public values: the server address, its publishable key (public by design, it is
// also inside the website), the clinic name and the version. A secret key is
// never accepted here, even by mistake.

const PUBLISHABLE = /^sb_publishable_[A-Za-z0-9_-]{16,200}$/;

function tokenRole(token: string): string | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** True for a publishable key, or an older key whose token says role "anon". */
export function isPublicKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length > 2000) return false;
  if (PUBLISHABLE.test(key)) return true;
  return key.split(".").length === 3 && tokenRole(key) === "anon";
}

/**
 * The publishable key, from the deploy's CS_PUBLISHABLE_KEY setting, else from
 * the keys Supabase gives every function.
 */
export function publicKeyFrom(env: (name: string) => string | undefined): string | null {
  const explicit = env("CS_PUBLISHABLE_KEY");
  if (isPublicKey(explicit)) return explicit;
  const named = env("SUPABASE_PUBLISHABLE_KEYS");
  if (named) {
    try {
      const parsed = JSON.parse(named) as Record<string, unknown>;
      const value = Object.values(parsed).find(isPublicKey);
      if (value) return value;
    } catch {
      // Fall through to the older key.
    }
  }
  const legacy = env("SUPABASE_ANON_KEY");
  return isPublicKey(legacy) ? legacy : null;
}

/** An https origin (http only for this computer), or null. */
export function cleanOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The website's address (ending in "/"), or null. */
export function cleanSite(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password) return null;
    return `${url.origin}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`;
  } catch {
    return null;
  }
}

export interface ConnectAnswer {
  app: "clinical-scribe";
  server_url: string;
  publishable_key: string;
  name: string;
  version: string;
  site_url?: string;
  app_url?: string;
}

export function connectAnswer(input: { serverUrl: string; key: string; name: string; version: string; siteUrl: string | null }): ConnectAnswer {
  const answer: ConnectAnswer = {
    app: "clinical-scribe",
    server_url: input.serverUrl,
    publishable_key: input.key,
    name: input.name.slice(0, 80),
    version: input.version,
  };
  if (input.siteUrl) {
    answer.site_url = input.siteUrl;
    answer.app_url = new URL("app/", input.siteUrl).toString();
  }
  return answer;
}
