// "A newer version of the app is ready": the Android app compares its own version
// with the Android app published on the clinic's website (connect.json), so it
// only asks when a newer app can really be downloaded. The iPhone web app updates
// itself through its service worker, so it needs no notice.
import { config } from "../config.js";
import { publishedAndroidApp } from "../lib/connection/published.js";
import { isNewerVersion } from "../lib/connection/versions.js";
import { appHooks } from "../lib/platform/hooks.js";
import { snackbar } from "./snackbar.js";

let lookup = null;
let shown = false;

/** The published Android app when it is newer than this one, or null. Looked up once. */
export function newerApp() {
  if (!appHooks.openExternal || !config.siteUrl) return Promise.resolve(null);
  lookup ??= publishedAndroidApp(config.siteUrl).then((app) => (app && isNewerVersion(app.version, config.appVersion) ? app : null));
  return lookup;
}

/** Opens the download in the phone's browser. */
export function openApp(app) {
  appHooks.openExternal?.(app.url);
}

export async function checkAppVersion() {
  const app = await newerApp();
  if (!app || shown) return;
  shown = true;
  snackbar(`Version ${app.version} of the app is ready.`, {
    action: { label: "Download", onClick: () => openApp(app) },
    timeout: 12000,
  });
}
