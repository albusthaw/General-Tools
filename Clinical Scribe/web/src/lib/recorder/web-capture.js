// Recording from the browser's microphone: the website and the iPhone web app.
// Sound is recorded in self-contained parts (a fresh file every few minutes), and
// every 5-second chunk is kept on the device while recording, so a closed tab never
// loses more than a few seconds. A call, other sound or a locked iPhone pauses the
// recording and says why. On Resume the microphone is opened again if it stopped,
// and a new part starts.
import { detectPlatform } from "../platform/detect.js";
import { captureError, isOwnPause, micMessage } from "./capture-rules.js";
import { pickFormat } from "./format.js";
import { createMeter } from "./meter.js";
import { partIsDue } from "./timing.js";

const CHUNK_MS = 5000;
const BITRATE = 32000;
const MIC = { audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } };
// A part that has not closed by then is left to the recovery of interrupted recordings.
const CLOSE_WAIT_MS = 4000;

// The promise, or nothing once ms have passed.
function within(promise, ms) {
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(resolve, ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The browser's microphone, as a capture for recorder.js. What it uses from the
 * browser can be passed in; the tests pass stand-ins.
 */
export function createWebCapture(env = {}) {
  const nav = globalThis.navigator;
  const media = env.mediaDevices ?? nav?.mediaDevices;
  const Recorder = env.MediaRecorder ?? globalThis.MediaRecorder;
  const doc = "document" in env ? env.document : globalThis.document;
  const audioSession = "audioSession" in env ? env.audioSession : nav?.audioSession;
  const wakeLock = "wakeLock" in env ? env.wakeLock : nav?.wakeLock;
  const meterFor = env.createMeter ?? createMeter;
  const now = env.now ?? (() => performance.now());
  // An iPhone stops the microphone of a page that is not on the screen.
  const pauseWhenHidden = env.pauseWhenHidden ?? detectPlatform(globalThis.window) === "ios";

  let format = env.format ?? null;
  let stream = null;
  let meter = null;
  let part = null;
  let job = null;
  let nextSeq = 1;
  let activeMs = 0;
  let resumedAt = null;
  let paused = false;
  let reason = "";
  let ended = false;
  let resuming = null;
  let screenLock = null;
  const closing = new Set();

  function settle(target) {
    if (target && target.resumedAt !== null) {
      target.activeMs += now() - target.resumedAt;
      target.resumedAt = null;
    }
  }

  function startPart() {
    const next = { seq: nextSeq++, chunks: [], index: 0, activeMs: 0, resumedAt: now(), discard: false };
    let resolve;
    next.done = new Promise((done) => (resolve = done));
    const recorder = new Recorder(stream, { mimeType: format.full, audioBitsPerSecond: BITRATE });
    next.recorder = recorder;

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0 || next.discard) return;
      next.chunks.push(event.data);
      job.saveChunk({ scribeId: job.scribeId, seq: next.seq, index: next.index++, blob: event.data, userId: job.userId, at: Date.now() });
    };
    recorder.onstop = () => {
      // The browser may stop a part by itself, for example when the microphone ends.
      settle(next);
      if (next.discard || next.chunks.length === 0) {
        resolve();
        return;
      }
      const blob = new Blob(next.chunks, { type: format.base });
      Promise.resolve()
        .then(() => job.storePart({
          scribeId: job.scribeId,
          seq: next.seq,
          blob,
          duration: next.activeMs / 1000,
          mime: format.base,
          ext: job.ext,
          prefix: job.prefix,
          userId: job.userId,
        }))
        .catch(() => {})
        .finally(resolve);
    };

    recorder.start(CHUNK_MS);
    part = next;
    return next;
  }

  // Stops a part; it is handed on once its last chunk has arrived.
  function closePart(target) {
    if (!target) return Promise.resolve();
    settle(target);
    if (target.recorder.state !== "inactive") {
      try {
        target.recorder.stop();
      } catch {
        // It stopped by itself.
      }
    }
    const done = within(target.done, CLOSE_WAIT_MS);
    closing.add(done);
    done.finally(() => closing.delete(done));
    return done;
  }

  function pause(why = "user") {
    if (!part || paused || ended) return false;
    if (part.recorder.state === "recording") {
      try {
        part.recorder.pause();
      } catch {
        // It stopped by itself; Resume starts a new part.
      }
    }
    settle(part);
    if (resumedAt !== null) {
      activeMs += now() - resumedAt;
      resumedAt = null;
    }
    paused = true;
    reason = why;
    return true;
  }

  // A pause the person did not ask for.
  function interrupt(why) {
    if (pause(why)) job?.onPaused?.(why);
  }

  const onMute = () => interrupt(doc?.visibilityState === "hidden" ? "hidden" : "interrupted");
  const onTrackEnded = () => interrupt("mic_lost");

  function watch(target) {
    for (const track of target?.getAudioTracks?.() ?? []) {
      track.addEventListener("mute", onMute);
      track.addEventListener("ended", onTrackEnded);
    }
  }

  function unwatch(target) {
    for (const track of target?.getAudioTracks?.() ?? []) {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("ended", onTrackEnded);
    }
  }

  function onVisibility() {
    if (doc.visibilityState === "hidden") {
      if (pauseWhenHidden) interrupt("hidden");
    } else if (!paused) {
      keepAwake();
    }
  }

  function onSessionState() {
    if (audioSession?.state === "interrupted") interrupt("interrupted");
  }

  function setSessionType(type) {
    try {
      if (audioSession && "type" in audioSession) audioSession.type = type;
    } catch {
      // Older browsers have no audio session setting.
    }
  }

  // Keeps the screen on while recording, where the browser allows it.
  async function keepAwake() {
    if (screenLock || !wakeLock?.request || doc?.visibilityState !== "visible") return;
    try {
      const lock = await wakeLock.request("screen");
      if (ended) {
        lock?.release?.().catch?.(() => {});
        return;
      }
      screenLock = lock;
      lock?.addEventListener?.("release", () => {
        if (screenLock === lock) screenLock = null;
      });
    } catch {
      // Not available on every device; recording still works.
    }
  }

  // Opens the microphone again after it stopped. False when it cannot (for
  // example while a call still has it).
  async function reopen() {
    let fresh;
    try {
      fresh = await media.getUserMedia(MIC);
    } catch {
      return false;
    }
    const track = fresh.getAudioTracks()[0];
    if (ended || !track || track.readyState !== "live" || track.muted) {
      fresh.getTracks().forEach((item) => item.stop());
      return false;
    }
    unwatch(stream);
    stream?.getTracks().forEach((item) => item.stop());
    meter?.close();
    stream = fresh;
    meter = meterFor(stream);
    watch(stream);
    return true;
  }

  async function carryOn() {
    const track = stream?.getAudioTracks?.()[0];
    const healthy = Boolean(track) && track.readyState === "live" && !track.muted;
    if (healthy && isOwnPause(reason) && part.recorder.state === "paused") {
      part.recorder.resume();
    } else {
      // After an interruption the paused file may not carry on cleanly, so it is
      // kept as it is and a new part starts.
      await closePart(part);
      if (ended) return null;
      if (!healthy && !(await reopen())) return "mic";
      if (ended) return null;
      startPart();
    }
    meter?.wake?.();
    part.resumedAt = now();
    resumedAt = now();
    paused = false;
    reason = "";
    keepAwake();
    return null;
  }

  function release() {
    unwatch(stream);
    stream?.getTracks().forEach((track) => track.stop());
    meter?.close();
    doc?.removeEventListener("visibilitychange", onVisibility);
    audioSession?.removeEventListener?.("statechange", onSessionState);
    setSessionType("auto");
    screenLock?.release?.().catch?.(() => {});
    screenLock = null;
  }

  return {
    /** Opens the microphone. Returns the audio type; throws a message for the person. */
    async prepare() {
      if (!media?.getUserMedia || typeof Recorder !== "function") {
        throw captureError("This browser cannot record audio. Use a recent version of Chrome, Edge, Firefox or Safari.");
      }
      format = format ?? pickFormat();
      if (!format) {
        throw captureError("This browser cannot record audio in a supported format. Use a recent version of Chrome, Edge, Firefox or Safari.");
      }
      try {
        stream = await media.getUserMedia(MIC);
      } catch (error) {
        throw captureError(micMessage(error));
      }
      return { mime: format.base, ext: format.ext };
    },

    /** Lets the microphone go when recording will not begin after all. */
    cancel() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    },

    /** Starts recording: { scribeId, userId, prefix, ext, segmentSeconds, storePart, saveChunk, onPaused }. */
    async begin(options) {
      job = { ...options, ext: options.ext ?? format.ext };
      meter = meterFor(stream);
      watch(stream);
      doc?.addEventListener("visibilitychange", onVisibility);
      audioSession?.addEventListener?.("statechange", onSessionState);
      setSessionType("play-and-record");
      resumedAt = now();
      startPart();
      keepAwake();
    },

    pause,

    /** Carries on after a pause. Returns null, or "mic" when the microphone could not start again. */
    resume() {
      if (!part || !paused || ended) return Promise.resolve(null);
      if (!resuming) resuming = carryOn().finally(() => (resuming = null));
      return resuming;
    },

    /** Stops, and waits until every part has been handed on. */
    async finish() {
      if (!part || ended) return;
      pause("finish");
      ended = true;
      await closePart(part);
      await Promise.all([...closing]);
      release();
    },

    /** Stops and keeps nothing. */
    async discard() {
      ended = true;
      if (part) {
        part.discard = true;
        if (part.recorder.state !== "inactive") {
          try {
            part.recorder.stop();
          } catch {
            // Already stopped.
          }
        }
      }
      release();
    },

    /** Starts the next part once the current one is long enough. */
    tick() {
      if (!part || paused || ended) return;
      const live = part.resumedAt !== null ? now() - part.resumedAt : 0;
      if (!partIsDue((part.activeMs + live) / 1000, job.segmentSeconds)) return;
      // The new part starts before the old one stops, so no speech is lost between parts.
      const old = part;
      settle(old);
      startPart();
      closePart(old);
    },

    elapsedMs() {
      return activeMs + (!paused && resumedAt !== null ? now() - resumedAt : 0);
    },

    level() {
      return meter && !paused ? meter.level() : 0;
    },
  };
}
