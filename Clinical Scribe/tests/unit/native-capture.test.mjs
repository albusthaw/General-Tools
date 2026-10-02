// Unit tests for recording in the Android app (native-capture-core.js) with a
// stand-in for the phone: the recording starts with the right settings, finished
// parts are read in pieces, queued and removed from the phone, pauses the phone
// made by itself (a call) are passed on, Resume is refused during a call, Finish
// collects every part, and parts left after the app was closed reach their owner.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createNativeCapture, findPhoneRecording, READ_BYTES, recoverPhoneParts } from "../../web/src/app/native/native-capture-core.js";
import { UserError } from "../../web/src/lib/errors.js";

const SCRIBE = "22222222-2222-4222-8222-222222222222";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function bytes(length, seed = 7) {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) data[i] = (i * seed) % 256;
  return data;
}

// A phone that keeps parts per recording and answers like ScribeNativePlugin.
function fakePhone() {
  const listeners = new Map();
  const folders = new Map();
  const calls = [];
  let state = { phase: "idle", scribeId: null, reason: "", activeMs: 0, limitReached: false };
  const folder = (id) => {
    if (!folders.has(id)) folders.set(id, new Map());
    return folders.get(id);
  };
  return {
    calls,
    folders,
    folder,
    state: () => state,
    setState(next) {
      state = { ...state, ...next };
    },
    emit(name, data) {
      for (const listener of listeners.get(name) ?? []) listener(data);
    },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
    async addListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
      return { remove: () => listeners.set(name, listeners.get(name).filter((item) => item !== listener)) };
    },
    async recorderStart(options) {
      calls.push(["start", options]);
      state = { phase: "recording", scribeId: options.scribeId, reason: "", activeMs: 0, limitReached: false };
      return state;
    },
    async recorderPause() {
      calls.push(["pause"]);
      state = { ...state, phase: "paused", reason: "user" };
      return state;
    },
    async recorderResume() {
      calls.push(["resume"]);
      return state;
    },
    async recorderStop() {
      calls.push(["stop"]);
      state = { ...state, phase: "stopped" };
      return state;
    },
    async recorderDiscard() {
      calls.push(["discard"]);
      folders.delete(state.scribeId);
      state = { phase: "idle", scribeId: null, reason: "", activeMs: 0, limitReached: false };
      return state;
    },
    async recorderStatus() {
      return state;
    },
    async recorderDone({ scribeId }) {
      calls.push(["done", scribeId]);
      state = { phase: "idle", scribeId: null, reason: "", activeMs: 0, limitReached: false };
    },
    async pendingParts({ scribeId }) {
      const parts = [...folder(scribeId).entries()].sort((a, b) => a[0] - b[0]);
      return { parts: parts.map(([seq, data]) => ({ seq, bytes: data.length, durationMs: 600_000 })) };
    },
    async readPart({ scribeId, seq, offset, length }) {
      calls.push(["read", seq, offset, length]);
      const slice = folder(scribeId).get(seq).subarray(offset, offset + length);
      return { data: Buffer.from(slice).toString("base64"), size: slice.length };
    },
    async deletePart({ scribeId, seq }) {
      calls.push(["delete", scribeId, seq]);
      folder(scribeId).delete(seq);
    },
    async deleteParts({ scribeId }) {
      calls.push(["deleteAll", scribeId]);
      folders.delete(scribeId);
    },
    async recordingsOnPhone() {
      return { recordings: [...folders.keys()].sort() };
    },
  };
}

function job(extra = {}) {
  const stored = [];
  const events = { paused: [], resumed: 0, ended: [] };
  return {
    stored,
    events,
    options: {
      scribeId: SCRIBE,
      userId: "user-1",
      prefix: `user-1/${SCRIBE}`,
      segmentSeconds: 600,
      maxSeconds: 3600,
      storePart: async (part) => stored.push(part),
      onPaused: (reason) => events.paused.push(reason),
      onResumed: () => (events.resumed += 1),
      onEnded: (why) => events.ended.push(why),
      ...extra,
    },
  };
}

