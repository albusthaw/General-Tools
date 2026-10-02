// Unit tests for recording from the browser's microphone (web-capture.js) with
// stand-ins for the browser: parts are handed on, a call, a muted or stopped
// microphone, a locked iPhone and the audio session pause the recording with a
// reason instead of ending it, and Resume opens the microphone again when needed.
// Also the shared pause messages and the Screen off rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canStayUnlocked, isFaceDown, timerSpot } from "../../web/src/app/screen-off-rules.js";
import { UserError } from "../../web/src/lib/errors.js";
import { isOwnPause, micMessage, pausedMessage, phoneStartMessage, refusedMessage } from "../../web/src/lib/recorder/capture-rules.js";
import { createWebCapture } from "../../web/src/lib/recorder/web-capture.js";

const FORMAT = { full: "audio/webm;codecs=opus", base: "audio/webm", ext: "webm" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeTrack extends EventTarget {
  readyState = "live";
  muted = false;
  stop() {
    this.readyState = "ended";
  }
  mute() {
    this.muted = true;
    this.dispatchEvent(new Event("mute"));
  }
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeStream {
  tracks = [new FakeTrack()];
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

// A browser with a clock, a microphone and MediaRecorder that the test controls.
function fakeBrowser({ hidden = false } = {}) {
  let time = 0;
  const recorders = [];
  const streams = [];
  const stored = [];
  const chunks = [];
  const paused = [];
  const media = {
    failNext: 0,
    async getUserMedia() {
      if (this.failNext > 0) {
        this.failNext -= 1;
        throw Object.assign(new Error("in use"), { name: "NotReadableError" });
      }
      const stream = new FakeStream();
      streams.push(stream);
      return stream;
    },
  };
  class Recorder {
    state = "inactive";
    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      recorders.push(this);
    }
    start() {
      this.state = "recording";
      this.ondataavailable({ data: new Blob([`part ${recorders.length}`]) });
    }
    pause() {
      this.state = "paused";
    }
    resume() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      setTimeout(() => {
        this.ondataavailable({ data: new Blob([" end"]) });
        this.onstop();
      }, 0);
    }
  }
  const doc = Object.assign(new EventTarget(), { visibilityState: hidden ? "hidden" : "visible" });
  const audioSession = Object.assign(new EventTarget(), { type: "auto", state: "active" });
  const released = [];
  const wakeLock = { asked: 0, async request() { this.asked += 1; return { release: async () => released.push(true) }; } };
  const meters = [];
  const createMeter = (stream) => {
    const meter = { stream, closed: false, woken: 0, level: () => 0.4, wake() { this.woken += 1; }, close() { this.closed = true; } };
    meters.push(meter);
    return meter;
  };
  return {
    recorders,
    streams,
    stored,
    chunks,
    paused,
    media,
    doc,
    audioSession,
    wakeLock,
    released,
    meters,
    advance: (ms) => (time += ms),
    capture: (extra = {}) =>
      createWebCapture({
        mediaDevices: media,
        MediaRecorder: Recorder,
        document: doc,
        audioSession,
        wakeLock,
        createMeter,
        format: FORMAT,
        now: () => time,
        pauseWhenHidden: false,
        ...extra,
      }),
    job: (extra = {}) => ({
      scribeId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      prefix: "user-1/11111111-1111-4111-8111-111111111111",
      ext: "webm",
      segmentSeconds: 5,
      storePart: async (part) => stored.push(part),
      saveChunk: (chunk) => chunks.push(chunk),
      onPaused: (reason) => paused.push(reason),
      ...extra,
    }),
  };
}

test("records in parts, starts the next part before the last one stops, and hands each part on", async () => {
  const browser = fakeBrowser();
  const capture = browser.capture();
  assert.deepEqual(await capture.prepare(), { mime: "audio/webm", ext: "webm" });
  await capture.begin(browser.job());
  assert.equal(browser.recorders.length, 1);
  assert.equal(browser.recorders[0].options.mimeType, "audio/webm;codecs=opus");

  browser.advance(4000);
  capture.tick();
  assert.equal(browser.recorders.length, 1, "a part shorter than the part length carries on");
  browser.advance(1500);
  capture.tick();
  assert.equal(browser.recorders.length, 2, "the next part has started");
  assert.equal(browser.recorders[1].state, "recording");
  await settle();
  assert.equal(browser.stored.length, 1);
  assert.equal(browser.stored[0].seq, 1);
  assert.equal(browser.stored[0].duration, 5.5);
  assert.equal(browser.stored[0].mime, "audio/webm");
  assert.equal(browser.stored[0].ext, "webm");
  assert.equal(await browser.stored[0].blob.text(), "part 1 end");
  assert.ok(browser.chunks.some((chunk) => chunk.seq === 1 && chunk.index === 0), "chunks are kept while recording");

  browser.advance(2000);
  assert.equal(capture.elapsedMs(), 7500);
  await capture.finish();
  assert.deepEqual(browser.stored.map((part) => part.seq), [1, 2]);
  assert.equal(browser.stored[1].duration, 2);
  assert.equal(browser.streams[0].tracks[0].readyState, "ended", "the microphone is let go");
});

test("a pause by the person carries on in the same part, and paused time is not counted", async () => {
  const browser = fakeBrowser();
  const capture = browser.capture();
  await capture.prepare();
  await capture.begin(browser.job({ segmentSeconds: 600 }));
  browser.advance(3000);
  assert.equal(capture.pause("user"), true);
  assert.equal(browser.recorders[0].state, "paused");
  assert.equal(capture.level(), 0);
  browser.advance(10_000);
  assert.equal(capture.elapsedMs(), 3000);
  assert.equal(await capture.resume(), null);
  assert.equal(browser.recorders.length, 1);
  assert.equal(browser.recorders[0].state, "recording");
  browser.advance(1000);
  assert.equal(capture.elapsedMs(), 4000);
  assert.deepEqual(browser.paused, [], "the person's own pause is not reported back");
});

test("a muted microphone pauses with a reason; Resume opens it again and starts a new part", async () => {
  const browser = fakeBrowser();
  const capture = browser.capture();
  await capture.prepare();
  await capture.begin(browser.job({ segmentSeconds: 600 }));
  browser.advance(2000);
  browser.streams[0].tracks[0].mute();
  assert.deepEqual(browser.paused, ["interrupted"]);
  browser.advance(30_000);
  assert.equal(capture.elapsedMs(), 2000, "the time stops while paused");

  assert.equal(await capture.resume(), null);
  assert.equal(browser.streams.length, 2, "the microphone was opened again");
  assert.equal(browser.streams[0].tracks[0].readyState, "ended");
  assert.equal(browser.recorders.length, 2);
  assert.equal(browser.recorders[1].stream, browser.streams[1]);
  assert.equal(browser.meters.at(-1).stream, browser.streams[1], "the sound level follows the new microphone");
  assert.deepEqual(browser.stored.map((part) => part.seq), [1], "the part before the pause is kept");
  await capture.finish();
  assert.deepEqual(browser.stored.map((part) => part.seq), [1, 2]);
});

test("after a call the same microphone carries on in a new part when it works again", async () => {
  const browser = fakeBrowser();
  const capture = browser.capture();
  await capture.prepare();
  await capture.begin(browser.job({ segmentSeconds: 600 }));
  browser.audioSession.state = "interrupted";
  browser.audioSession.dispatchEvent(new Event("statechange"));
  assert.deepEqual(browser.paused, ["interrupted"]);
  browser.audioSession.state = "active";
  assert.equal(await capture.resume(), null);
  assert.equal(browser.streams.length, 1, "a working microphone is not opened again");
  assert.equal(browser.recorders.length, 2, "a new part starts after an interruption");
  assert.equal(browser.meters[0].woken, 1);
  await capture.finish();
  assert.equal(browser.audioSession.type, "auto", "the audio session is handed back");
});

test("a microphone that stopped is opened on Resume, and Resume says when it cannot be", async () => {
  const browser = fakeBrowser();
  const capture = browser.capture();
  await capture.prepare();
  await capture.begin(browser.job({ segmentSeconds: 600 }));
  assert.equal(browser.audioSession.type, "play-and-record");
  browser.streams[0].tracks[0].end();
  assert.deepEqual(browser.paused, ["mic_lost"]);
  browser.media.failNext = 1;
  assert.equal(await capture.resume(), "mic");
  assert.equal(capture.pause("user"), false, "it is still paused");
  assert.equal(await capture.resume(), null);
  assert.equal(browser.streams.length, 2);
  assert.equal(browser.recorders.at(-1).state, "recording");
});

test("an iPhone pauses when the screen locks; elsewhere the recording carries on", async () => {
  const phone = fakeBrowser();
  const onPhone = phone.capture({ pauseWhenHidden: true });
  await onPhone.prepare();
  await onPhone.begin(phone.job());
  phone.doc.visibilityState = "hidden";
  phone.doc.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(phone.paused, ["hidden"]);
  phone.streams[0].tracks[0].mute();
  assert.deepEqual(phone.paused, ["hidden"], "a second signal does not pause twice");

  const computer = fakeBrowser();
  const onComputer = computer.capture();
  await onComputer.prepare();
  await onComputer.begin(computer.job());
  computer.doc.visibilityState = "hidden";
  computer.doc.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(computer.paused, []);
  assert.equal(computer.recorders[0].state, "recording");
});

test("the screen is kept on while recording, and nothing is kept after Discard", async () => {
  const browser = fakeBrowser();
  const capture = browser.capture();
  await capture.prepare();
  await capture.begin(browser.job());
  await settle();
  assert.equal(browser.wakeLock.asked, 1);
  await capture.discard();
  await settle();
  assert.deepEqual(browser.stored, []);
  assert.equal(browser.released.length, 1);
  assert.equal(browser.streams[0].tracks[0].readyState, "ended");
});

test("a browser that cannot record, or a blocked microphone, gets a clear message", async () => {
  const none = createWebCapture({ mediaDevices: {}, MediaRecorder: undefined, document: null, audioSession: null, wakeLock: null, format: FORMAT, pauseWhenHidden: false });
  await assert.rejects(none.prepare(), (error) => error instanceof UserError && /cannot record audio/.test(error.message));

  const browser = fakeBrowser();
  browser.media.getUserMedia = async () => {
    throw Object.assign(new Error("no"), { name: "NotAllowedError" });
  };
  await assert.rejects(browser.capture().prepare(), (error) => error instanceof UserError && /blocked/.test(error.message));
});

test("every pause by itself has a message; the person's own pauses have none", () => {
  for (const reason of ["call", "other_audio", "interrupted", "hidden", "media", "mic_lost", "mic_busy"]) {
    assert.ok(pausedMessage(reason)?.includes("Resume"), `${reason} explains how to carry on`);
  }
  for (const reason of ["user", "notification"]) {
    assert.equal(pausedMessage(reason), null);
    assert.equal(isOwnPause(reason), true);
  }
  assert.equal(isOwnPause("call"), false);
  assert.match(refusedMessage("in_call"), /call has ended/);
  assert.match(refusedMessage("anything"), /microphone/);
  assert.match(micMessage({ name: "NotFoundError" }), /No microphone/);
  assert.match(phoneStartMessage("mic_denied"), /settings/);
  assert.match(phoneStartMessage("in_call"), /call/);
  assert.match(phoneStartMessage("unknown"), /could not be started/);
});

test("Screen off: face down is noticed, the timer stays on the screen, and old iPhones are told about locking", () => {
  assert.equal(isFaceDown(178, 3), true);
  assert.equal(isFaceDown(-172, -10), true);
  assert.equal(isFaceDown(0, 0), false, "face up");
  assert.equal(isFaceDown(90, 0), false, "standing up");
  assert.equal(isFaceDown(170, 60), false, "on its side");
  assert.equal(isFaceDown(null, undefined), false);

  for (const value of [0, 0.5, 0.999]) {
    const spot = timerSpot(() => value, 390, 844, 160, 24);
    assert.ok(spot.x >= 24 && spot.x + 160 <= 390 - 24 + 1, `x ${spot.x} stays clear of the edges`);
    assert.ok(spot.y >= 844 * 0.12 - 1 && spot.y + 24 <= 844 * 0.82 + 1, `y ${spot.y} stays clear of the top and bottom`);
  }

  const agent = (version) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15`;
  assert.equal(canStayUnlocked(agent("18_3"), true), false);
  assert.equal(canStayUnlocked(agent("18_4"), true), true);
  assert.equal(canStayUnlocked(agent("26_0"), true), true);
  assert.equal(canStayUnlocked(agent("17_5"), false), true, "a Safari tab can stay unlocked");
  assert.equal(canStayUnlocked("Mozilla/5.0 (Linux; Android 16)", true), true);
});
