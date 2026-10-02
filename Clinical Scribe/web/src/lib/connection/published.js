// What a clinic's website publishes in its connect.json besides the server
// details: the Android app download. It is read field by field, and anything
// unexpected is ignored.
const APK_PATH = /^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]*\.apk$/i;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const MAX_ANSWER = 20000;

/** { path, version, size } from a connect.json answer, or null. */
export function readAndroidApp(info) {
  const app = info?.android_app;
  if (!app || typeof app.path !== "string" || !APK_PATH.test(app.path)) return null;
  return {
    path: app.path,
    version: typeof app.version === "string" && VERSION.test(app.version) ? app.version : "",
    size: Number.isSafeInteger(app.size) && app.size > 0 ? app.size : 0,
  };
}

/** A website's connect.json, parsed, or null when it has none. */
export async function readSiteInfo(site, { fetchImpl = globalThis.fetch } = {}) {
  if (!site) return null;
  try {
    const response = await fetchImpl(new URL("connect.json", site).toString(), { cache: "no-store", credentials: "omit" });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_ANSWER ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** The Android app named in a website's connect.json, with its full address, or null. */
export function androidAppAt(info, site) {
  const app = readAndroidApp(info);
  return app && site ? { ...app, url: new URL(app.path, site).toString() } : null;
}

/** The Android app published with a website, with its full address, or null. */
export async function publishedAndroidApp(site, options = {}) {
  return androidAppAt(await readSiteInfo(site, options), site);
}

/** 3.6 MB */
export function sizeText(bytes) {
  return bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : "";
}
