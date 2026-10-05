// Unit tests for how the phone apps find and remember a server: the server link,
// the answer checks (secret keys refused), version rules, the lookup order, app
// links, platform detection and the Android app published with a website.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { lookupTargets, storageName, tidyLink } from "../../web/src/lib/connection/link.js";
import { lookupServer } from "../../web/src/lib/connection/lookup.js";
import { androidAppAt, publishedAndroidApp, readAndroidApp, readSiteInfo, sizeText } from "../../web/src/lib/connection/published.js";
import { checkKey, checkServerUrl, cleanName, isSavedConnection, readAnswer } from "../../web/src/lib/connection/validate.js";
import { compareVersions, isNewerVersion, parseVersion, serverTooOld } from "../../web/src/lib/connection/versions.js";
import { detectPlatform, isPhoneOrTablet, isStandalone } from "../../web/src/lib/platform/detect.js";
import { parseAppLink } from "../../web/src/lib/platform/links.js";

const PUBLISHABLE = "sb_publishable_abcdefghijklmnopqrstuvwx";
const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url")}.c2lnbmF0dXJlLXZhbHVl`;

function answer(extra = {}) {
  return { app: "clinical-scribe", server_url: "https://abc.supabase.co", publishable_key: PUBLISHABLE, name: "St Mary's Clinic", version: "1.2.0", ...extra };
}

test("server links are tidied into full https addresses", () => {
  assert.deepEqual(tidyLink(" scribe.example.org "), { url: "https://scribe.example.org/" });
  assert.deepEqual(tidyLink("https://name.github.io/General-Tools/index.html?x=1#top"), { url: "https://name.github.io/General-Tools/" });
  assert.deepEqual(tidyLink("name.github.io/General-Tools/app"), { url: "https://name.github.io/General-Tools/app/" });
  assert.deepEqual(tidyLink("http://127.0.0.1:54321"), { url: "http://127.0.0.1:54321/" });
  assert.deepEqual(tidyLink("localhost:4173/app"), { url: "https://localhost:4173/app/" });
  assert.deepEqual(tidyLink(""), { error: "empty" });
  assert.deepEqual(tidyLink("   "), { error: "empty" });
  assert.deepEqual(tidyLink("http://scribe.example.org"), { error: "not_https" });
  for (const bad of ["not a link", "ftp://scribe.example.org", "javascript:alert(1)", "https://user:pass@scribe.example.org", "https://intranet", "x".repeat(501)]) {
    assert.deepEqual(tidyLink(bad), { error: "invalid" }, bad);
  }
});

test("a website is asked first, a Supabase address asks its server function first", () => {
  assert.deepEqual(lookupTargets("https://name.github.io/General-Tools/").map((target) => target.url), [
    "https://name.github.io/General-Tools/connect.json",
    "https://name.github.io/functions/v1/connect",
  ]);
  assert.deepEqual(lookupTargets("https://abc.supabase.co/").map((target) => target.kind), ["server", "site"]);
  assert.equal(storageName("https://abc.supabase.co"), "clinical-scribe-auth-abc-supabase-co");
  assert.equal(storageName("http://127.0.0.1:54321"), "clinical-scribe-auth-127-0-0-1-54321");
});

test("only public keys are accepted; secret keys are refused outright", () => {
  assert.equal(checkKey(PUBLISHABLE), "ok");
  assert.equal(checkKey(jwt("anon")), "ok");
  assert.equal(checkKey("sb_secret_abcdefghijklmnopqrstuvwx"), "secret");
  assert.equal(checkKey(jwt("service_role")), "secret");
  assert.equal(checkKey(jwt("supabase_admin")), "secret");
  assert.equal(checkKey("hello"), "invalid");
  assert.equal(checkKey(null), "invalid");

  assert.equal(readAnswer(answer({ publishable_key: "sb_secret_abcdefghijklmnopqrstuvwx" })).error, "secret_key");
  assert.equal(readAnswer(answer({ publishable_key: jwt("service_role") })).error, "secret_key");
  assert.equal(readAnswer(answer({ app: "something-else" })).error, "not_found");
  assert.equal(readAnswer([]).error, "not_found");
  assert.equal(readAnswer(answer({ server_url: "http://abc.supabase.co" })).error, "bad_answer");
  assert.equal(readAnswer(answer({ server_url: "https://abc.supabase.co/rest/v1" })).error, "bad_answer");
  assert.equal(readAnswer(answer({ version: "latest" })).error, "bad_answer");
});

