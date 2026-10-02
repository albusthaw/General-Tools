// Server checks for the phone apps: the public connect function, the clinic name
// (admins only, audited) and the public settings the apps read before sign-in.
// Runs on the local stack with the functions server (tests/run-local.sh api).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { browserClient, friendlyCode, localStack, serverClient, signIn, sql, toolRoot } from "../helpers/local.mjs";

const VERSION = readFileSync(join(toolRoot, "VERSION"), "utf8").trim();
const MANAGER = { email: "apps-admin@example.test", password: "Apps-admin-2026" };
const CLINICIAN = { email: "apps-user@example.test", password: "Apps-user-2026" };
const state = {};

async function person(who, role) {
  const { data, error } = await serverClient().auth.admin.createUser({ email: who.email, password: who.password, email_confirm: true });
  assert.equal(error, null, error?.message);
  sql(`update public.profiles set role = '${role}', status = 'active' where id = '${data.user.id}'`);
  return signIn(who.email, who.password);
}

describe("phone apps", () => {
  before(async () => {
    sql(`select public.svc_set_server_version('${VERSION}')`);
    state.admin = await person(MANAGER, "admin");
    state.user = await person(CLINICIAN, "user");
  });

  it("the connect function gives the apps public details only, to any address", async () => {
    const stack = localStack();
    const response = await fetch(`${stack.url}/functions/v1/connect`, { headers: { Origin: "https://localhost" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("cache-control") ?? "", /max-age=300/);
    const text = await response.text();
    const answer = JSON.parse(text);
    assert.deepEqual(answer, {
      app: "clinical-scribe",
      server_url: "http://127.0.0.1:54321",
      publishable_key: stack.publishableKey,
      name: "",
      version: VERSION,
      site_url: "http://127.0.0.1:4173/",
      app_url: "http://127.0.0.1:4173/app/",
    });
    for (const secret of [stack.secretKey, stack.serviceRoleKey]) assert.ok(!text.includes(secret), "no secret key in the answer");
  });

  it("the connect function only answers reading", async () => {
    const url = `${localStack().url}/functions/v1/connect`;
    const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://localhost", "Access-Control-Request-Method": "GET" } });
    // The local gateway answers this check itself (200); on Supabase the function does (204).
    assert.ok([200, 204].includes(preflight.status), `preflight answered ${preflight.status}`);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    await preflight.arrayBuffer();
    const post = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(post.status, 405);
    await post.arrayBuffer();
  });

  it("an admin names the clinic; the change is audited and shown before sign-in", async () => {
    const { error } = await state.admin.rpc("admin_set_clinic_name", { p_name: "  St   Mary's \n Clinic  " });
    assert.equal(error, null, error?.message);
    const { data, error: readError } = await browserClient().rpc("get_public_config");
    assert.equal(readError, null);
    assert.equal(data.clinic_name, "St Mary's Clinic");
    assert.equal(data.server_version, VERSION);
    assert.equal(
      sql("select (details->>'from') || '|' || (details->>'to') from public.audit_log where action = 'settings.clinic_name_changed' order by id desc limit 1"),
      "|St Mary's Clinic",
    );
    const connect = await (await fetch(`${localStack().url}/functions/v1/connect`)).json();
    assert.equal(connect.name, "St Mary's Clinic");

    // Saving the same name again writes no new audit entry.
    const before = sql("select count(*) from public.audit_log where action = 'settings.clinic_name_changed'");
    assert.equal((await state.admin.rpc("admin_set_clinic_name", { p_name: "St Mary's Clinic" })).error, null);
    assert.equal(sql("select count(*) from public.audit_log where action = 'settings.clinic_name_changed'"), before);
  });

  it("only admins may name the clinic, and odd names are refused", async () => {
    const fromUser = await state.user.rpc("admin_set_clinic_name", { p_name: "Mine now" });
    assert.ok(fromUser.error, "a clinician cannot change the name");
    const fromAnyone = await browserClient().rpc("admin_set_clinic_name", { p_name: "Anyone" });
    assert.ok(fromAnyone.error, "nobody signed out can change the name");
    const tooLong = await state.admin.rpc("admin_set_clinic_name", { p_name: "x".repeat(81) });
    assert.equal(friendlyCode(tooLong.error), "invalid_input");
    const hidden = await state.admin.rpc("admin_set_clinic_name", { p_name: "Clinic\u0007" });
    assert.equal(friendlyCode(hidden.error), "invalid_input");
    assert.equal((await browserClient().rpc("get_public_config")).data.clinic_name, "St Mary's Clinic", "the name did not change");
  });
});
