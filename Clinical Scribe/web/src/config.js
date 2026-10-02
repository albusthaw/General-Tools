// Connection details are set when the app is built (see the README). Both values
// are public by design; the server protects all data.
/* global __APP_VERSION__ */

export const config = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, ""),
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim(),
  appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
};

export const isConfigured = Boolean(config.supabaseUrl && config.supabaseKey);

// The address people return to after Google sign-in: this page, without any
// query string or hash.
export function appAddress() {
  return `${window.location.origin}${window.location.pathname}`;
}
