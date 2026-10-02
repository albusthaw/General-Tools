// End-to-end checks of the server side: accounts, keys, recording, background
// processing, notes, templates, record review, audit log and security limits.
// Needs a freshly reset local stack, the functions server and the mock AI server.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  browserClient,
  friendlyCode,
  invoke,
  localStack,
  mock,
  serverClient,
  signIn,
  sql,
  waitFor,
} from "../helpers/local.mjs";

const ADMIN = { email: "admin@example.test", password: "Admin-pass-2026" };
const ALICE = { email: "alice@example.test", password: "Alice-pass-2026", name: "Alice Clinician" };
const BOB = { email: "bob@example.test", password: "Bobby-pass-2026", name: "Bob Clinician" };

const state = {};

async function uploadPart(client, scribe, seq, bytes = 20_000) {
  const path = `${scribe.upload_prefix}/${String(seq).padStart(4, "0")}.${scribe.extension}`;
  const { error } = await client.storage.from("recordings").upload(path, new Uint8Array(bytes).fill(7), {
    contentType: "audio/webm",
    upsert: false,
  });
  return { path, error };
}

async function recordAndFinish(client, { templateId = null, seconds = 20 } = {}) {
  const { data: scribe, error } = await client.rpc("start_scribe", {
    p_template_id: templateId,
    p_title: "Test visit",
    p_mime_type: "audio/webm",
  });
  assert.equal(error, null, error?.message);
  const up = await uploadPart(client, scribe, 1);
  assert.equal(up.error, null, up.error?.message);
  const reg = await client.rpc("register_segment", {
    p_scribe_id: scribe.scribe_id,
    p_seq: 1,
    p_duration_seconds: seconds,
    p_mime_type: "audio/webm",
  });
  assert.equal(reg.error, null, reg.error?.message);
  const fin = await client.rpc("finish_scribe", { p_scribe_id: scribe.scribe_id, p_segment_count: 1 });
  assert.equal(fin.error, null, fin.error?.message);
  return scribe;
}

// Fetches one part of a recording's audio the way the web app does.
async function audioPart(client, scribeId, seq, download = false) {
  const { data } = await client.auth.getSession();
  const response = await fetch(`${localStack().url}/functions/v1/admin`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: localStack().publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "recordings.part", scribe_id: scribeId, seq, download }),
  });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, type: response.headers.get("content-type"), bytes: body.length, body };
}

async function waitTranscribed(client, scribeId) {
  return await waitFor(async () => {
    const { data } = await client.from("scribes").select("status, error_message").eq("id", scribeId).single();
    if (data.status === "failed") throw new Error(`Processing failed: ${data.error_message}`);
    return data.status === "transcribed";
  }, { label: "transcript" });
}

