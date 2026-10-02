// Links that open the Android app. Only two kinds are accepted:
//   io.github.albusthaw.clinicalscribe://connect?server=<https link>  fills in the server link
//   io.github.albusthaw.clinicalscribe://auth?code=…                  finishes a Google sign-in
// The same rules are checked again in the Android code (LinkRules.java).
import { tidyLink } from "../connection/link.js";

export const APP_SCHEME = "io.github.albusthaw.clinicalscribe";
export const RETURN_LINK = `${APP_SCHEME}://auth`;

export function parseAppLink(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.username || url.password) return null;
  const target = url.host || url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (target === "connect") {
    const tidy = tidyLink(url.searchParams.get("server") ?? "");
    return tidy.url && tidy.url.startsWith("https://") ? { kind: "connect", server: tidy.url } : null;
  }
  if (target === "auth") {
    const code = url.searchParams.get("code") ?? "";
    if (/^[A-Za-z0-9_-]{8,200}$/.test(code)) return { kind: "auth", code };
    if (url.searchParams.has("error") || url.searchParams.has("error_description")) return { kind: "auth", failed: true };
  }
  return null;
}
