// Copies text, with a fallback for browsers without the Clipboard API. The
// Android app uses the phone's clipboard directly.
import { appHooks } from "./platform/hooks.js";

export async function copyText(text) {
  if (appHooks.copyText) return appHooks.copyText(text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