test("starting asks the phone with the recording's settings; a refusal becomes a clear message", async () => {
  const phone = fakePhone();
  const capture = createNativeCapture({ bridge: phone, doc: null });
  assert.deepEqual(await capture.prepare(), { mime: "audio/aac", ext: "aac" });
  const { options } = job();
  await capture.begin(options);
  assert.deepEqual(phone.calls[0], ["start", { scribeId: SCRIBE, segmentSeconds: 600, maxSeconds: 3600 }]);
  assert.equal(phone.listenerCount(), 3);

  const refusing = fakePhone();
  refusing.recorderStart = async () => {
    throw Object.assign(new Error("Recording could not start"), { code: "in_call" });
  };
  const other = createNativeCapture({ bridge: refusing, doc: null });
  await assert.rejects(other.begin(job().options), (error) => error instanceof UserError && /during a call/.test(error.message));
  assert.equal(refusing.listenerCount(), 0, "nothing keeps listening after a refusal");
});

test("a finished part is read in pieces, queued with its length, then removed from the phone", async () => {
  const phone = fakePhone();
  const capture = createNativeCapture({ bridge: phone, doc: null });
  const { options, stored } = job();
  await capture.begin(options);
  const audio = bytes(READ_BYTES * 2 + 100);
  phone.folder(SCRIBE).set(1, audio);
  phone.emit("recorderPart", { scribeId: SCRIBE, seq: 1, durationMs: 599_976 });
  phone.emit("recorderPart", { scribeId: "33333333-3333-4333-8333-333333333333", seq: 1, durationMs: 1 });
  await capture.finish();

  assert.equal(stored.length, 1, "parts of other recordings are left alone");
  const [part] = stored;
  assert.equal(part.seq, 1);
  assert.equal(part.mime, "audio/aac");
  assert.equal(part.ext, "aac");
  assert.equal(part.duration, 599.976);
  assert.equal(part.prefix, `user-1/${SCRIBE}`);
  assert.ok(Buffer.from(await part.blob.arrayBuffer()).equals(Buffer.from(audio)), "the queued audio is the same bytes");
  assert.equal(phone.calls.filter((call) => call[0] === "read").length, 3);
  assert.ok(phone.calls.filter((call) => call[0] === "read").every((call) => call[3] === READ_BYTES));
  assert.deepEqual(phone.calls.find((call) => call[0] === "delete"), ["delete", SCRIBE, 1]);
  assert.equal(phone.folder(SCRIBE).size, 0);
});

test("a pause the phone made by itself is passed on with its reason; the person's own pause is not", async () => {
  const phone = fakePhone();
  const capture = createNativeCapture({ bridge: phone, doc: null });
  const { options, events } = job();
  await capture.begin(options);
  phone.emit("recorderState", { ...phone.state(), phase: "paused", reason: "call", activeMs: 4000 });
  assert.deepEqual(events.paused, ["call"]);
  phone.emit("recorderState", { ...phone.state(), phase: "recording", reason: "", activeMs: 4000 });
  assert.equal(events.resumed, 1, "Resume in the notification is passed on");

  assert.equal(capture.pause("media"), true);
  await settle();
  assert.deepEqual(phone.calls.at(-1), ["pause"]);
  phone.emit("recorderState", { ...phone.state(), phase: "paused", reason: "user" });
  assert.deepEqual(events.paused, ["call"], "a pause asked for by the page is not reported back");
  phone.emit("recorderState", { scribeId: "33333333-3333-4333-8333-333333333333", phase: "paused", reason: "call" });
  assert.deepEqual(events.paused, ["call"], "another recording's state is ignored");
});

test("Resume is refused while a call goes on, and carries on after it", async () => {
  const phone = fakePhone();
  const capture = createNativeCapture({ bridge: phone, doc: null });
  await capture.begin(job().options);
  phone.setState({ phase: "paused", reason: "call" });
  assert.equal(await capture.resume(), "in_call");
  phone.setState({ phase: "paused", reason: "mic_busy" });
  assert.equal(await capture.resume(), "mic");
  phone.setState({ phase: "recording", reason: "" });
  assert.equal(await capture.resume(), null);
});

