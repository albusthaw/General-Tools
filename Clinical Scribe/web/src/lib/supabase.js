// The one Supabase client used by the app. The website creates it at start from
// its built-in details; the apps create it once a server is chosen. Modules import
// the live binding below, so they always use the current client.
import { createClient } from "@supabase/supabase-js";
import { config, isApp } from "../config.js";

export let supabase = null;

export function createSupabase({ url, key, storageKey, storage = undefined }) {
  supabase = createClient(url, key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey,
      ...(storage ? { storage } : {}),
    },
    global: { headers: { "X-Client-Info": isApp ? "clinical-scribe-app" : "clinical-scribe-web" } },
  });
  return supabase;
}

if (!isApp) {
  createSupabase({ url: config.supabaseUrl || "http://localhost", key: config.supabaseKey || "missing", storageKey: "clinical-scribe-auth" });
}
