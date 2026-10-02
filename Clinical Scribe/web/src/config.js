// Connection details. The website has them built in (see the README); the apps
// get them when a person connects to a server. Both values are public by design;
// the server protects all data.
/* global __APP_VERSION__ */

// True in the app build (the Android app and the iPhone web app).
export const isApp = import.meta.env.MODE === "app";

export const config = {
  supabaseUrl: isApp ? "" : (import.meta.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, ""),
  supabaseKey: isApp ? "" : (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim(),
  appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0",
  // The clinic's website, when the server told the app about it.
  siteUrl: "",
};

export const isConfigured = Boolean(config.supabaseUrl && config.supabaseKey);

/** The apps call this once a server is chosen, before anything talks to it. */
export function useServer(connection) {
  config.supabaseUrl = connection.serverUrl;
  config.supabaseKey = connection.publishableKey;
  config.siteUrl = connection.siteUrl ?? "";
}

// The address people return to after Google sign-in: this page, without any
// query string or hash. The Android app has no web address of its own: it
// returns through its own link instead.
export function appAddress() {
  if (isApp && window.Capacitor?.isNativePlatform?.()) return "";
  return `${window.location.origin}${window.location.pathname}`;
}
