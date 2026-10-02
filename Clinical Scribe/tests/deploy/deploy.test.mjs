// Runs the real deploy script against the local Supabase stack. The Supabase
// command-line tool and the Management API are stand-ins (fake-supabase-cli.mjs and
// tests/mock-ai/server.mjs); the database and the sign-in service are the local ones.
// Needs a freshly reset local database with no accounts: tests/run-local.sh does this.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, test } from "node:test";
import { localStack, mock, MOCK_URL, signIn, sql, toolRoot } from "../helpers/local.mjs";

const REF = "abcdefghijklmnopqrst";
const TOKEN = "sbp_test_management_token_0001";
const DB_PASSWORD = "local-db-password-0001";
const ADMIN = { email: "owner@clinic.test", password: "Owner-pass-2026", name: "Dr Morgan Reed" };
const APP = "https://clinic.example.test/scribe/";
const VERSION = readFileSync(join(toolRoot, "VERSION"), "utf8").trim();
const LETTERS_AND_DIGITS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";
const STRICTER = "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";

function keys({ legacyOnly = false } = {}) {
  const stack = localStack();
  const legacy = [
    { name: "anon", type: "legacy", api_key: stack.anonKey },
    { name: "service_role", type: "legacy", api_key: stack.serviceRoleKey },
  ];
  if (legacyOnly) return legacy;
  return [
    ...legacy,
    { name: "default", type: "publishable", api_key: stack.publishableKey },
    { name: "default", type: "secret", api_key: stack.secretKey },
  ];
}

function runDeploy(part, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cs-deploy-"));
  const files = { cli: join(dir, "cli.log"), output: join(dir, "output.txt"), summary: join(dir, "summary.md") };
  const result = spawnSync(process.execPath, [join(toolRoot, "build/deploy/deploy.mjs"), part], {
    encoding: "utf8",
    timeout: 240_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SUPABASE_ACCESS_TOKEN: TOKEN,
      SUPABASE_PROJECT_REF: REF,
      SUPABASE_DB_PASSWORD: DB_PASSWORD,
      APP_URL: `${APP}index.html`,
      CLINICAL_SCRIBE_ADMIN_EMAIL: ADMIN.email,
      CLINICAL_SCRIBE_ADMIN_PASSWORD: ADMIN.password,
      CLINICAL_SCRIBE_ADMIN_NAME: ADMIN.name,
      CS_TEST_DEPLOY_CLI: join(toolRoot, "tests/deploy/fake-supabase-cli.mjs"),
      CS_TEST_DEPLOY_API_BASE: MOCK_URL,
      CS_TEST_DEPLOY_PROJECT_URL: localStack().url,
      // Keeps the local worker reachable from inside the database container.
      CS_TEST_DEPLOY_FUNCTIONS_URL: "http://kong:8000/functions/v1",
      FAKE_CLI_LOG: files.cli,
      GITHUB_OUTPUT: files.output,
      GITHUB_STEP_SUMMARY: files.summary,
      ...extra,
    },
  });
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  return {
    code: result.status,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    calls: read(files.cli).split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    output: read(files.output),
    summary: read(files.summary),
  };
}

const commands = (run) => run.calls.map((call) => call.args.join(" "));
const setting = (key) => sql(`select value from app_private.app_meta where key = '${key}'`);

before(async () => {
  await mock("/__reset", {});
  await mock("/__api_keys", keys());
});

test("a first deploy sets up the server, the sign-in settings and the first admin", async () => {
  assert.equal(sql("select count(*) from auth.users"), "0", "the local database should start with no accounts");
  const run = runDeploy("server");
  assert.equal(run.code, 0, run.out);

  assert.deepEqual(commands(run), [
    "--version",
    `link --project-ref ${REF} --yes`,
    "db push --linked --yes",
    `functions deploy --project-ref ${REF} --no-verify-jwt --use-api --yes`,
  ]);
  for (const call of run.calls) {
    assert.equal(call.hasToken, true);
    assert.equal(call.hasDbPassword, true);
    assert.equal(resolve(call.cwd), resolve(toolRoot), "the tool runs in the Clinical Scribe folder");
  }

  assert.deepEqual(await mock("/__secrets"), { CS_PROJECT_REF: REF, CS_ALLOWED_ORIGINS: "https://clinic.example.test" });

  const auth = await mock("/__auth_config");
  assert.equal(auth.disable_signup, true);
  assert.equal(auth.external_email_enabled, true);
  assert.equal(auth.password_min_length, 10);
  assert.equal(auth.password_required_characters, LETTERS_AND_DIGITS);
  assert.equal(auth.site_url, APP);
  assert.equal(auth.uri_allow_list, `${APP},${APP}**`);

  assert.equal(sql("select value from app_private.runtime_config where key = 'functions_url'"), "http://kong:8000/functions/v1");
  assert.equal(setting("schema_version"), VERSION);

  assert.equal(
    sql(`select role || ' ' || status || ' ' || full_name from public.profiles where email = '${ADMIN.email}'`),
    `admin active ${ADMIN.name}`,
  );
  const admin = await signIn(ADMIN.email, ADMIN.password);
  const { data: context, error } = await admin.rpc("get_my_context");
  assert.equal(error, null);
  assert.equal(context.profile.role, "admin");

  assert.match(run.output, new RegExp(`^app_url=${APP.replace(/[.]/g, "\\.")}$`, "m"));
  assert.match(run.summary, /\*\*First admin:\*\* Created/);
  for (const secret of [ADMIN.password, TOKEN, DB_PASSWORD, localStack().secretKey, localStack().serviceRoleKey]) {
    assert.ok(!run.out.includes(secret), "the deploy never prints a secret");
    assert.ok(!run.summary.includes(secret), "the summary never holds a secret");
  }
});