test("a good answer is read field by field", () => {
  const { connection } = readAnswer(answer({ name: "  St‮ Mary's\u0007   Clinic ", site_url: "https://name.github.io/General-Tools/", app_url: "javascript:alert(1)", extra: "ignored" }));
  assert.deepEqual(connection, {
    serverUrl: "https://abc.supabase.co",
    publishableKey: PUBLISHABLE,
    name: "St Mary's Clinic",
    version: "1.2.0",
    siteUrl: "https://name.github.io/General-Tools/",
    appUrl: "",
  });
  assert.equal(checkServerUrl("https://abc.supabase.co/"), "https://abc.supabase.co");
  assert.equal(checkServerUrl("https://abc.supabase.co/?x=1"), null);
  assert.equal(cleanName("x".repeat(100)).length, 80);
  assert.equal(isSavedConnection({ serverUrl: "https://abc.supabase.co", publishableKey: PUBLISHABLE, link: "https://abc.supabase.co/" }), true);
  assert.equal(isSavedConnection({ serverUrl: "https://abc.supabase.co", publishableKey: "sb_secret_abcdefghijklmnopqrstuvwx", link: "x" }), false);
});

test("version rules", () => {
  assert.deepEqual(parseVersion("1.2.0"), [1, 2, 0]);
  assert.equal(parseVersion("1.2"), null);
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(serverTooOld("1.1.9"), true);
  assert.equal(serverTooOld("1.3.9"), true);
  assert.equal(serverTooOld("1.4.9"), true, "Voice Note needs a 1.5.0 server");
  assert.equal(serverTooOld("1.5.0"), false);
  assert.equal(serverTooOld(undefined), true);
  assert.equal(isNewerVersion("1.2.1", "1.2.0"), true);
  assert.equal(isNewerVersion("1.2.0", "1.2.0"), false);
  assert.equal(isNewerVersion("1.1.0", "1.2.0"), false);
  assert.equal(isNewerVersion("", "1.2.0"), false);
});

// A stand-in for the network: answers by address, records what was asked.
function network(routes) {
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    asked.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, credentials: init.credentials });
    const route = routes[String(url)];
    if (route === "offline") throw new TypeError("Failed to fetch");
    if (!route) return new Response("Not found", { status: 404 });
    return new Response(typeof route === "string" ? route : JSON.stringify(route), { status: 200 });
  };
  return { asked, fetchImpl };
}

const CONFIG_URL = "https://abc.supabase.co/rest/v1/rpc/get_public_config";

test("the lookup reads the website's connect file, then proves the key works", async () => {
  const { asked, fetchImpl } = network({
    "https://name.github.io/General-Tools/connect.json": answer({ name: "" }),
    [CONFIG_URL]: { server_version: "1.5.0", google_enabled: true, clinic_name: "Renamed Clinic" },
  });
  const result = await lookupServer("name.github.io/General-Tools", { fetchImpl });
  assert.deepEqual(result.connection, {
    serverUrl: "https://abc.supabase.co",
    publishableKey: PUBLISHABLE,
    name: "Renamed Clinic",
    version: "1.5.0",
    siteUrl: "",
    appUrl: "",
    googleEnabled: true,
    link: "https://name.github.io/General-Tools/",
  });
  assert.deepEqual(asked.map((item) => `${item.method} ${item.url}`), ["GET https://name.github.io/General-Tools/connect.json", `POST ${CONFIG_URL}`]);
  assert.ok(asked.every((item) => item.credentials === "omit"), "no cookies are ever sent");
  assert.deepEqual(asked[1].headers.apikey, PUBLISHABLE);
  assert.equal("Authorization" in asked[1].headers, false, "a publishable key is sent only as apikey");
});