test("Finish stops the phone, collects every part left in order, and tells the phone it is done", async () => {
  const phone = fakePhone();
  const capture = createNativeCapture({ bridge: phone, doc: null });
  const { options, stored, events } = job();
  await capture.begin(options);
  phone.folder(SCRIBE).set(2, bytes(50, 3));
  phone.folder(SCRIBE).set(1, bytes(40, 5));
  await capture.finish();
  phone.emit("recorderState", { ...phone.state(), scribeId: SCRIBE, phase: "stopped" });
  assert.deepEqual(stored.map((part) => part.seq), [1, 2]);
  assert.deepEqual(events.ended, [], "a stop asked for by the page is not reported as an ending");
  assert.deepEqual(phone.calls.filter((call) => call[0] === "stop" || call[0] === "done"), [["stop"], ["done", SCRIBE]]);
  assert.equal(phone.listenerCount(), 0);
});

test("a recording that ended on the phone is passed on, with the limit when it was reached", async () => {
  const phone = fakePhone();
  const capture = createNativeCapture({ bridge: phone, doc: null });
  const { options, events } = job();
  await capture.begin(options);
  phone.emit("recorderState", { ...phone.state(), phase: "stopped", limitReached: true });
  assert.deepEqual(events.ended, ["limit"]);
});

test("a recording kept while the page was closed is taken up with its parts", async () => {
  const phone = fakePhone();
  phone.setState({ phase: "recording", scribeId: SCRIBE, activeMs: 90_000 });
  phone.folder(SCRIBE).set(1, bytes(30));
  const live = await findPhoneRecording(phone);
  assert.equal(live.scribeId, SCRIBE);

  let time = 1000;
  const capture = createNativeCapture({ bridge: phone, doc: null, now: () => time });
  const { options, stored } = job();
  await capture.attach(live, options);
  await settle();
  assert.deepEqual(stored.map((part) => part.seq), [1]);
  time += 2000;
  assert.equal(capture.elapsedMs(), 92_000, "the time carries on from the phone's count");
  phone.emit("recorderLevel", { level: 0.5 });
  assert.equal(capture.level(), 0.5);
  time += 1000;
  assert.equal(capture.level(), 0, "the level fades when no news comes");

  const idle = fakePhone();
  assert.equal(await findPhoneRecording(idle), null);
});

test("parts left by a closed app reach their owner, are removed when nobody can save them, and stay for someone else", async () => {
  const phone = fakePhone();
  const mine = "44444444-4444-4444-8444-444444444444";
  const theirs = "55555555-5555-4555-8555-555555555555";
  const orphan = "66666666-6666-4666-8666-666666666666";
  const live = "77777777-7777-4777-8777-777777777777";
  for (const id of [mine, theirs, orphan, live]) phone.folder(id).set(1, bytes(20));
  phone.folder(mine).set(2, bytes(25));
  phone.setState({ phase: "recording", scribeId: live });
  const stored = [];
  await recoverPhoneParts(phone, {
    userId: "user-1",
    entries: [
      { scribeId: mine, userId: "user-1", prefix: `user-1/${mine}` },
      { scribeId: theirs, userId: "user-2", prefix: `user-2/${theirs}` },
      { scribeId: live, userId: "user-1", prefix: `user-1/${live}` },
    ],
    live: new Set(),
    addPart: async (part) => stored.push(part),
  });
  assert.deepEqual(stored.map((part) => [part.scribeId, part.seq]), [[mine, 1], [mine, 2]]);
  assert.equal(stored[0].prefix, `user-1/${mine}`);
  assert.equal(phone.folders.has(orphan), false, "audio nobody can save is removed");
  assert.equal(phone.folder(theirs).size, 1, "someone else's audio stays");
  assert.equal(phone.folder(live).size, 1, "the live recording is left alone");
});
