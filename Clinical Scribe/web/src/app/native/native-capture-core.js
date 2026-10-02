// The Android app's own recorder, seen from the page. Android records by itself
// (RecorderHub.java), so a recording carries on with the screen off and after the
// page was closed. This side follows the recorder's state, passes on the pauses
// Android made by itself (a call, other sound, a busy microphone), and moves every
// finished part from the phone into the upload queue, then removes it from the
// phone. The phone bridge is passed in, so the tests can use a stand-in.
import { captureError, phoneStartMessage } from "../../lib/recorder/capture-rules.js";

const MIME = "audio/aac";
const EXT = "aac";
// The most bytes of a part the phone sends in one answer (RecorderCalls.MAX_READ).
export const READ_BYTES = 768 * 1024;
const LEVEL_FRESH_MS = 400;
const LIVE = new Set(["recording", "paused"]);

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A capture for recorder.js that drives the phone's recorder through the bridge. */
export function createNativeCapture({ bridge, now = () => Date.now(), doc = globalThis.document } = {}) {
  let job = null; // { scribeId, userId, prefix, storePart, onPaused, onResumed, onEnded }
  let snapshot = { phase: "idle", activeMs: 0, reason: "" };
  let snapshotAt = now();
  let handles = [];
  let chain = Promise.resolve();
  let stopping = false;
  let levelValue = 0;
  let levelAt = -Infinity;
  const collected = new Set();

  function take(state) {
    snapshot = { ...state, activeMs: Number(state?.activeMs) || 0 };
    snapshotAt = now();
  }

  function elapsedMs() {
    return snapshot.activeMs + (snapshot.phase === "recording" ? Math.max(0, now() - snapshotAt) : 0);
  }

  // A new state from the phone. Pauses, resumes and endings that did not come
  // from this page are passed on.
  function apply(state) {
    if (!job || !state || state.scribeId !== job.scribeId) return;
    const was = snapshot.phase;
    take(state);
    if (stopping) return;
    if (state.phase === "paused" && was === "recording") job.onPaused?.(state.reason || "user");
    else if (state.phase === "recording" && was === "paused") job.onResumed?.();
    else if (!LIVE.has(state.phase) && state.phase !== "stopping" && LIVE.has(was)) job.onEnded?.(state.limitReached ? "limit" : "stopped");
  }

  async function readWhole(scribeId, seq) {
    const pieces = [];
    let offset = 0;
    for (;;) {
      const answer = await bridge.readPart({ scribeId, seq, offset, length: READ_BYTES });
      const size = Number(answer?.size) || 0;
      if (size > 0) pieces.push(fromBase64(answer.data));
      offset += size;
      if (size < READ_BYTES) break;
    }
    return new Blob(pieces, { type: MIME });
  }

  // Moves one part into the upload queue, one part at a time. A part that cannot
  // be read stays on the phone and is tried again later.
  function collect(seq, durationMs) {
    const { scribeId, userId, prefix, storePart } = job;
    chain = chain
      .then(async () => {
        if (collected.has(seq)) return;
        const blob = await readWhole(scribeId, seq);
        if (blob.size > 0) {
          await storePart({ scribeId, seq, blob, duration: (Number(durationMs) || 0) / 1000, mime: MIME, ext: EXT, prefix, userId });
        }
        collected.add(seq);
        await bridge.deletePart({ scribeId, seq }).catch(() => {});
      })
      .catch(() => {});
    return chain;
  }

  // Every part the phone has finished and the page has not collected yet.
  async function collectWaiting() {
    let parts = [];
    try {
      parts = (await bridge.pendingParts({ scribeId: job.scribeId }))?.parts ?? [];
    } catch {
      return chain;
    }
    for (const part of parts) collect(part.seq, part.durationMs);
    return chain;
  }

  async function sync() {
    try {
      apply(await bridge.recorderStatus());
    } catch {
      // The next event brings the state.
    }
    await collectWaiting();
  }

  // Events can wait while the app is hidden, so the state is read again when it is shown.
  function onVisible() {
    if (doc?.visibilityState === "visible" && job && !stopping) sync();
  }

  async function listen() {
    if (handles.length) return;
    handles = await Promise.all([
      bridge.addListener("recorderState", apply),
      bridge.addListener("recorderPart", (part) => {
        if (job && part?.scribeId === job.scribeId) collect(part.seq, part.durationMs);
      }),
      bridge.addListener("recorderLevel", ({ level }) => {
        levelValue = Math.max(0, Math.min(1, Number(level) || 0));
        levelAt = now();
      }),
    ]);
    doc?.addEventListener("visibilitychange", onVisible);
  }

  function release() {
    for (const handle of handles) handle?.remove?.();
    handles = [];
    doc?.removeEventListener("visibilitychange", onVisible);
  }

  return {
    /** The phone checks the microphone itself when recording starts. */
    async prepare() {
      return { mime: MIME, ext: EXT };
    },

    cancel() {},

    /** Starts recording on the phone: { scribeId, userId, prefix, segmentSeconds, maxSeconds, storePart, on… }. */
    async begin(options) {
      job = options;
      await listen();
      let state;
      try {
        state = await bridge.recorderStart({ scribeId: options.scribeId, segmentSeconds: options.segmentSeconds, maxSeconds: options.maxSeconds });
      } catch (error) {
        release();
        job = null;
        throw captureError(phoneStartMessage(error?.code));
      }
      take(state);
    },

    /** Takes up a recording that was started before the page was opened. */
    async attach(state, options) {
      job = options;
      take(state);
      await listen();
      await sync();
    },

    pause(reason = "user") {
      if (snapshot.phase !== "recording") return false;
      take({ ...snapshot, phase: "paused", reason, activeMs: elapsedMs() });
      bridge.recorderPause().catch(() => {});
      return true;
    },

    /** Carries on. Returns null, "in_call" while a call is going on, or "mic". */
    async resume() {
      let state;
      try {
        state = await bridge.recorderResume();
      } catch {
        return "mic";
      }
      if (state?.phase === "paused") {
        take(state);
        return state.reason === "call" ? "in_call" : "mic";
      }
      take(state ?? { ...snapshot, phase: "recording" });
      return null;
    },

    /** Stops, then waits until every part is in the upload queue. */
    async finish() {
      if (!job) return;
      stopping = true;
      try {
        take(await bridge.recorderStop());
      } catch {
        // The parts already finished are still collected.
      }
      await collectWaiting();
      await chain;
      await bridge.recorderDone({ scribeId: job.scribeId }).catch(() => {});
      release();
    },

    /** Stops and removes everything recorded from the phone. */
    async discard() {
      stopping = true;
      await bridge.recorderDiscard().catch(() => {});
      release();
    },

    /** Stops someone else's recording; its parts stay on the phone for them. */
    async stopLeftover() {
      await bridge.recorderStop().catch(() => {});
    },

    /** Moves the parts of a recording that ended while the app was closed. */
    async collectLeftover(options) {
      job = options;
      await collectWaiting();
    },

    // The phone starts new parts by itself.
    tick() {},

    elapsedMs,

    level() {
      return snapshot.phase === "recording" && now() - levelAt < LEVEL_FRESH_MS ? levelValue : 0;
    },
  };
}

/** The live or unfinished recording on the phone, or null. */
export async function findPhoneRecording(bridge) {
  const state = await bridge.recorderStatus();
  if (!state?.scribeId || state.phase === "idle") return null;
  return state;
}

/**
 * Moves parts left on the phone by recordings that ended while the app was closed
 * (or crashed) into the upload queue. Parts of a recording nobody on this device
 * can save any more (its entry is gone) are removed. Someone else's parts stay.
 */
export async function recoverPhoneParts(bridge, { userId, entries, live, addPart }) {
  const ids = (await bridge.recordingsOnPhone())?.recordings ?? [];
  if (!ids.length) return;
  const current = await bridge.recorderStatus().catch(() => null);
  for (const scribeId of ids) {
    if (live.has(scribeId)) continue;
    if (current?.scribeId === scribeId && current.phase !== "idle") continue;
    const entry = entries.find((row) => row.scribeId === scribeId);
    if (!entry) {
      await bridge.deleteParts({ scribeId }).catch(() => {});
      continue;
    }
    if (entry.userId !== userId) continue;
    await createNativeCapture({ bridge, doc: null }).collectLeftover({ scribeId, userId, prefix: entry.prefix, storePart: addPart });
  }
}
