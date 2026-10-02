// Unit tests for the deploy script's helpers. They run without a network or a
// Supabase project.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCliVersion } from "../../build/deploy/cli.mjs";
import { pickKeys } from "../../build/deploy/management-api.mjs";
import { DeployError, scrub } from "../../build/deploy/output.mjs";
import { keyHeaders } from "../../build/deploy/project-api.mjs";
import { compareCounts, isSerious, signInPatch } from "../../build/deploy/server.mjs";
import { goodPassword, parseAppUrl, parseProjectRef, readSettings } from "../../build/deploy/settings.mjs";
import { findLeaks } from "../../build/deploy/web.mjs";

const REF = "abcdefghijklmnopqrst";
const LETTERS_AND_DIGITS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";

test("the project code is read from the code, the project address or a dashboard link", () => {
  assert.equal(parseProjectRef(REF), REF);
  assert.equal(parseProjectRef(` https://${REF}.supabase.co/ `), REF);
  assert.equal(parseProjectRef(`https://supabase.com/dashboard/project/${REF}/settings/api`), REF);
  assert.equal(parseProjectRef("ABCDEFGHIJKLMNOPQRST"), null);
  assert.equal(parseProjectRef("abc"), null);
  assert.equal(parseProjectRef(`https://evil.example/${REF}`), null);
});

test("the app address is tidied and must be https", () => {
  assert.deepEqual(parseAppUrl("https://name.github.io/General-Tools"), { url: "https://name.github.io/General-Tools/", origin: "https://name.github.io" });
  assert.deepEqual(parseAppUrl("https://clinic.example/index.html?x=1#y"), { url: "https://clinic.example/", origin: "https://clinic.example" });
  assert.deepEqual(parseAppUrl("http://localhost:4173/"), { url: "http://localhost:4173/", origin: "http://localhost:4173" });
  assert.equal(parseAppUrl("http://clinic.example/"), null);
  assert.equal(parseAppUrl("https://user:pass@clinic.example/"), null);
  assert.equal(parseAppUrl("not an address"), null);
});

test("the admin password rule matches the project's rule", () => {
  assert.equal(goodPassword("Short1"), false);
  assert.equal(goodPassword("onlyletters"), false);
  assert.equal(goodPassword("1234567890"), false);
  assert.equal(goodPassword("Owner-pass-2026"), true);
  assert.equal(goodPassword(`a1${"x".repeat(71)}`), false);
});

test("settings report every problem at once", () => {
  assert.throws(
    () => readSettings({ SUPABASE_PROJECT_REF: "nope", APP_URL: "ftp://x", CLINICAL_SCRIBE_ADMIN_EMAIL: "owner@clinic.test" }, { server: true, web: true }),
    (error) => {
      assert.ok(error instanceof DeployError);
      for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD", "APP_URL", "CLINICAL_SCRIBE_ADMIN_PASSWORD"]) {
        assert.match(error.message, new RegExp(name));
      }
      return true;
    },
  );
});

test("settings for a web-only build need no database password or admin", () => {
  const settings = readSettings({ SUPABASE_ACCESS_TOKEN: "sbp_example_token_000000", SUPABASE_PROJECT_REF: REF }, { server: false, web: true });
  assert.equal(settings.ref, REF);
  assert.equal(settings.projectUrl, `https://${REF}.supabase.co`);
  assert.equal(settings.functionsUrl, `https://${REF}.supabase.co/functions/v1`);
  assert.equal(settings.apiBase, "https://api.supabase.com");
  assert.equal(settings.admin, null);
  assert.equal(settings.app, null);
  assert.match(settings.version, /^\d+\.\d+\.\d+$/);
});