test("running the deploy again is safe, keeps settings and records the upgrade", async () => {
  sql("update app_private.app_meta set value = '0.9.0' where key = 'schema_version'");
  await mock("/__auth_config", {
    site_url: APP,
    uri_allow_list: `${APP},http://localhost:5173/`,
    disable_signup: true,
    external_google_enabled: true,
    password_min_length: 12,
    password_required_characters: STRICTER,
  });

  const run = runDeploy("server");
  assert.equal(run.code, 0, run.out);
  assert.equal(sql("select count(*) from public.profiles"), "1", "no second admin is made");
  assert.match(run.summary, /already has accounts/);

  const auth = await mock("/__auth_config");
  assert.equal(auth.external_google_enabled, true, "Google sign-in stays as the admin set it");
  assert.equal(auth.password_min_length, 12, "a stricter length is kept");
  assert.equal(auth.password_required_characters, STRICTER, "a stricter rule is kept");
  assert.equal(auth.uri_allow_list, `${APP},http://localhost:5173/,${APP}**`, "listed addresses are kept, none twice");

  assert.equal(setting("schema_version"), VERSION);
  assert.equal(
    sql("select (details->>'from') || ' ' || (details->>'to') from public.audit_log where action = 'server.updated' order by id desc limit 1"),
    `0.9.0 ${VERSION}`,
  );
});

test("a project with only the older keys works too", async () => {
  await mock("/__api_keys", keys({ legacyOnly: true }));
  try {
    const run = runDeploy("server", { CLINICAL_SCRIBE_ADMIN_EMAIL: "", CLINICAL_SCRIBE_ADMIN_PASSWORD: "" });
    assert.equal(run.code, 0, run.out);
    assert.match(run.summary, /\*\*First admin:\*\* Not requested/);
  } finally {
    await mock("/__api_keys", keys());
  }
});

test("a failed step stops the deploy with a plain message", async () => {
  await mock("/__reset", {});
  const run = runDeploy("server", { FAKE_CLI_FAIL: "functions" });
  assert.equal(run.code, 1);
  assert.match(run.out, /Publishing the server functions did not finish/);
  assert.deepEqual(await mock("/__secrets"), {}, "later steps did not run");
  assert.equal((await mock("/__auth_config")).disable_signup, true, "sign-up was switched off before anything else");
});

test("a paused project is reported before anything changes", async () => {
  await mock("/__project", { status: "INACTIVE" });
  try {
    const run = runDeploy("server");
    assert.equal(run.code, 1);
    assert.match(run.out, /The Supabase project is paused/);
    assert.equal(run.calls.length, 0, "the Supabase tool was not used");
  } finally {
    await mock("/__project", { status: "ACTIVE_HEALTHY" });
  }
});

test("a wrong access token is explained", () => {
  const run = runDeploy("check", { SUPABASE_ACCESS_TOKEN: "sbp_not_a_real_token_000000" });
  assert.equal(run.code, 1);
  assert.match(run.out, /did not accept the access token/);
});

test("missing or wrong values are listed together", () => {
  const run = runDeploy("server", { SUPABASE_PROJECT_REF: "", SUPABASE_DB_PASSWORD: "", CLINICAL_SCRIBE_ADMIN_PASSWORD: "short" });
  assert.equal(run.code, 1);
  assert.match(run.out, /SUPABASE_PROJECT_REF is missing/);
  assert.match(run.out, /SUPABASE_DB_PASSWORD is missing/);
  assert.match(run.out, /CLINICAL_SCRIBE_ADMIN_PASSWORD should be 10 to 72 characters/);
  assert.equal(run.calls.length, 0);
});

test("check mode changes nothing", async () => {
  const authBefore = await mock("/__auth_config");
  const run = runDeploy("check");
  assert.equal(run.code, 0, run.out);
  assert.match(run.out, /Nothing was changed/);
  assert.deepEqual(commands(run), ["--version"]);
  assert.deepEqual(await mock("/__auth_config"), authBefore);
  assert.deepEqual(await mock("/__secrets"), {});
});
