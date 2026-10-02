// The recorder. It lives outside the screens, so moving to another page never
// stops a recording. The sound itself comes from a capture: the browser's
// microphone (web-capture.js), or in the Android app the phone's own recorder,
// which carries on with the screen off (app/native/native-capture.js). Finished
// parts go to the upload queue. A call, other sound or a locked iPhone pauses the
// recording and says why; it never ends it.
import { discardScribe, startScribe } from "../api/scribes.js";
import { messageOf, UserError } from "../errors.js";
import { appHooks } from "../platform/hooks.js";
import { idb } from "../uploads/idb.js";
import { addPart, dropScribe, getRecordingEntry, requestFinish, saveRecordingEntry } from "../uploads/queue.js";
import { holdRecordingLock } from "./recovery.js";
import { limitAction } from "./timing.js";
import { createWebCapture } from "./web-capture.js";

const listeners = new Set();

const state = {
  phase: "idle", // idle | preparing | recording | paused | finishing | done | error
  scribeId: null,
  title: "",
  templateId: null,
  maxSeconds: 0,
  unlimited: false,
  creditSecondsLeft: null,
  error: "",
  notice: "",
  pauseReason: "", // why the recording paused (see capture-rules.js)
};

let session = null; // the capture and timers of the current recording
let storing = Promise.resolve();

function emit() {
  for (const listener of listeners) {
    try {
      listener({ ...state });
    } catch {
      // Ignore listener errors.
    }
  }
}

function set(patch) {
  Object.assign(state, patch);
  emit();
}

export function onRecorderChange(listener) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export function recorderState() {
  return { ...state };
}

export function isRecording() {
  return state.phase === "recording" || state.phase === "paused" || state.phase === "finishing" || state.phase === "preparing";
}

// Seconds of sound recorded so far (pauses are not counted).
export function elapsedSeconds() {
  return session ? session.capture.elapsedMs() / 1000 : 0;
}

export function level() {
  return session && state.phase === "recording" ? session.capture.level() : 0;
}

function newCapture() {
  return appHooks.createCapture?.() ?? createWebCapture();
}

const saveChunk = (chunk) => idb.put("chunks", chunk).catch(() => {});

// Hands a finished part to the upload queue and counts it for its recording.
// One part at a time, so the count is never lost.
function storePart(part) {
  const step = storing.then(async () => {
    await addPart(part);
    const entry = await getRecordingEntry(part.scribeId);
    if (entry) await saveRecordingEntry({ ...entry, partsStored: (entry.partsStored ?? 0) + 1 });
  });
  storing = step.catch(() => {});
  return step;
}

function isRefusal(notice) {
  return typeof notice === "string" && notice.startsWith("resume_");
}

// What a capture says happened by itself.
const events = {
  onPaused(reason) {
    if (session && state.phase === "recording") set({ phase: "paused", pauseReason: reason });
  },
  // Resume pressed in the Android notification.
  onResumed() {
    if (session && state.phase === "paused") set({ phase: "recording", pauseReason: "", notice: isRefusal(state.notice) ? "" : state.notice });
  },
  // The recording ended on the phone: the limit was reached, or it could not carry on.
  onEnded(why) {
    if (!session || (state.phase !== "recording" && state.phase !== "paused")) return;
    if (why === "limit") set({ notice: state.unlimited ? "max_reached" : "credit_reached" });
    else set({ notice: "stopped_on_phone" });
    finish();
  },
};

function startSession(capture, userId, scribeId) {
  session = {
    capture,
    userId,
    warned: false,
    resuming: false,
    timer: setInterval(tick, 250),
    releaseLock: holdRecordingLock(scribeId),
  };
}

function tick() {
  if (!session || state.phase !== "recording") return;
  session.capture.tick();
  const action = limitAction(elapsedSeconds(), state.maxSeconds, session.warned);
  if (action === "warn") {
    session.warned = true;
    set({ notice: state.unlimited ? "near_max" : "near_credit" });
  } else if (action === "stop") {
    set({ notice: state.unlimited ? "max_reached" : "credit_reached" });
    finish();
  }
}

export async function start({ userId, templateId, title }) {
  if (isRecording()) return;
  set({ phase: "preparing", error: "", notice: "", pauseReason: "", templateId, title });
  const capture = newCapture();

  let format;
  try {
    format = await capture.prepare();
  } catch (error) {
    set({ phase: "error", error: error instanceof UserError ? error.message : "The microphone could not be started. Please try again." });
    return;
  }

  let info;
  try {
    info = await startScribe({ templateId, title, mimeType: format.mime });
  } catch (error) {
    capture.cancel();
    set({ phase: "error", error: messageOf(error) });
    return;
  }

  const entry = {
    scribeId: info.scribe_id,
    userId,
    prefix: info.upload_prefix,
    ext: info.extension ?? format.ext,
    mime: format.mime,
    title,
    templateId,
    maxSeconds: info.max_seconds,
    unlimited: Boolean(info.unlimited),
    creditSecondsLeft: info.credit_seconds_left,
    segmentSeconds: info.segment_seconds ?? 600,
    startedAt: Date.now(),
    finishRequested: false,
    segmentCount: null,
    partsStored: 0,
  };
  await saveRecordingEntry(entry);

  try {
    await capture.begin({
      ...events,
      scribeId: entry.scribeId,
      userId,
      prefix: entry.prefix,
      ext: entry.ext,
      segmentSeconds: entry.segmentSeconds,
      maxSeconds: entry.maxSeconds,
      storePart,
      saveChunk,
    });
  } catch (error) {
    capture.cancel();
    await dropScribe(entry.scribeId);
    await discardScribe(entry.scribeId).catch(() => {});
    set({ phase: "error", error: messageOf(error) });
    return;
  }

  startSession(capture, userId, entry.scribeId);
  set({
    phase: "recording",
    scribeId: entry.scribeId,
    maxSeconds: entry.maxSeconds,
    unlimited: entry.unlimited,
    creditSecondsLeft: entry.creditSecondsLeft,
  });
}