test("the server's own clinic name wins over the one in the connect file", async () => {
  const { fetchImpl } = network({
    "https://abc.supabase.co/functions/v1/connect": answer({ name: "Old Name" }),
    [CONFIG_URL]: { server_version: "1.5.0", clinic_name: "New Name" },
  });
  assert.equal((await lookupServer("abc.supabase.co", { fetchImpl })).connection.name, "New Name");
});

test("lookup problems are told apart", async () => {
  assert.deepEqual(await lookupServer("", { fetchImpl: network({}).fetchImpl }), { error: "empty" });
  assert.deepEqual(await lookupServer("http://scribe.example.org", { fetchImpl: network({}).fetchImpl }), { error: "not_https" });
  assert.deepEqual(await lookupServer("scribe.example.org", { fetchImpl: network({}).fetchImpl }), { error: "not_found" });
  const offline = network({ "https://scribe.example.org/connect.json": "offline", "https://scribe.example.org/functions/v1/connect": "offline" });
  assert.deepEqual(await lookupServer("scribe.example.org", { fetchImpl: offline.fetchImpl }), { error: "offline" });
  const secret = network({ "https://scribe.example.org/connect.json": answer({ publishable_key: "sb_secret_abcdefghijklmnopqrstuvwx" }) });
  assert.deepEqual(await lookupServer("scribe.example.org", { fetchImpl: secret.fetchImpl }), { error: "secret_key" });
  assert.equal(secret.asked.some((item) => item.url === CONFIG_URL), false, "a secret key is never used");
  const old = network({ "https://scribe.example.org/connect.json": answer(), [CONFIG_URL]: { server_version: "1.1.0" } });
  assert.deepEqual(await lookupServer("scribe.example.org", { fetchImpl: old.fetchImpl }), { error: "server_old" });
  const huge = network({ "https://scribe.example.org/connect.json": JSON.stringify({ ...answer(), pad: "x".repeat(30000) }) });
  assert.deepEqual(await lookupServer("scribe.example.org", { fetchImpl: huge.fetchImpl }), { error: "not_found" });
});

test("app links: only connect and sign-in return links are accepted", () => {
  assert.deepEqual(parseAppLink("io.github.albusthaw.clinicalscribe://connect?server=https%3A%2F%2Fname.github.io%2FGeneral-Tools%2F"), {
    kind: "connect",
    server: "https://name.github.io/General-Tools/",
  });
  assert.deepEqual(parseAppLink("io.github.albusthaw.clinicalscribe://auth?code=abcDEF12-_xyz"), { kind: "auth", code: "abcDEF12-_xyz" });
  assert.deepEqual(parseAppLink("io.github.albusthaw.clinicalscribe://auth?error=access_denied"), { kind: "auth", failed: true });
  for (const bad of [
    "io.github.albusthaw.clinicalscribe://connect?server=http%3A%2F%2Fscribe.example.org",
    "io.github.albusthaw.clinicalscribe://connect?server=javascript%3Aalert(1)",
    "io.github.albusthaw.clinicalscribe://auth?code=bad%20code%3Cscript%3E",
    "io.github.albusthaw.clinicalscribe://auth",
    "io.github.albusthaw.clinicalscribe://settings",
    "https://scribe.example.org/connect?server=https://x.example",
    "",
    null,
  ]) {
    assert.equal(parseAppLink(bad), null, String(bad));
  }
});

test("platform detection", () => {
  const win = (userAgent, extra = {}) => ({ navigator: { userAgent, maxTouchPoints: 0, ...extra } });
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  assert.equal(detectPlatform(win(iphone)), "ios");
  assert.equal(detectPlatform(win(ipad, { maxTouchPoints: 5 })), "ios");
  assert.equal(detectPlatform(win(ipad)), "web", "a Mac without touch is a computer");
  assert.equal(detectPlatform(win(android)), "android-web");
  assert.equal(detectPlatform({ ...win(android), Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } }), "android");
  assert.equal(detectPlatform(win("Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0")), "web");
  assert.equal(isPhoneOrTablet(win(android)), true);
  assert.equal(isPhoneOrTablet(win("Mozilla/5.0 (Windows NT 10.0) Chrome/140.0")), false);
  assert.equal(isStandalone({ navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ navigator: {}, matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }), false);
});

