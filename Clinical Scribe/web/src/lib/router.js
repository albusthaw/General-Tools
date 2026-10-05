// Hash-based routes, so the app works from any static host and sub-folder.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// The recording tabs and the two History tabs carry their type (see lib/modes.js).
export const ROUTES = [
  { name: "scribe", pattern: /^\/scribe$/, module: "scribe", mode: "scribe", title: "Clinical Scribe" },
  { name: "voice", pattern: /^\/voice$/, module: "scribe", mode: "voice", title: "Voice Note" },
  { name: "templates", pattern: /^\/templates$/, module: "scribe", title: "Templates" },
  { name: "history", pattern: /^\/history$/, module: "scribe", mode: "scribe", title: "History" },
  { name: "history-voice", pattern: /^\/history\/voice$/, module: "scribe", mode: "voice", title: "History" },
  { name: "history-detail", pattern: new RegExp(`^/history/(${UUID})$`), module: "scribe", title: "History" },
  // For everyone. The old admin address still opens it. In the apps it opens from More.
  { name: "apps", pattern: /^\/(?:admin\/)?apps$/, fromMore: true, title: "Phone apps" },
  { name: "admin-users", pattern: /^\/admin\/users$/, admin: true, title: "User settings" },
  { name: "admin-ai", pattern: /^\/admin\/ai$/, admin: true, title: "AI settings" },
  { name: "admin-recordings", pattern: /^\/admin\/recordings$/, admin: true, title: "Recording" },
  { name: "admin-review", pattern: /^\/admin\/review$/, admin: true, title: "Review records" },
  { name: "admin-audit", pattern: /^\/admin\/audit$/, admin: true, title: "Audit log" },
  { name: "admin-google", pattern: /^\/admin\/google$/, admin: true, title: "Google sign-in" },
  { name: "admin-email", pattern: /^\/admin\/email$/, admin: true, title: "Email (SMTP)" },
  // Only in the apps: account, server and admin settings.
  { name: "more", pattern: /^\/more$/, appOnly: true, title: "More" },
];

export function currentRoute() {
  const path = decodeURIComponent((window.location.hash || "").replace(/^#/, "")) || "/scribe";
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (match) return { ...route, params: match.slice(1), path };
  }
  return { ...ROUTES[0], params: [], path: "/scribe" };
}

export function navigate(path) {
  if (window.location.hash === `#${path}`) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = path;
  }
}

export function href(path) {
  return `#${path}`;
}

export function onRouteChange(listener) {
  const handler = () => listener(currentRoute());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