/**
 * In the Android app a recording carries on after the page was closed. At start
 * the page takes it up again: it shows the recording, saves the parts recorded
 * meanwhile, and finishes it when it ended while the page was closed.
 */
export async function attach(userId) {
  if (session || isRecording() || !appHooks.findPhoneRecording) return;
  let live;
  try {
    live = await appHooks.findPhoneRecording();
  } catch {
    return;
  }
  if (!live?.scribeId) return;
  const entry = await getRecordingEntry(live.scribeId);
  const capture = newCapture();
  if (!entry || entry.userId !== userId) {
    // Someone else's recording: stop it, and keep its audio for them.
    await capture.stopLeftover?.();
    return;
  }
  startSession(capture, userId, entry.scribeId);
  set({
    phase: live.phase === "recording" ? "recording" : "paused",
    scribeId: entry.scribeId,
    title: entry.title ?? "",
    templateId: entry.templateId ?? null,
    maxSeconds: entry.maxSeconds ?? 0,
    unlimited: Boolean(entry.unlimited),
    creditSecondsLeft: entry.creditSecondsLeft ?? null,
    pauseReason: live.phase === "paused" ? live.reason ?? "" : "",
    error: "",
    notice: "",
  });
  await capture.attach(live, { ...events, scribeId: entry.scribeId, userId, prefix: entry.prefix, storePart });
  if (live.phase !== "recording" && live.phase !== "paused") events.onEnded(live.limitReached ? "limit" : "stopped");
}

export function pause(reason = "user") {
  if (!session || state.phase !== "recording") return;
  session.capture.pause(reason);
  set({ phase: "paused", pauseReason: reason });
}

export async function resume() {
  if (!session || state.phase !== "paused" || session.resuming) return;
  const current = session;
  current.resuming = true;
  let refused;
  try {
    refused = await current.capture.resume();
  } catch {
    refused = "mic";
  } finally {
    current.resuming = false;
  }
  if (session !== current || state.phase !== "paused") return;
  if (refused) {
    set({ notice: `resume_${refused}`, pauseReason: refused === "in_call" ? "call" : state.pauseReason });
    return;
  }
  set({ phase: "recording", pauseReason: "", notice: isRefusal(state.notice) ? "" : state.notice });
}

function release() {
  if (!session) return;
  session.releaseLock();
  clearInterval(session.timer);
}

export async function finish() {
  if (!session || (state.phase !== "recording" && state.phase !== "paused")) return;
  const { capture } = session;
  set({ phase: "finishing" });
  try {
    await capture.finish();
  } catch {
    // Whatever was handed on is still saved below.
  }
  await storing;
  const scribeId = state.scribeId;
  release();
  const parts = (await getRecordingEntry(scribeId))?.partsStored ?? 0;
  if (parts === 0) {
    session = null;
    await dropScribe(scribeId);
    await discardScribe(scribeId).catch(() => {});
    set({ phase: "error", scribeId: null, pauseReason: "", error: "Nothing was recorded. Check the microphone and try again." });
    return;
  }
  await requestFinish(scribeId, parts);
  session = null;
  set({ phase: "done", pauseReason: "" });
}

export async function discard() {
  if (!session) return;
  const scribeId = state.scribeId;
  const { capture } = session;
  release();
  session = null;
  set({ phase: "idle", scribeId: null, notice: "", pauseReason: "" });
  await capture.discard();
  await dropScribe(scribeId);
  try {
    await discardScribe(scribeId);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
  }
}

/** Ends a recording on this device and keeps nothing (signing out anyway). */
export async function abandon() {
  if (!session) return;
  const { capture } = session;
  release();
  session = null;
  set({ phase: "idle", scribeId: null, notice: "", pauseReason: "", title: "", templateId: null });
  await capture.discard();
}

// Back to the start screen after a recording was handed over.
export function reset() {
  if (isRecording()) return;
  set({ phase: "idle", scribeId: null, error: "", notice: "", pauseReason: "", title: "", templateId: null });
}

export function clearNotice() {
  set({ notice: "" });
}

// Sound played by Clinical Scribe itself would be recorded too, so the recording
// pauses while an audio or video element plays.
document.addEventListener(
  "play",
  (event) => {
    if (state.phase === "recording" && event.target instanceof HTMLMediaElement) pause("media");
  },
  true,
);
