import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";

const version = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();

// Adds a Content Security Policy to the built page. Scripts, styles and fonts may
// only come from the app itself; network calls only to the app and its Supabase
// project. The development server is left without it so hot reload works.
function contentSecurityPolicy(supabaseUrl) {
  return {
    name: "clinical-scribe-csp",
    apply: "build",
    transformIndexHtml(html) {
      let api = "";
      try {
        api = supabaseUrl ? new URL(supabaseUrl).origin : "";
      } catch {
        api = "";
      }
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        `connect-src 'self'${api ? ` ${api}` : ""}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
      ].join("; ");
      return html.replace(
        "<!-- csp -->",
        `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "./",
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [contentSecurityPolicy(env.VITE_SUPABASE_URL)],
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true },
    build: {
      target: "es2020",
      sourcemap: false,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 700,
    },
  };
});