test("the newer keys are preferred, and masked keys are never used", () => {
  const legacy = [
    { name: "anon", type: "legacy", api_key: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLWFub24" },
    { name: "service_role", type: "legacy", api_key: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXNydg" },
  ];
  const fresh = [
    { name: "default", type: "publishable", api_key: "sb_publishable_abcdefghijklmnop0123" },
    { name: "default", type: "secret", api_key: "sb_secret_abcdefghijklmnop0123456" },
  ];
  assert.deepEqual(pickKeys([...legacy, ...fresh]), { publishable: fresh[0].api_key, secret: fresh[1].api_key });
  assert.deepEqual(pickKeys(legacy), { publishable: legacy[0].api_key, secret: legacy[1].api_key });
  const masked = [fresh[0], { name: "default", type: "secret", api_key: "sb_secret_abcd••••••••" }];
  assert.deepEqual(pickKeys([...legacy, ...masked]), { publishable: fresh[0].api_key, secret: legacy[1].api_key });
  assert.deepEqual(pickKeys(null), { publishable: null, secret: null });
});

test("newer keys are sent only as apikey; older keys also as a bearer token", () => {
  assert.deepEqual(keyHeaders("sb_secret_abc"), { apikey: "sb_secret_abc" });
  assert.deepEqual(keyHeaders("eyJx.eyJy.z"), { apikey: "eyJx.eyJy.z", Authorization: "Bearer eyJx.eyJy.z" });
});

test("sign-in settings close sign-up and keep what is already set", () => {
  const app = parseAppUrl("https://name.github.io/General-Tools/");
  const RETURN = "io.github.albusthaw.clinicalscribe://auth";
  assert.deepEqual(signInPatch({ password_min_length: 6, password_required_characters: "", uri_allow_list: "" }, app), {
    disable_signup: true,
    external_email_enabled: true,
    password_min_length: 10,
    password_required_characters: LETTERS_AND_DIGITS,
    uri_allow_list: `https://name.github.io/General-Tools/,https://name.github.io/General-Tools/**,${RETURN}`,
    site_url: "https://name.github.io/General-Tools/",
  });
  const kept = signInPatch(
    { password_min_length: 14, password_required_characters: "abc:ABC:123", uri_allow_list: `https://name.github.io/General-Tools/, ${RETURN}, http://localhost:5173/` },
    app,
  );
  assert.equal(kept.password_min_length, 14);
  assert.equal("password_required_characters" in kept, false);
  assert.equal(kept.uri_allow_list, `https://name.github.io/General-Tools/,${RETURN},http://localhost:5173/,https://name.github.io/General-Tools/**`);
  // Without a website address, sign-in may still return to the Android app.
  const noApp = signInPatch({}, null);
  assert.equal("site_url" in noApp, false);
  assert.equal(noApp.uri_allow_list, RETURN);
});

test("the leak check finds secret keys, tokens and server JWTs in built files", () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-leaks-"));
  mkdirSync(join(dir, "assets"));
  const serverJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.c2ln`;
  const anonJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.c2ln`;
  writeFileSync(join(dir, "index.html"), `<script>const key = "${anonJwt}"; const pk = "sb_publishable_abc123";</script>`);
  writeFileSync(join(dir, "assets", "clean.js"), "export const ok = 1;");
  assert.deepEqual(findLeaks(dir, ["a-database-password-0001"]), []);

  writeFileSync(join(dir, "assets", "a.js"), `const k = "sb_secret_abcdefghijk";`);
  writeFileSync(join(dir, "assets", "b.js"), `const t = "sbp_0123456789abcdef0123456789";`);
  writeFileSync(join(dir, "assets", "c.js"), `const j = "${serverJwt}";`);
  writeFileSync(join(dir, "assets", "d.css"), `/* a-database-password-0001 */`);
  writeFileSync(join(dir, "assets", "e.png"), "sb_secret_abcdefghijk");
  assert.deepEqual(findLeaks(dir, ["a-database-password-0001"]).sort(), ["assets/a.js", "assets/b.js", "assets/c.js", "assets/d.css"]);
});

test("anything key-like is removed from service messages", () => {
  const text = scrub("bad key sb_secret_abc123XYZ and token sbp_abcdef0123 and eyJa.eyJb.c-d_e");
  assert.equal(text, "bad key [key] and token [token] and [key]");
  assert.equal(scrub("x".repeat(1000)).length, 400);
});

test("the Supabase tool version is read from its output", () => {
  assert.deepEqual(parseCliVersion("2.119.0\n"), [2, 119, 0]);
  assert.deepEqual(parseCliVersion("A new version is available: v2.200.1"), [2, 200, 1]);
  assert.equal(parseCliVersion("no version"), null);
});

test("the record check spots lost records and tells a slip from a loss", () => {
  const before = { people: 12, recordings: 340, notes: 512, templates: 9, audit_entries: 2000, credit_entries: 400 };
  assert.deepEqual(compareCounts(before, { ...before, recordings: 345, notes: 520 }), [], "more records is fine");
  assert.deepEqual(compareCounts(null, before), [], "nothing to compare on a first install");

  const slip = compareCounts(before, { ...before, recordings: 339 });
  assert.deepEqual(slip, [{ key: "recordings", label: "recordings", was: 340, now: 339, lost: 1 }]);
  assert.equal(slip.some(isSerious), false, "one recording deleted during the deploy is not a loss");

  assert.equal(compareCounts(before, { ...before, notes: 0 }).some(isSerious), true, "an emptied table is a loss");
  assert.equal(compareCounts(before, { ...before, templates: 4 }).some(isSerious), true, "five gone is a loss");
  assert.equal(compareCounts(before, { ...before, audit_entries: 1999 }).some(isSerious), true, "the audit log never shrinks");
});