describe("Clinical Scribe server", () => {
  before(async () => {
    localStack();
    await mock("/__reset", {});
  });

  it("makes the first account the administrator", async () => {
    const server = serverClient();
    const { data, error } = await server.auth.admin.createUser({ email: ADMIN.email, password: ADMIN.password, email_confirm: true });
    assert.equal(error, null);
    state.adminId = data.user.id;
    assert.equal(sql(`select role || ',' || status from public.profiles where id = '${data.user.id}'`), "admin,active");
    state.admin = await signIn(ADMIN.email, ADMIN.password);
    const { data: ctx } = await state.admin.rpc("get_my_context");
    assert.equal(ctx.profile.role, "admin");
    assert.equal(ctx.ready.transcription, false);
  });

  it("holds accounts that were not invited as waiting for approval", async () => {
    const server = serverClient();
    const { data } = await server.auth.admin.createUser({ email: "stranger@example.test", password: "Stranger-pass-1", email_confirm: true });
    assert.equal(sql(`select status from public.profiles where id = '${data.user.id}'`), "pending");
    const stranger = await signIn("stranger@example.test", "Stranger-pass-1");
    const { data: rows } = await stranger.from("templates").select("id");
    assert.deepEqual(rows, []);
    const start = await stranger.rpc("start_scribe", { p_template_id: null, p_title: "", p_mime_type: "audio/webm" });
    assert.equal(friendlyCode(start.error), "not_allowed");
    state.strangerId = data.user.id;
  });

  it("lets the admin save service keys without ever returning them", async () => {
    for (const [name, value] of [
      ["elevenlabs_api_key", "test-elevenlabs-key-0001"],
      ["gemini_api_key", "test-gemini-key-0001"],
      ["deepseek_api_key", "test-deepseek-key-0001"],
    ]) {
      const saved = await invoke(state.admin, "admin", { action: "keys.save", name, value });
      assert.equal(saved.error, null, JSON.stringify(saved.error));
      assert.equal(saved.data.last4, "0001");
    }
    const { data: settings } = await state.admin.rpc("admin_get_settings");
    assert.equal(settings.secrets.gemini_api_key.last4, "0001");
    assert.ok(!JSON.stringify(settings).includes("test-gemini-key"));
    const check = await invoke(state.admin, "admin", { action: "keys.check", name: "elevenlabs_api_key" });
    assert.equal(check.data.ok, true);
    // Before the first update, the model lists are the built-in ones known to work.
    const catalog = await invoke(state.admin, "admin", { action: "models.catalog" });
    const geminiText = catalog.data.lists.find((list) => list.provider === "gemini" && list.purpose === "text");
    assert.equal(geminiText.source, "built_in");
    assert.ok(geminiText.models.some((m) => m.id === "gemini-3.8-flash" && m.recommended));
    assert.equal(catalog.data.lists.length, 4);
  });

  it("reports a refused key in plain words", async () => {
    await invoke(state.admin, "admin", { action: "keys.save", name: "deepseek_api_key", value: "wrong-key-123456" });
    const check = await invoke(state.admin, "admin", { action: "keys.check", name: "deepseek_api_key" });
    assert.equal(check.data.ok, false);
    assert.match(check.data.message, /did not accept/);
    await invoke(state.admin, "admin", { action: "keys.save", name: "deepseek_api_key", value: "test-deepseek-key-0001" });
  });

  it("creates people with roles and starting minutes", async () => {
    for (const person of [ALICE, BOB]) {
      const created = await invoke(state.admin, "admin", {
        action: "users.create",
        email: person.email,
        full_name: person.name,
        password: person.password,
        role: "user",
        elevenlabs_minutes: 30,
        gemini_minutes: 10,
        unlimited: false,
      });
      assert.equal(created.error, null, JSON.stringify(created.error));
      person.id = created.data.id;
    }
    const duplicate = await invoke(state.admin, "admin", {
      action: "users.create", email: ALICE.email, full_name: "x", password: "Another-pass-1", role: "user",
    });
    assert.equal(duplicate.error.code, "exists");
    state.alice = await signIn(ALICE.email, ALICE.password);
    state.bob = await signIn(BOB.email, BOB.password);
    const { data: ctx } = await state.alice.rpc("get_my_context");
    assert.equal(ctx.profile.status, "active");
    assert.equal(ctx.credit.seconds_left, 1800);
  });

  it("stops ordinary users from admin actions", async () => {
    const r = await invoke(state.alice, "admin", { action: "keys.save", name: "gemini_api_key", value: "x".repeat(20) });
    assert.equal(r.status, 403);
    const list = await state.alice.rpc("admin_list_users", {});
    assert.equal(friendlyCode(list.error), "not_allowed");
    const secret = await state.alice.rpc("svc_get_secret", { p_name: "gemini_api_key" });
    assert.ok(secret.error, "service functions must not be callable");
    const settings = await state.alice.from("app_settings").select("*");
    assert.ok(settings.error || settings.data.length === 0);
    const audit = await state.alice.from("audit_log").select("id");
    assert.deepEqual(audit.data, []);
  });

  it("records, transcribes with ElevenLabs in the background and writes the first note with Gemini", async () => {
    const scribe = await recordAndFinish(state.alice);
    state.scribeId = scribe.scribe_id;
    const done = await waitFor(async () => {
      const { data } = await state.alice.from("scribes").select("status, transcript, error_message").eq("id", scribe.scribe_id).single();
      if (data.status === "failed") throw new Error(`Processing failed: ${data.error_message}`);
      return data.status === "transcribed" ? data : null;
    }, { label: "transcript" });
    assert.match(done.transcript, /^Speaker 1: Good morning/m);
    assert.match(done.transcript, /^Speaker 2: I have had a cough/m);

    const note = await waitFor(async () => {
      const { data } = await state.alice.from("notes").select("status, content, template_name, error_message").eq("scribe_id", scribe.scribe_id);
      if (data?.[0]?.status === "failed") throw new Error(`Note failed: ${data[0].error_message}`);
      return data?.[0]?.status === "done" ? data[0] : null;
    }, { label: "first note" });
    assert.equal(note.template_name, "SOAP note");
    assert.match(note.content, /^Subjective:/m);
    assert.match(note.content, /^Plan:/m);

    const credit = await state.alice.rpc("get_my_context");
    assert.equal(credit.data.credit.seconds_left, 1800 - 20, "20 reported seconds; 20.5 measured is within the tolerance");
    const log = await mock("/__log");
    assert.ok(log.some((e) => e.path === "/v1/speech-to-text"));
    assert.ok(log.some((e) => e.path === "/v1beta/interactions"));
    assert.ok(log.some((e) => e.method === "DELETE" && e.path.startsWith("/v1beta/interactions/")), "Gemini result removed");
  });

  it("keeps finished notes final", async () => {
    assert.throws(() => sql(`update public.notes set content = 'changed' where scribe_id = '${state.scribeId}'`), /cannot be changed/);
  });

  it("writes another note with DeepSeek and a personal template made by the template helper", async () => {
    const draft = await invoke(state.alice, "templates-ai", { action: "draft", description: "Medical clerking note: presenting complaint, HOPI, past history, drugs, impression and plan" });
    assert.equal(draft.error, null, JSON.stringify(draft.error));
    assert.match(draft.data.body, /^Presenting complaint:/m);
    const revised = await invoke(state.alice, "templates-ai", { action: "revise", current: draft.data, changes: "Add social history" });
    assert.match(revised.data.body, /Social history:/);

    const saved = await state.alice.rpc("save_template", {
      p_id: null, p_name: revised.data.name, p_description: revised.data.description,
      p_body: revised.data.body, p_source_request: "clerking", p_scope: "personal",
    });
    assert.equal(saved.error, null, saved.error?.message);
    const shared = await state.alice.rpc("save_template", {
      p_id: null, p_name: "Nope", p_description: "", p_body: "Section:\n[x]", p_source_request: "", p_scope: "shared",
    });
    assert.equal(friendlyCode(shared.error), "not_allowed");

    await state.admin.rpc("admin_update_settings", { p_changes: { note_provider: "deepseek" } });
    const noteId = await state.alice.rpc("request_note", { p_scribe_id: state.scribeId, p_template_id: saved.data });
    assert.equal(noteId.error, null, noteId.error?.message);
    const note = await waitFor(async () => {
      const { data } = await state.alice.from("notes").select("status, content, provider, error_message").eq("id", noteId.data).single();
      if (data.status === "failed") throw new Error(data.error_message);
      return data.status === "done" ? data : null;
    }, { label: "DeepSeek note" });
    assert.equal(note.provider, "deepseek");
    assert.match(note.content, /^Presenting complaint:/m);
    assert.match(note.content, /^Social history:/m);

    const bobSees = await state.bob.from("templates").select("id").eq("id", saved.data);
    assert.deepEqual(bobSees.data, [], "personal templates stay private");
    await state.admin.rpc("admin_update_settings", { p_changes: { note_provider: "gemini" } });
  });

  it("transcribes with Gemini's transcription model using background mode", async () => {
    await state.admin.rpc("admin_update_settings", { p_changes: { transcription_provider: "gemini" } });
    const scribe = await recordAndFinish(state.alice, { seconds: 10 });
    const done = await waitFor(async () => {
      const { data } = await state.alice.from("scribes").select("status, transcript, error_message").eq("id", scribe.scribe_id).single();
      if (data.status === "failed") throw new Error(data.error_message);
      return data.status === "transcribed" ? data : null;
    }, { label: "Gemini transcript" });
    assert.match(done.transcript, /^Speaker 1: Good morning/m);
    const log = await mock("/__log");
    assert.ok(log.some((e) => e.path === "/upload/v1beta/files"));
    assert.ok(log.some((e) => e.method === "DELETE" && e.path.startsWith("/v1beta/files/")), "audio removed from Google");
    const ctx = await state.alice.rpc("get_my_context");
    assert.equal(ctx.data.credit.gemini_seconds, 600 - 15, "10 reported, 20 measured: the 5 seconds beyond the tolerance are charged");
    await state.admin.rpc("admin_update_settings", { p_changes: { transcription_provider: "elevenlabs" } });
  });

  it("retries temporary problems and refunds credit when processing finally fails", async () => {
    const before = (await state.alice.rpc("get_my_context")).data.credit.seconds_left;
    await mock("/__fail", { match: "/v1/speech-to-text", status: 400, message: "Audio file is corrupted", times: 1 });
    const scribe = await recordAndFinish(state.alice, { seconds: 12 });
    const failed = await waitFor(async () => {
      const { data } = await state.alice.from("scribes").select("status, error_message").eq("id", scribe.scribe_id).single();
      return data.status === "failed" ? data : null;
    }, { label: "failure" });
    assert.match(failed.error_message, /ElevenLabs could not use this recording/);
    const after = (await state.alice.rpc("get_my_context")).data.credit.seconds_left;
    assert.equal(after, before, "credit returned");

    const retry = await state.alice.rpc("retry_scribe", { p_scribe_id: scribe.scribe_id });
    assert.equal(retry.error, null, retry.error?.message);
    await waitFor(async () => {
      const { data } = await state.alice.from("scribes").select("status").eq("id", scribe.scribe_id).single();
      return data.status === "transcribed";
    }, { label: "retry" });

    await mock("/__fail", { match: "/v1/speech-to-text", status: 503, times: 1 });
    const flaky = await recordAndFinish(state.alice, { seconds: 10 });
    await waitFor(async () => {
      const { data } = await state.alice.from("scribes").select("status").eq("id", flaky.scribe_id).single();
      return data.status === "transcribed";
    }, { label: "automatic retry after a temporary error", timeoutMs: 120_000 });
  });

  it("keeps each person's audio and records private", async () => {
    const { data: aliceRows } = await state.alice.from("scribes").select("id");
    assert.ok(aliceRows.length >= 3);
    const { data: bobRows } = await state.bob.from("scribes").select("id");
    assert.deepEqual(bobRows, []);
    const { data: adminRows } = await state.admin.from("scribes").select("id");
    assert.deepEqual(adminRows, [], "admins have no direct read access");

    const { data: bobScribe } = await state.bob.rpc("start_scribe", { p_template_id: null, p_title: "", p_mime_type: "audio/webm" });
    const intoAlice = await state.bob.storage.from("recordings").upload(
      `${ALICE.id}/${state.scribeId}/0009.webm`, new Uint8Array(10), { contentType: "audio/webm" },
    );
    assert.ok(intoAlice.error, "cannot upload into someone else's folder");
    const wrongType = await state.bob.storage.from("recordings").upload(
      `${bobScribe.upload_prefix}/0001.webm`, new Uint8Array(10), { contentType: "text/html" },
    );
    assert.ok(wrongType.error, "only audio is accepted");
    const unregistered = await state.bob.rpc("register_segment", {
      p_scribe_id: bobScribe.scribe_id, p_seq: 2, p_duration_seconds: 5, p_mime_type: "audio/webm",
    });
    assert.equal(friendlyCode(unregistered.error), "upload_missing");
    const discard = await state.bob.rpc("discard_scribe", { p_scribe_id: bobScribe.scribe_id });
    assert.equal(discard.error, null);

    const audit = await state.alice.rpc("svc_audit", { p_actor: ALICE.id, p_action: "user.password_changed", p_target_user: null, p_details: {}, p_user_agent: "" });
    assert.ok(audit.error);
    assert.throws(() => sql("delete from public.audit_log"), /cannot be changed/);
    assert.throws(() => sql("update public.audit_log set reason = 'x'"), /cannot be changed/);
  });

  it("logs every step of an admin record review", async () => {
    const noReason = await state.admin.rpc("admin_review_start", { p_target_user: ALICE.id, p_reason: "short", p_confirmed: true });
    assert.equal(friendlyCode(noReason.error), "reason_needed");
    const unconfirmed = await state.admin.rpc("admin_review_start", { p_target_user: ALICE.id, p_reason: "Clinical audit of note quality", p_confirmed: false });
    assert.equal(friendlyCode(unconfirmed.error), "not_confirmed");

    const { data: review } = await state.admin.rpc("admin_review_start", {
      p_target_user: ALICE.id, p_reason: "Clinical audit of note quality", p_confirmed: true,
    });
    const { data: list } = await state.admin.rpc("admin_review_list", { p_review_id: review.review_id });
    assert.ok(list.length >= 3);
    const { data: record } = await state.admin.rpc("admin_review_open", { p_review_id: review.review_id, p_scribe_id: state.scribeId });
    assert.match(record.transcript, /Good morning/);
    assert.ok(record.notes.length >= 2);
    await state.admin.rpc("admin_review_copied", { p_review_id: review.review_id, p_scribe_id: state.scribeId, p_what: "transcript" });
    await state.admin.rpc("admin_review_end", { p_review_id: review.review_id });
    const closed = await state.admin.rpc("admin_review_list", { p_review_id: review.review_id });
    assert.equal(friendlyCode(closed.error), "review_closed");

    const { data: entries } = await state.admin.rpc("admin_list_audit", { p_action_group: "review" });
    const actions = entries.map((e) => e.action);
    for (const action of ["review.started", "review.list_viewed", "review.record_opened", "review.copied", "review.ended"]) {
      assert.ok(actions.includes(action), `missing ${action}`);
    }
    const opened = entries.find((e) => e.action === "review.record_opened");
    assert.equal(opened.reason, "Clinical audit of note quality");
    assert.equal(opened.target_email, ALICE.email);
    assert.equal(opened.scribe_id, state.scribeId);

    const bobReview = await state.bob.rpc("admin_review_start", { p_target_user: ALICE.id, p_reason: "I am curious about it", p_confirmed: true });
    assert.equal(friendlyCode(bobReview.error), "not_allowed");
  });

  it("lists every recording for admins and opens audio only with a logged reason", async () => {
    const { data: rows, error } = await state.admin.rpc("admin_list_recordings", {});
    assert.equal(error, null, error?.message);
    const row = rows.find((r) => r.scribe_id === state.scribeId);
    assert.equal(row.audio_state, "kept");
    assert.equal(row.owner_email, ALICE.email);
    assert.ok(row.keep_until, "audio is kept for the retention period");
    assert.ok(!("title" in row) && !("transcript" in row), "the list holds no labels or transcripts");

    const asUser = await state.alice.rpc("admin_list_recordings", {});
    assert.equal(friendlyCode(asUser.error), "not_allowed");

    const shortReason = await invoke(state.admin, "admin", { action: "recordings.unlock", scribe_id: state.scribeId, reason: "short", confirmed: true });
    assert.equal(shortReason.error.code, "invalid_input");
    const unconfirmed = await invoke(state.admin, "admin", { action: "recordings.unlock", scribe_id: state.scribeId, reason: "Complaint review of this visit", confirmed: false });
    assert.equal(unconfirmed.error.code, "not_confirmed");
    const early = await audioPart(state.admin, state.scribeId, 1);
    assert.equal(early.status, 409, "no audio before a reason is given");

    const opened = await invoke(state.admin, "admin", { action: "recordings.unlock", scribe_id: state.scribeId, reason: "Complaint review of this visit", confirmed: true });
    assert.equal(opened.error, null, JSON.stringify(opened.error));
    assert.equal(opened.data.parts.length, 1);
    assert.equal(opened.data.title, "Test visit");
    const part = await audioPart(state.admin, state.scribeId, 1);
    assert.equal(part.status, 200);
    assert.equal(part.type, "application/octet-stream");
    assert.equal(part.bytes, 20_000);

    const userPart = await audioPart(state.alice, state.scribeId, 1);
    assert.equal(userPart.status, 403, "only admins get audio through the function");
    const anonymous = await fetch(`${localStack().url}/functions/v1/admin`, {
      method: "POST",
      headers: { apikey: localStack().publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recordings.part", scribe_id: state.scribeId, seq: 1 }),
    });
    assert.equal(anonymous.status, 401, "nobody gets audio without signing in");
    const direct = await state.admin.storage.from("recordings").download(`${ALICE.id}/${state.scribeId}/0001.webm`);
    assert.ok(direct.error, "the audio files have no direct way in, even for admins");

    const download = await audioPart(state.admin, state.scribeId, 1, true);
    assert.equal(download.status, 200);
    const { data: entries } = await state.admin.rpc("admin_list_audit", { p_action_group: "recording" });
    const openedEntry = entries.find((e) => e.action === "recording.opened");
    assert.equal(openedEntry.reason, "Complaint review of this visit");
    assert.equal(openedEntry.target_email, ALICE.email);
    assert.equal(openedEntry.scribe_id, state.scribeId);
    assert.equal(entries.filter((e) => e.action === "recording.downloaded").length, 1, "listening is logged once; each download is logged");
  });

  it("shows audio removed by the retention setting, and deleted recordings, as deleted", async () => {
    // As the hourly clean-up does when the retention period is over.
    await serverClient().rpc("svc_mark_audio_deleted", { p_scribe_id: state.scribeId });
    const { data: deletedAudio } = await state.admin.rpc("admin_list_recordings", { p_audio: "deleted" });
    const row = deletedAudio.find((r) => r.scribe_id === state.scribeId);
    assert.equal(row.audio_state, "deleted");
    assert.equal(row.deleted_reason, "retention");
    assert.ok(row.deleted_at);
    const locked = await invoke(state.admin, "admin", { action: "recordings.unlock", scribe_id: state.scribeId, reason: "A second look at the audio", confirmed: true });
    assert.equal(locked.error.code, "audio_deleted");
    const { data: kept } = await state.admin.rpc("admin_list_recordings", { p_audio: "kept" });
    assert.ok(!kept.some((r) => r.scribe_id === state.scribeId), "the kept filter leaves it out");

    // A recording the clinician deletes stays on the list, marked as deleted.
    const extra = await recordAndFinish(state.alice, { seconds: 8 });
    await waitTranscribed(state.alice, extra.scribe_id);
    const removed = await state.alice.rpc("delete_scribe", { p_scribe_id: extra.scribe_id });
    assert.equal(removed.error, null, removed.error?.message);
    const { data: all } = await state.admin.rpc("admin_list_recordings", { p_person: ALICE.id });
    const gone = all.find((r) => r.scribe_id === extra.scribe_id);
    assert.equal(gone.status, "deleted");
    assert.equal(gone.deleted_reason, "person");
    assert.equal(gone.owner_name, ALICE.name);
  });

  it("asks ElevenLabs for zero retention in the web address", async () => {
    await state.admin.rpc("admin_update_settings", { p_changes: { elevenlabs_zero_retention: true } });
    await mock("/__reset", {});
    const scribe = await recordAndFinish(state.alice, { seconds: 6 });
    await waitTranscribed(state.alice, scribe.scribe_id);
    const calls = (await mock("/__log")).filter((e) => e.path === "/v1/speech-to-text");
    assert.ok(calls.length > 0);
    assert.ok(calls.every((e) => e.query === "?enable_logging=false"), JSON.stringify(calls.map((e) => e.query)));
    await state.admin.rpc("admin_update_settings", { p_changes: { elevenlabs_zero_retention: false } });
  });

  it("keeps the model lists current and tests the chosen models", async () => {
    const find = (lists, provider, purpose) => lists.find((l) => l.provider === provider && l.purpose === purpose);
    const initial = await invoke(state.admin, "admin", { action: "models.catalog" });
    assert.equal(initial.error, null, JSON.stringify(initial.error));
    assert.equal(find(initial.data.lists, "gemini", "text").source, "built_in");

    const fresh = await invoke(state.admin, "admin", { action: "models.refresh" });
    assert.equal(fresh.error, null, JSON.stringify(fresh.error));
    assert.deepEqual(fresh.data.problems, []);
    const transcription = find(fresh.data.lists, "gemini", "transcription");
    assert.equal(transcription.source, "service");
    assert.equal(transcription.models[0].id, "gemini-3.5-transcribe");
    assert.equal(transcription.models[0].recommended, true);
    assert.ok(!transcription.models.some((m) => m.id.includes("live")), "live-streaming models cannot take a recording");
    const text = find(fresh.data.lists, "gemini", "text");
    assert.equal(text.models[0].id, "gemini-3.8-flash");
    assert.ok(text.models.some((m) => m.id === "gemini-3.7-flash"), "other models the service offers are listed");
    assert.ok(!text.models.some((m) => /tts|transcribe|embedding/.test(m.id)));
    const deepseekList = find(fresh.data.lists, "deepseek", "text");
    assert.equal(deepseekList.models[0].id, "deepseek-flash");
    assert.equal(deepseekList.models[0].available, true);
    assert.equal(find(fresh.data.lists, "elevenlabs", "transcription").models[0].id, "scribe_v2_medical");

    const saved = await invoke(state.admin, "admin", { action: "models.catalog" });
    assert.equal(find(saved.data.lists, "gemini", "text").source, "service", "the lists are kept");
    const { data: logged } = await state.admin.rpc("admin_list_audit", { p_action_group: "settings" });
    assert.ok(logged.some((e) => e.action === "settings.models_refreshed"));

    const tested = await invoke(state.admin, "admin", {
      action: "models.test",
      transcription: { provider: "gemini", model: "gemini-3.5-transcribe" },
      notes: { provider: "gemini", model: "gemini-3.8-flash" },
      templates: { provider: "deepseek", model: "deepseek-flash" },
    });
    assert.equal(tested.error, null, JSON.stringify(tested.error));
    assert.deepEqual(tested.data.results.map((r) => [r.job, r.ok]), [["transcription", true], ["notes", true], ["templates", true]]);
    const log = await mock("/__log");
    assert.ok(log.some((e) => e.path === "/v1beta/interactions" && e.size > 40_000), "a second of audio was sent to test transcription");

    const broken = await invoke(state.admin, "admin", {
      action: "models.test",
      transcription: { provider: "elevenlabs", model: "whisper-1" },
      notes: { provider: "gemini", model: "gemini-missing" },
    });
    assert.deepEqual(broken.data.results.map((r) => r.ok), [false, false]);
    assert.match(broken.data.results[0].message, /not available to your account/);

    const asUser = await invoke(state.alice, "admin", { action: "models.refresh" });
    assert.equal(asUser.status, 403);
  });

  it("manages credit, roles, suspension and removal with safeguards", async () => {
    const add = await state.admin.rpc("admin_adjust_credit", { p_user: BOB.id, p_provider: "elevenlabs", p_mode: "add", p_minutes: 15, p_note: "Extra clinic" });
    assert.equal(add.data.balance_seconds, 45 * 60);
    const set = await state.admin.rpc("admin_adjust_credit", { p_user: BOB.id, p_provider: "elevenlabs", p_mode: "set", p_minutes: 0, p_note: "" });
    assert.equal(set.data.balance_seconds, 0);
    const blocked = await state.bob.rpc("start_scribe", { p_template_id: null, p_title: "", p_mime_type: "audio/webm" });
    assert.equal(friendlyCode(blocked.error), "not_enough_credit");
    await state.admin.rpc("admin_set_unlimited", { p_user: BOB.id, p_unlimited: true });
    const allowed = await state.bob.rpc("start_scribe", { p_template_id: null, p_title: "", p_mime_type: "audio/webm" });
    assert.equal(allowed.error, null);
    await state.bob.rpc("discard_scribe", { p_scribe_id: allowed.data.scribe_id });
    // Stopped before any audio was saved, so it leaves nothing on the Recording page.
    assert.equal(sql(`select count(*) from app_private.deleted_recordings where scribe_id = '${allowed.data.scribe_id}'`), "0");

    const demoteSelf = await state.admin.rpc("admin_set_role", { p_user: state.adminId, p_role: "user" });
    assert.equal(friendlyCode(demoteSelf.error), "last_admin");
    const suspendSelf = await invoke(state.admin, "admin", { action: "users.set_status", user_id: state.adminId, status: "suspended" });
    assert.equal(suspendSelf.error.code, "self");

    const suspend = await invoke(state.admin, "admin", { action: "users.set_status", user_id: BOB.id, status: "suspended" });
    assert.equal(suspend.error, null, JSON.stringify(suspend.error));
    const bobBlocked = await state.bob.from("templates").select("id");
    assert.deepEqual(bobBlocked.data, [], "suspended people see nothing, even with a live token");
    const relogin = await browserClient().auth.signInWithPassword({ email: BOB.email, password: BOB.password });
    assert.ok(relogin.error, "suspended people cannot sign in");
    const restore = await invoke(state.admin, "admin", { action: "users.set_status", user_id: BOB.id, status: "active" });
    assert.equal(restore.error, null);

    const approve = await invoke(state.admin, "admin", { action: "users.set_status", user_id: state.strangerId, status: "active" });
    assert.equal(approve.error, null);

    const password = await invoke(state.admin, "admin", { action: "users.set_password", user_id: BOB.id, password: "New-bob-pass-2026" });
    assert.equal(password.error, null);
    await signIn(BOB.email, "New-bob-pass-2026");

    // A finished recording of Bob's, to see what his removal leaves on the Recording page.
    const bobRecording = "22222222-2222-4222-8222-222222222222";
    sql(`insert into public.scribes (id, owner_id, title, status, segment_count, duration_seconds, transcript, finished_at, transcribed_at)
         values ('${bobRecording}', '${BOB.id}', 'Bob visit', 'transcribed', 1, 120, 'Speaker 1: Hello', now(), now())`);

    const wrongConfirm = await invoke(state.admin, "admin", { action: "users.remove", user_id: BOB.id, confirm_email: "someone@example.test" });
    assert.equal(wrongConfirm.error.code, "confirm_mismatch");
    const removed = await invoke(state.admin, "admin", { action: "users.remove", user_id: BOB.id, confirm_email: BOB.email });
    assert.equal(removed.error, null, JSON.stringify(removed.error));
    assert.equal(sql(`select count(*) from public.profiles where id = '${BOB.id}'`), "0");
    assert.equal(sql(`select target_email from public.audit_log where action = 'user.removed' order by id desc limit 1`), BOB.email);
    const { data: deletedList } = await state.admin.rpc("admin_list_recordings", { p_audio: "deleted" });
    const bobGone = deletedList.find((row) => row.scribe_id === bobRecording);
    assert.equal(bobGone?.deleted_reason, "account_removed", "the removed person's recording shows as deleted with the account");
    assert.equal(bobGone.owner_email, BOB.email);
    assert.equal(bobGone.status, "deleted");
  });

  it("applies Google sign-in settings through the Management API and keeps the email settings", async () => {
    const noToken = await invoke(state.admin, "admin", {
      action: "google.save", enabled: true, client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-test", app_url: "http://127.0.0.1:5173/",
    });
    assert.equal(noToken.error.code, "token_needed");
    const token = await invoke(state.admin, "admin", { action: "google.token_save", value: "sbp_test_management_token_0001" });
    assert.equal(token.error, null, JSON.stringify(token.error));
    const saved = await invoke(state.admin, "admin", {
      action: "google.save", enabled: true, client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-test", app_url: "http://127.0.0.1:5173/",
    });
    assert.equal(saved.error, null, JSON.stringify(saved.error));
    assert.equal(saved.data.enabled, true);
    const config = await mock("/__auth_config");
    assert.equal(config.external_google_enabled, true);
    assert.equal(config.external_google_client_id, "123-abc.apps.googleusercontent.com");
    assert.ok(config.uri_allow_list.includes("http://127.0.0.1:5173/"));
    const { data: publicConfig } = await browserClient().rpc("get_public_config");
    assert.equal(publicConfig.google_enabled, true);

    const email = await invoke(state.admin, "admin", {
      action: "email.save", host: "smtp.example.test", port: 465, security: "ssl", username: "mailer",
      password: "mail-password-1", sender_name: "Clinic", sender_email: "noreply@example.test",
    });
    assert.equal(email.error, null, JSON.stringify(email.error));
    assert.equal(email.data.password_saved, true);
    assert.ok(!JSON.stringify(email.data).includes("mail-password-1"));
  });

  it("refuses to wake the worker without its secret", async () => {
    const { url } = localStack();
    const response = await fetch(`${url}/functions/v1/worker`, { method: "POST", headers: { "x-worker-secret": "guess" } });
    assert.equal(response.status, 401);
  });
});
