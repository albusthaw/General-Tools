// Which kind of device and app the page runs in. Decided once at start.

/**
 * "android": inside the Android app; "ios": on an iPhone or iPad (iPadOS may
 * call itself a Mac, but has touch); "android-web": an Android browser;
 * "web": anything else.
 */
export function detectPlatform(win = globalThis.window) {
  const capacitor = win?.Capacitor;
  if (capacitor?.isNativePlatform?.() && capacitor.getPlatform?.() === "android") return "android";
  const nav = win?.navigator ?? {};
  const agent = String(nav.userAgent ?? "");
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && Number(nav.maxTouchPoints ?? 0) > 1)) return "ios";
  if (/Android/.test(agent)) return "android-web";
  return "web";
}

/** True when the page runs as an app from the Home Screen, not in a browser tab. */
export function isStandalone(win = globalThis.window) {
  try {
    return win.navigator?.standalone === true || Boolean(win.matchMedia?.("(display-mode: standalone)").matches);
  } catch {
    return false;
  }
}

/** True on phones and tablets (touch first), false on computers. */
export function isPhoneOrTablet(win = globalThis.window) {
  const platform = detectPlatform(win);
  return platform === "ios" || platform === "android" || platform === "android-web";
}
