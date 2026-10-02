import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import { LAUNCH_SCREENS, launchFile, launchMedia } from "./launch-screens.mjs";

const version = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();

// Files from public/ that the app build shares with the website.
const SHARED_PUBLIC = ["favicon.svg", "icon-180.png", "icon-192.png", "icon-512.png", "robots.txt"];

// Adds a Content Security Policy to the built page. Scripts, styles and fonts may
// only come from the app itself. The website may call only its own Supabase
// project; the app build connects to the server a person chooses, so it may call
// any https address. The development server is left without it so hot reload works.
function contentSecurityPolicy({ app, supabaseUrl, localServers }) {
  return {
    name: "clinical-scribe-csp",
    apply: "build",
    transformIndexHtml(html) {
      let connect = "'self'";
      if (app) {
        connect += " https: wss:";
        if (localServers) connect += " http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*";
      } else {
        try {
          if (supabaseUrl) connect += ` ${new URL(supabaseUrl).origin}`;
        } catch {
          // No project details: the page only shows the "not connected" screen.
        }
      }
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        `connect-src ${connect}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
      ].join("; ");
      return html.replace("<!-- csp -->", `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
    },
  };
}

// App build: Home Screen tags and launch images for the iPhone web app, and the
// icons shared with the website.
function appPage() {
  return {
    name: "clinical-scribe-app-page",
    apply: "build",
    transformIndexHtml(html) {
      const tags = [
        '<meta name="mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
        '<meta name="apple-mobile-web-app-title" content="Clinical Scribe">',
        ...LAUNCH_SCREENS.map((screen) => `<link rel="apple-touch-startup-image" media="${launchMedia(screen)}" href="./${launchFile(screen)}">`),
      ];
      return html.replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
    },
    generateBundle() {
      for (const name of SHARED_PUBLIC) {
        this.emitFile({ type: "asset", fileName: name, source: readFileSync(new URL(`./public/${name}`, import.meta.url)) });
      }
    },
  };
}

// App build: a service worker that keeps the app's own files, so the iPhone web
// app starts without a connection. It never handles requests to the server.
function serviceWorker() {
  return {
    name: "clinical-scribe-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const files = ["./", ...Object.keys(bundle).filter((name) => !name.endsWith(".map")).map((name) => `./${name}`)].sort();
      const cache = `cs-app-${version}-${createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12)}`;
      const source = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8")
        .replace("__CACHE__", cache)
        .replace("__FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const app = mode === "app";
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    base: "./",
    publicDir: app ? "public-app" : "public",
    define: {
      __APP_VERSION__: JSON.stringify(version),
      // The app build never carries a server: people connect with a server link.
      ...(app
        ? {
          "import.meta.env.VITE_SUPABASE_URL": '""',
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
          "import.meta.env.VITE_SUPABASE_ANON_KEY": '""',
        }
        : {}),
    },
    plugins: [
      contentSecurityPolicy({ app, supabaseUrl: env.VITE_SUPABASE_URL, localServers: process.env.CS_LOCAL_APP === "1" }),
      ...(app ? [appPage(), serviceWorker()] : []),
    ],
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
