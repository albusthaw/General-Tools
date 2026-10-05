// A real upgrade on the local stack. The database is set back to version 1.0.0 and
// filled with records, then brought up to date with the newer migrations, the same
// way "supabase db push" upgrades a hosted project. Every record must still be
// there afterwards, and the new features (up to Voice Note in 1.5.0) must work with
// the old records.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { serverClient, signIn, sql, toolRoot } from "../helpers/local.mjs";

const BASELINE = "20261002100900"; // the last migration of version 1.0.0
const SCRIBE = "11111111-1111-4111-8111-111111111111";
// Jobs are left out: the clock adds and removes those on its own.
const TABLES = [
  "public.profiles",
  "public.scribes",
  "public.scribe_segments",
  "public.notes",
  "public.templates",
  "public.audit_log",
  "public.credit_ledger",
  "public.review_sessions",
];
const ADMIN = { email: "upgrade-admin@clinic.test", password: "Upgrade-admin-2026", name: "Dr Robin Ash" };
const USER = { email: "upgrade-user@clinic.test", password: "Upgrade-user-2026", name: "Dr Kim Vale" };

const counts = () => Object.fromEntries(TABLES.map((table) => [table, Number(sql(`select count(*) from ${table}`))]));
const migrationFiles = () => readdirSync(join(toolRoot, "supabase/migrations")).filter((name) => name.endsWith(".sql"));

test("upgrading from 1.0.0 keeps every record, and the new features work with old records", async () => {
  execFileSync("supabase", ["db", "reset", "--local", "--version", BASELINE], { cwd: toolRoot, stdio: "ignore" });
  assert.equal(sql("select count(*) from supabase_migrations.schema_migrations"), "10", "the database starts at 1.0.0");

  // Records made with version 1.0.0: an admin, a clinician, a finished recording
  // with its audio part and final note, a personal template and minutes.
  const server = serverClient();
  for (const person of [ADMIN, USER]) {
    const { error } = await server.auth.admin.createUser({
      email: person.email,
      password: person.password,
      email_confirm: true,
      user_metadata: { full_name: person.name },
    });
    assert.equal(error, null, error?.message);
  }
  const owner = sql(`select id from public.profiles where email = '${USER.email}'`);
  sql(`update public.profiles set status = 'active', credit_seconds_elevenlabs = 3600 where id = '${owner}'`);
  sql(`insert into public.credit_ledger (user_id, provider, change_seconds, balance_after, kind, note)
       values ('${owner}', 'elevenlabs', 3600, 3600, 'grant', 'Starting minutes')`);
  sql(`insert into public.scribes (id, owner_id, title, status, segment_count, duration_seconds, transcript, finished_at, transcribed_at)
       values ('${SCRIBE}', '${owner}', 'Old visit', 'transcribed', 1, 600, 'Speaker 1: Hello', now() - interval '1 day', now() - interval '1 day')`);
  sql(`insert into public.scribe_segments (scribe_id, owner_id, seq, storage_path, mime_type, byte_size, duration_seconds, status)
       values ('${SCRIBE}', '${owner}', 1, '${owner}/${SCRIBE}/0001.webm', 'audio/webm', 2048, 600, 'done')`);
  sql(`insert into public.notes (scribe_id, owner_id, template_name, template_body, provider, model, status, content, completed_at)
       values ('${SCRIBE}', '${owner}', 'SOAP note', 'Subjective:', 'gemini', 'gemini-3.8-flash', 'done', 'Subjective: Cough', now())`);
  sql(`insert into public.templates (scope, owner_id, name, body) values ('personal', '${owner}', 'Old template', 'Section one: [details]')`);

  const before = counts();
  execFileSync("supabase", ["migration", "up", "--local"], { cwd: toolRoot, stdio: "ignore" });
  assert.equal(sql("select count(*) from supabase_migrations.schema_migrations"), String(migrationFiles().length), "every newer migration was applied");
  // The only new record is the shared Dictated note template, the Voice Note default (1.5.0).
  const upgraded = counts();
  assert.equal(upgraded["public.templates"], before["public.templates"] + 1);
  assert.deepEqual({ ...upgraded, "public.templates": before["public.templates"] }, before, "every record is still there after the upgrade");
  assert.equal(sql(`select content from public.notes where scribe_id = '${SCRIBE}'`), "Subjective: Cough", "notes are unchanged");
  assert.equal(sql(`select transcript from public.scribes where id = '${SCRIBE}'`), "Speaker 1: Hello", "transcripts are unchanged");

  // Old recordings and templates are Clinical Scribe ones; each type has its default.
  assert.equal(sql(`select mode from public.scribes where id = '${SCRIBE}'`), "scribe");
  assert.equal(sql("select string_agg(distinct mode, ',') from public.templates where name <> 'Dictated note'"), "scribe");
  assert.equal(sql("select string_agg(mode || ':' || name, ',' order by mode) from public.templates where is_default"), "scribe:SOAP note,voice:Dictated note");

  // The deploy's own count sees the same records.
  const summary = JSON.parse(sql("select public.svc_data_summary()::text"));
  assert.equal(summary.recordings, before["public.scribes"]);
  assert.equal(summary.notes, before["public.notes"]);
  assert.equal(summary.people, before["public.profiles"]);

  // The new Recording page lists the old recording, with its audio kept.
  const admin = await signIn(ADMIN.email, ADMIN.password);
  const listed = await admin.rpc("admin_list_recordings", {});
  assert.equal(listed.error, null, listed.error?.message);
  const old = listed.data.find((row) => row.scribe_id === SCRIBE);
  assert.equal(old.audio_state, "kept");
  assert.equal(old.owner_name, USER.name);

  // The old recording is in the Clinical Scribe tab of History, and Voice Note
  // templates can be made.
  const user = await signIn(USER.email, USER.password);
  const scribeTab = await user.rpc("search_my_recordings", { p_query: "", p_page: 1, p_mode: "scribe" });
  assert.deepEqual(scribeTab.data.items.map((item) => `${item.id}:${item.mode}`), [`${SCRIBE}:scribe`]);
  const voiceTab = await user.rpc("search_my_recordings", { p_query: "", p_page: 1, p_mode: "voice" });
  assert.equal(voiceTab.data.total, 0);
  const letter = await user.rpc("save_template", {
    p_id: null, p_name: "Letter", p_description: "", p_body: "Reason:\n[details]", p_source_request: "", p_scope: "personal", p_mode: "voice",
  });
  assert.equal(letter.error, null, letter.error?.message);

  // Deleting it now leaves a short record that admins see as deleted.
  const deleted = await user.rpc("delete_scribe", { p_scribe_id: SCRIBE });
  assert.equal(deleted.error, null, deleted.error?.message);
  const after = await admin.rpc("admin_list_recordings", { p_audio: "deleted" });
  const gone = after.data.find((row) => row.scribe_id === SCRIBE);
  assert.equal(gone.status, "deleted");
  assert.equal(gone.deleted_reason, "person");
  assert.equal(gone.owner_name, USER.name);
  assert.equal(gone.mode, "scribe");
});
