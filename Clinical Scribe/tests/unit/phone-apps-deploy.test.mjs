// Unit tests for the phone app parts of the deploy: the connect files (public
// values only, and accepted by the apps), the Android app download, the server
// settings and the website's header files.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { addPhoneApps, allowedOrigins, androidRelease, APK_PATH, connectFile, phoneAppSecrets } from "../../build/deploy/phone-apps.mjs";
import { parseAppUrl } from "../../build/deploy/settings.mjs";
import { readAnswer } from "../../web/src/lib/connection/validate.js";
import { readAndroidApp } from "../../web/src/lib/connection/published.js";

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLISHABLE = "sb_publishable_abcdefghijklmnopqrstuvwx";
const app = parseAppUrl("https://name.github.io/General-Tools/");

function tempTool({ apk = null, readme = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cs-phone-"));
  const dist = join(root, "web", "dist");
  mkdirSync(join(dist, "app"), { recursive: true });
  mkdirSync(join(root, "Release"), { recursive: true });
  if (apk) writeFileSync(join(root, "Release", "clinical-scribe.apk"), apk);
  if (readme) writeFileSync(join(root, "Release", "README.txt"), readme);
  return { root, dist };
}

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048, 1)]);
const README = "Clinical Scribe - Release folder\n\nAndroid app: clinical-scribe.apk\n  Version 1.2.0 (code 10200), 0.0 MB\n";

test("the connect file holds public values only, and the apps accept it", () => {
  const file = connectFile({ projectUrl: "https://abc.supabase.co/", publishableKey: PUBLISHABLE, version: "1.2.0", app });
  assert.deepEqual(Object.keys(file).sort(), ["app", "app_url", "name", "publishable_key", "server_url", "site_url", "version"]);
  assert.equal(file.server_url, "https://abc.supabase.co");
  assert.equal(file.app_url, "https://name.github.io/General-Tools/app/");
  const { connection } = readAnswer(file);
  assert.equal(connection.serverUrl, "https://abc.supabase.co");
  assert.equal(connection.siteUrl, "https://name.github.io/General-Tools/");
  assert.equal(Object.keys(connectFile({ projectUrl: "https://abc.supabase.co", publishableKey: PUBLISHABLE, version: "1.2.0" })).includes("site_url"), false);
});

test("with an Android app in the Release folder, the website offers it for download", () => {
  const { root, dist } = tempTool({ apk: ZIP, readme: README });
  const result = addPhoneApps(dist, { root, projectUrl: "https://abc.supabase.co", version: "1.2.0", app, publishableKey: PUBLISHABLE });
  assert.deepEqual(result.androidApp, { path: APK_PATH, size: ZIP.length, version: "1.2.0" });
  assert.deepEqual(readFileSync(join(dist, APK_PATH)), ZIP);
  const site = JSON.parse(readFileSync(join(dist, "connect.json"), "utf8"));
  const inApp = JSON.parse(readFileSync(join(dist, "app", "connect.json"), "utf8"));
  assert.deepEqual(readAndroidApp(site), { path: APK_PATH, version: "1.2.0", size: ZIP.length });
  assert.equal("android_app" in inApp, false, "the download address is relative to the website, so only its file names it");
  assert.equal(readAnswer(inApp).connection.appUrl, "https://name.github.io/General-Tools/app/");
});

test("without an Android app, nothing is offered; a file that is not an app stops the deploy", () => {
  const empty = tempTool();
  assert.equal(androidRelease(empty.root), null);
  assert.equal(addPhoneApps(empty.dist, { root: empty.root, projectUrl: "https://abc.supabase.co", version: "1.2.0", app, publishableKey: PUBLISHABLE }).androidApp, null);
  assert.equal(existsSync(join(empty.dist, "downloads")), false);

  const noNotes = tempTool({ apk: ZIP });
  assert.deepEqual(androidRelease(noNotes.root), { file: join(noNotes.root, "Release", "clinical-scribe.apk"), version: "", size: ZIP.length });

  const notAnApp = tempTool({ apk: Buffer.from("<html>not an app</html>") });
  assert.throws(() => androidRelease(notAnApp.root), /not an Android app file/);
});

test("the server settings let the Android app reach the functions and sign-in return to it", () => {
  assert.deepEqual(phoneAppSecrets({ app, publishableKey: PUBLISHABLE }), [
    { name: "CS_PUBLISHABLE_KEY", value: PUBLISHABLE },
    { name: "CS_SITE_URL", value: "https://name.github.io/General-Tools/" },
  ]);
  assert.deepEqual(phoneAppSecrets({ app: null, publishableKey: PUBLISHABLE }), [{ name: "CS_PUBLISHABLE_KEY", value: PUBLISHABLE }]);
  assert.equal(allowedOrigins(app), "https://name.github.io,https://localhost");
  assert.equal(allowedOrigins(null), "");
});

test("the website's header files let the apps read the connect files from any address", () => {
  const headers = readFileSync(join(toolRoot, "web/public/_headers"), "utf8");
  for (const path of ["/connect.json", "/app/connect.json"]) {
    assert.match(headers, new RegExp(`^${path.replace(/[/.]/g, "\\$&")}\\n {2}Access-Control-Allow-Origin: \\*$`, "m"));
  }
  const vercel = JSON.parse(readFileSync(join(toolRoot, "web/vercel.json"), "utf8"));
  for (const path of ["/connect.json", "/app/connect.json"]) {
    const rule = vercel.headers.find((item) => item.source === path);
    assert.ok(rule?.headers.some((item) => item.key === "Access-Control-Allow-Origin" && item.value === "*"), path);
  }
  // Every other page keeps its protections.
  assert.match(headers, /X-Frame-Options: DENY/);
});
