// The recorder. It records in self-contained parts (a fresh file every few
// minutes), keeps every 5-second chunk in IndexedDB while recording, and hands
// finished parts to the upload queue. It lives outside the screens, so moving to
// another page never stops a recording.
import { discardScribe, startScribe } from "../api/scribes.js";
import { messageOf, UserError } from "../errors.js";
import { idb } from "../uploads/idb.js";
import { addPart, dropScribe, requestFinish, saveRecordingEntry } from "../uploads/queue.js";
import { canRecord, pickFormat } from "./format.js";
import { createMeter } from "./meter.js";
import { holdRecordingLock } from "./recovery.js";
import { limitAction, partIsDue } from "./timing.js";

const CHUNK_MS = 5000;
const BITRATE = 32000;

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
};

let session = null; // live objects for the current recording

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
  if (!session) return 0;
  const live = state.phase === "recording" && session.resumedAt ? performance.now() - session.resumedAt : 0;
  return (session.activeMs + live) / 1000;
}

export function level() {
  return session?.meter && state.phase === "recording" ? session.meter.level() : 0;
}

async function requestWakeLock() {
  try {
    if (session && "wakeLock" in navigator && document.visibilityState === "visible") {
      session.wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch {
    // Not available on every device; recording still works.
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (state.phase === "recording" || state.phase === "paused")) requestWakeLock();
});

function micError(error) {
  const name = error?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError") return "The microphone is being used by another app. Close it and try again.";
  return "The microphone could not be started. Please try again.";
}

function startPart() {
  const part = {
    seq: session.nextSeq++,
    chunks: [],
    index: 0,
    activeMs: 0,
    resumedAt: performance.now(),
    discard: false,
    done: null,
  };
  part.done = new Promise((resolve) => (part.resolve = resolve));
  const recorder = new MediaRecorder(session.stream, { mimeType: session.format.full, audioBitsPerSecond: BITRATE });
  part.recorder = recorder;

  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0 || part.discard) return;
    part.chunks.push(event.data);
    const chunk = {
      scribeId: state.scribeId,
      seq: part.seq,
      index: part.index++,
      blob: event.data,
      userId: session.userId,
      at: Date.now(),
    };
    idb.put("chunks", chunk).catch(() => {});
  };

  recorder.onstop = () => {
    if (!part.discard && part.chunks.length > 0) {
      const blob = new Blob(part.chunks, { type: session.format.base });
      session.partsSaved += 1;
      addPart({
        scribeId: state.scribeId,
        seq: part.seq,
        blob,
        duration: part.activeMs / 1000,
        mime: session.format.base,
        ext: session.format.ext,
        prefix: session.prefix,
        userId: session.userId,
      }).finally(part.resolve);
    } else {
      part.resolve();
    }
  };

  recorder.start(CHUNK_MS);
  session.part = part;
  return part;
}

function settlePartTime(part) {
  if (part.resumedAt) {
    part.activeMs += performance.now() - part.resumedAt;
    part.resumedAt = null;
  }
}

// Starts the next part when the current one is long enough. The new recorder
// starts before the old one stops, so no speech is lost between parts.
function rotateIfDue() {
  const part = session.part;
  const live = part.resumedAt ? performance.now() - part.resumedAt : 0;
  if (!partIsDue((part.activeMs + live) / 1000, session.segmentSeconds)) return;
  settlePartTime(part);
  startPart();
  if (part.recorder.state !== "inactive") part.recorder.stop();
}

function tick() {
  if (!session || state.phase !== "recording") return;
  rotateIfDue();
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
  if (!canRecord()) {
    set({ phase: "error", error: "This browser cannot record audio. Use a recent version of Chrome, Edge, Firefox or Safari." });
    return;
  }
  const format = pickFormat();
  if (!format) {
    set({ phase: "error", error: "This browser cannot record audio in a supported format. Use a recent version of Chrome, Edge, Firefox or Safari." });
    return;
  }
  set({ phase: "preparing", error: "", notice: "", templateId, title });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    set({ phase: "error", error: micError(error) });
    return;
  }

  let info;
  try {
    info = await startScribe({ templateId, title, mimeType: format.base });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    set({ phase: "error", error: messageOf(error) });
    return;
  }

  session = {
    userId,
    stream,
    format: { ...format, ext: info.extension ?? format.ext },
    prefix: info.upload_prefix,
    segmentSeconds: info.segment_seconds ?? 600,
    nextSeq: 1,
    partsSaved: 0,
    activeMs: 0,
    resumedAt: performance.now(),
    meter: createMeter(stream),
    wakeLock: null,
    warned: false,
    timer: null,
    part: null,
    releaseLock: holdRecordingLock(info.scribe_id),
  };

  await saveRecordingEntry({
    scribeId: info.scribe_id,
    userId,
    prefix: info.upload_prefix,
    ext: session.format.ext,
    mime: format.base,
    title,
    startedAt: Date.now(),
    finishRequested: false,
    segmentCount: null,
  });

  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => {
      if (state.phase === "recording" || state.phase === "paused") {
        set({ notice: "mic_ended" });
        finish();
      }
    });
  }

  set({
    phase: "recording",
    scribeId: info.scribe_id,
    maxSeconds: info.max_seconds,
    unlimited: Boolean(info.unlimited),
    creditSecondsLeft: info.credit_seconds_left,
  });
  startPart();
  session.timer = setInterval(tick, 250);
  requestWakeLock();
}

export function pause() {
  if (!session || state.phase !== "recording") return;
  const part = session.part;
  if (part.recorder.state === "recording") part.recorder.pause();
  settlePartTime(part);
  session.activeMs += performance.now() - session.resumedAt;
  session.resumedAt = null;
  set({ phase: "paused" });
}

export function resume() {
  if (!session || state.phase !== "paused") return;
  const part = session.part;
  if (part.recorder.state === "paused") part.recorder.resume();
  part.resumedAt = performance.now();
  session.resumedAt = performance.now();
  set({ phase: "recording" });
}

function release() {
  if (!session) return;
  session.releaseLock();
  clearInterval(session.timer);
  session.stream.getTracks().forEach((track) => track.stop());
  session.meter.close();
  session.wakeLock?.release?.().catch?.(() => {});
}

export async function finish() {
  if (!session || (state.phase !== "recording" && state.phase !== "paused")) return;
  const part = session.part;
  if (state.phase === "recording") {
    settlePartTime(part);
    session.activeMs += performance.now() - session.resumedAt;
    session.resumedAt = null;
  }
  set({ phase: "finishing" });
  if (part.recorder.state !== "inactive") part.recorder.stop();
  await part.done;
  const scribeId = state.scribeId;
  const parts = session.partsSaved;
  release();
  if (parts === 0) {
    session = null;
    await dropScribe(scribeId);
    await discardScribe(scribeId).catch(() => {});
    set({ phase: "error", scribeId: null, error: "Nothing was recorded. Check the microphone and try again." });
    return;
  }
  await requestFinish(scribeId, parts);
  session = null;
  set({ phase: "done" });
}

export async function discard() {
  if (!session) return;
  const scribeId = state.scribeId;
  const part = session.part;
  part.discard = true;
  if (part.recorder.state !== "inactive") part.recorder.stop();
  release();
  session = null;
  set({ phase: "idle", scribeId: null, notice: "" });
  await dropScribe(scribeId);
  try {
    await discardScribe(scribeId);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
  }
}

// Back to the start screen after a recording was handed over.
export function reset() {
  if (isRecording()) return;
  set({ phase: "idle", scribeId: null, error: "", notice: "", title: "", templateId: null });
}

export function clearNotice() {
  set({ notice: "" });
}
