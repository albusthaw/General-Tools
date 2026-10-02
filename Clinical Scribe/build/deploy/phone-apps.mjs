// The phone app parts of the deploy: the connect file the apps read to find this
// server (public values only), the Android app download when one is in the
// Release folder, and the values the server needs for the apps.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readAndroidRelease } from "../android/release-file.mjs";
import { DeployError } from "./output.mjs";

// Where the Android app is published, relative to the website's address.
export const APK_PATH = "downloads/clinical-scribe.apk";
// Where Google sign-in returns to in the Android app.
export const APP_RETURN_LINK = "io.github.albusthaw.clinicalscribe://auth";
// The address the Android app's pages run at; it calls the server functions from there.
export const ANDROID_APP_ORIGIN = "https://localhost";

/** The connect file: the same public details as the server's connect function gives. */
export function connectFile({ projectUrl, publishableKey, version, app = null, androidApp = null }) {
  const file = {
    app: "clinical-scribe",
    server_url: new URL(projectUrl).origin,
    publishable_key: publishableKey,
    // The apps read the clinic name from the server itself, so a renamed clinic shows at once.
    name: "",
    version,
  };
  if (app) {
    file.site_url = app.url;
    file.app_url = new URL("app/", app.url).toString();
  }
  if (androidApp) file.android_app = androidApp;
  return file;
}

function startsLikeZip(file) {
  const head = Buffer.alloc(4);
  const handle = openSync(file, "r");
  try {
    readSync(handle, head, 0, 4, 0);
  } finally {
    closeSync(handle);
  }
  return head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

/** The Android app in the Release folder as { file, version, size }, or null when there is none. */
export function androidRelease(root) {
  const file = join(root, "Release", "clinical-scribe.apk");
  if (!existsSync(file)) return null;
  if (!startsLikeZip(file)) {
    throw new DeployError("Release/clinical-scribe.apk is not an Android app file. Build it again with the workflow Build Clinical Scribe Android app.");
  }
  const readme = join(root, "Release", "README.txt");
  const release = existsSync(readme) ? readAndroidRelease(readFileSync(readme, "utf8")) : null;
  return { file, version: release?.version ?? "", size: statSync(file).size };
}

/**
 * Adds the phone app files to the built website in dist: connect.json for the
 * website and for the iPhone web app (dist/app), and the Android app download.
 */
export function addPhoneApps(dist, { root, projectUrl, version, app, publishableKey }) {
  const android = androidRelease(root);
  let androidApp = null;
  if (android) {
    mkdirSync(join(dist, "downloads"), { recursive: true });
    copyFileSync(android.file, join(dist, APK_PATH));
    androidApp = { path: APK_PATH, size: android.size, ...(android.version ? { version: android.version } : {}) };
  }
  const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const details = { projectUrl, publishableKey, version, app };
  write(join(dist, "connect.json"), connectFile({ ...details, androidApp }));
  // The download address is relative to the website, so only the website's file names it.
  write(join(dist, "app", "connect.json"), connectFile(details));
  return { androidApp };
}

/** The server function settings for the apps. */
export function phoneAppSecrets({ app, publishableKey }) {
  const secrets = [{ name: "CS_PUBLISHABLE_KEY", value: publishableKey }];
  if (app) secrets.push({ name: "CS_SITE_URL", value: app.url });
  return secrets;
}

/** The allowed origins for the server functions: the website and the Android app. */
export function allowedOrigins(app) {
  return app ? `${app.origin},${ANDROID_APP_ORIGIN}` : "";
}