test("the Android app published with a website is read safely", async () => {
  assert.deepEqual(readAndroidApp({ android_app: { path: "downloads/clinical-scribe.apk", version: "1.2.0", size: 3800000 } }), {
    path: "downloads/clinical-scribe.apk",
    version: "1.2.0",
    size: 3800000,
  });
  assert.deepEqual(readAndroidApp({ android_app: { path: "downloads/clinical-scribe.apk", version: "<b>", size: -1 } }), { path: "downloads/clinical-scribe.apk", version: "", size: 0 });
  for (const path of ["../evil.apk", "/abs/app.apk", "https://evil.example/app.apk", "app.exe", "downloads/../x.apk", 42]) {
    assert.equal(readAndroidApp({ android_app: { path } }), null, String(path));
  }
  assert.equal(readAndroidApp(null), null);

  const site = "https://name.github.io/General-Tools/";
  const { asked, fetchImpl } = network({ [`${site}connect.json`]: { ...answer(), android_app: { path: "downloads/clinical-scribe.apk", version: "1.3.0" } } });
  assert.deepEqual(await publishedAndroidApp(site, { fetchImpl }), {
    path: "downloads/clinical-scribe.apk",
    version: "1.3.0",
    size: 0,
    url: "https://name.github.io/General-Tools/downloads/clinical-scribe.apk",
  });
  assert.equal(asked[0].credentials, "omit");
  assert.equal(await publishedAndroidApp(site, { fetchImpl: network({}).fetchImpl }), null);
  // A host that answers every address with its home page has no connect file.
  assert.equal(await readSiteInfo(site, { fetchImpl: network({ [`${site}connect.json`]: "<!doctype html><title>Clinical Scribe</title>" }).fetchImpl }), null);
  assert.equal(androidAppAt({ android_app: { path: "downloads/clinical-scribe.apk" } }, ""), null);
  assert.equal(await publishedAndroidApp("", { fetchImpl }), null);
  assert.equal(sizeText(3_800_000), "3.6 MB");
  assert.equal(sizeText(0), "");
});

// The saved servers use the browser's storage; a small stand-in is enough here.
beforeEach(() => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
});

test("recent servers: at most five, the current one first, secret keys never kept", async () => {
  const { currentConnection, displayName, forgetConnection, leaveCurrent, recentConnections, rememberConnection } = await import("../../web/src/lib/connection/store.js");
  const make = (n) => ({ serverUrl: `https://s${n}.supabase.co`, publishableKey: PUBLISHABLE, link: `https://s${n}.supabase.co/`, name: n === 1 ? "Clinic One" : "" });
  for (let n = 1; n <= 7; n++) rememberConnection(make(n));
  assert.equal(recentConnections().length, 5);
  assert.equal(currentConnection().serverUrl, "https://s7.supabase.co");
  rememberConnection(make(5));
  assert.deepEqual(recentConnections().map((item) => item.serverUrl.slice(8, 10)), ["s5", "s7", "s6", "s4", "s3"]);
  leaveCurrent();
  assert.equal(currentConnection(), null);
  assert.equal(recentConnections().length, 5, "leaving keeps the server in the list");
  forgetConnection("https://s5.supabase.co");
  assert.equal(recentConnections().length, 4);
  assert.equal(displayName(make(1)), "Clinic One");
  assert.equal(displayName(make(2)), "s2.supabase.co");

  localStorage.setItem("cs-connections", JSON.stringify({ current: "https://x.supabase.co", list: [{ serverUrl: "https://x.supabase.co", publishableKey: "sb_secret_abcdefghijklmnopqrstuvwx", link: "x" }] }));
  assert.equal(currentConnection(), null, "a stored secret key is ignored");
  localStorage.setItem("cs-connections", "{broken");
  assert.deepEqual(recentConnections(), []);
});
