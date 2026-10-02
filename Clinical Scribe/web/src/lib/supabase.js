// The one Supabase client used by the app.
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export const supabase = createClient(config.supabaseUrl || "http://localhost", config.supabaseKey || "missing", {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "clinical-scribe-auth",
  },
  global: { headers: { "X-Client-Info": "clinical-scribe-web" } },
});
