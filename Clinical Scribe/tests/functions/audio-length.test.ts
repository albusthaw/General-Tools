// Unit tests for measuring how much sound an audio part holds. Minutes are charged
// for this length, so it must be right for every format the apps send, must not
// count paused time, and must not be fooled by a file whose own timing was
// changed. Files that cannot be read give no length.
// Run from the Clinical Scribe folder: deno test --allow-read=tests/functions/fixtures tests/functions/
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { audioSeconds, opusPacketSamples } from "../../supabase/functions/_shared/audio-length.ts";

const fixture = (name: string) => Deno.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

// Seven seconds of tone, made with ffmpeg (ffprobe says 7.0 seconds for each).
const SEVEN = [
  ["tone-7s.webm", "audio/webm;codecs=opus"],
  ["tone-7s-live.webm", "audio/webm"],
  ["tone-7s.ogg", "audio/ogg"],
  ["tone-7s.m4a", "audio/mp4"],
  ["tone-7s-fragmented.mp4", "audio/mp4"],
  ["tone-7s.aac", "audio/aac"],
];

Deno.test("every format the apps send is measured to within a tenth of a second", () => {
  for (const [name, type] of SEVEN) {
    const seconds = audioSeconds(fixture(name), type);
    assert(seconds !== null, `${name} has a length`);
    assertAlmostEquals(seconds, 7, 0.1, `${name}: ${seconds}`);
  }
});

Deno.test("a Chrome recording with a pause counts only the recorded sound", () => {
  // Recorded by Chrome's MediaRecorder: 3 s, a 2 s pause, then 3 s.
  const seconds = audioSeconds(fixture("chrome-6s-with-pause.webm"), "audio/webm");
  assert(seconds !== null);
  assertAlmostEquals(seconds, 6, 0.1);
});

Deno.test("a file that is not what it says, or not audio at all, has no length", () => {
  assertEquals(audioSeconds(new Uint8Array(20_000).fill(7), "audio/webm"), null);
  assertEquals(audioSeconds(new Uint8Array(20_000).fill(7), "audio/mp4"), null);
  assertEquals(audioSeconds(new Uint8Array(20_000).fill(7), "audio/ogg"), null);
  assertEquals(audioSeconds(new Uint8Array(20_000).fill(7), "audio/aac"), null);
  assertEquals(audioSeconds(fixture("tone-7s.webm"), "audio/mp4"), null);
  assertEquals(audioSeconds(fixture("tone-7s.m4a"), "audio/webm"), null);
  assertEquals(audioSeconds(fixture("tone-7s.aac"), "audio/wav"), null);
  assertEquals(audioSeconds(new Uint8Array(0), "audio/webm"), null);
});

Deno.test("data hidden after the last frame makes the file unreadable", () => {
  for (const [name, type] of [["tone-7s.aac", "audio/aac"], ["tone-7s.ogg", "audio/ogg"]]) {
    const original = fixture(name);
    const padded = new Uint8Array(original.length + 20_000);
    padded.set(original);
    padded.fill(0x41, original.length);
    assertEquals(audioSeconds(padded, type), null, name);
  }
});

Deno.test("audio hidden after a few kilobytes of other data makes the file unreadable", () => {
  const original = fixture("tone-7s-live.webm");
  const hidden = new Uint8Array(original.length * 2 + 3000);
  hidden.set(original);
  hidden.set(original, original.length + 3000);
  assertEquals(audioSeconds(hidden, "audio/webm"), null);
});

Deno.test("an MP4 recording cut off inside its audio data counts the frames listed so far", () => {
  const original = fixture("tone-7s-fragmented.mp4");
  const firstData = new TextDecoder("latin1").decode(original).indexOf("mdat") - 4;
  const seconds = audioSeconds(original.subarray(0, firstData + 2000), "audio/mp4");
  assert(seconds !== null && seconds > 0 && seconds < 7, String(seconds));
  // Cut anywhere else, the file is not accepted.
  assertEquals(audioSeconds(original.subarray(0, firstData - 100), "audio/mp4"), null);
});

Deno.test("more WebM audio added after the end is counted too", () => {
  const original = fixture("tone-7s-live.webm");
  const twice = new Uint8Array(original.length * 2);
  twice.set(original);
  twice.set(original, original.length);
  const seconds = audioSeconds(twice, "audio/webm");
  assert(seconds !== null);
  assertAlmostEquals(seconds, 14, 0.2);
});

Deno.test("a file cut off part way gives the length of what is there", () => {
  const original = fixture("tone-7s.aac");
  const half = audioSeconds(original.subarray(0, Math.floor(original.length / 2)), "audio/aac");
  assert(half !== null);
  assertAlmostEquals(half, 3.5, 0.2);
});

Deno.test("changing the timing written in an MP4 file does not shorten it", () => {
  const bytes = fixture("tone-7s.m4a").slice();
  const text = new TextDecoder("latin1").decode(bytes);
  const at = text.indexOf("stts");
  assert(at > 0);
  const view = new DataView(bytes.buffer);
  const entries = view.getUint32(at + 8);
  for (let i = 0; i < entries; i++) view.setUint32(at + 16 + i * 8, 1);
  const seconds = audioSeconds(bytes, "audio/mp4");
  assert(seconds !== null);
  assertAlmostEquals(seconds, 7, 0.1);
});

// Where the AAC setup (AudioSpecificConfig) starts in an MP4 file made by ffmpeg.
function aacSetupAt(bytes: Uint8Array): number {
  let pos = new TextDecoder("latin1").decode(bytes).indexOf("esds") + 8;
  const descriptor = (skip: number) => {
    pos++;
    while (bytes[pos] & 0x80) pos++;
    pos += 1 + skip;
  };
  descriptor(3);
  descriptor(13);
  descriptor(0);
  return pos;
}

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

Deno.test("an MP4 time table that lists fewer frames than the file holds does not shorten it", () => {
  const bytes = fixture("tone-7s.m4a").slice();
  const at = new TextDecoder("latin1").decode(bytes).indexOf("stts");
  const view = new DataView(bytes.buffer);
  const entries = view.getUint32(at + 8);
  for (let i = 0; i < entries; i++) view.setUint32(at + 12 + i * 8, 1);
  const seconds = audioSeconds(bytes, "audio/mp4");
  assert(seconds !== null);
  assertAlmostEquals(seconds, 7, 0.1);
});

Deno.test("an MP4 is measured at the rate its AAC frames are decoded at", () => {
  const original = fixture("tone-7s.m4a");
  const at = aacSetupAt(original);
  const rate = RATES[((original[at] & 0x07) << 1) | (original[at + 1] >> 7)];
  assert(rate > 0);

  // A faster rate written in the sample entry changes nothing.
  const faster = original.slice();
  const entry = new TextDecoder("latin1").decode(faster).indexOf("mp4a") - 4;
  new DataView(faster.buffer).setUint16(entry + 32, 65535);
  assertAlmostEquals(audioSeconds(faster, "audio/mp4") ?? 0, 7, 0.1);

  // AAC set up for 8 kHz plays for longer, and is measured that way.
  const slower = original.slice();
  slower[at] = (slower[at] & 0xf8) | (11 >> 1);
  slower[at + 1] = (slower[at + 1] & 0x7f) | 0x80;
  assertAlmostEquals(audioSeconds(slower, "audio/mp4") ?? 0, (7 * rate) / 8000, 0.5);
});

Deno.test("audio in a codec whose length cannot be checked has no length", () => {
  const swap = (name: string, from: string, to: string) => {
    const bytes = fixture(name).slice();
    const at = new TextDecoder("latin1").decode(bytes).indexOf(from);
    assert(at > 0, `${from} in ${name}`);
    bytes.set(new TextEncoder().encode(to), at);
    return bytes;
  };
  assertEquals(audioSeconds(swap("tone-7s.webm", "A_OPUS", "A_OPUZ"), "audio/webm"), null, "WebM without Opus");
  assertEquals(audioSeconds(swap("tone-7s.m4a", "mp4a", "Opus"), "audio/mp4"), null, "MP4 without AAC");

  // AAC with longer frames than 1024 samples (here AAC-LD's kind number).
  const otherKind = fixture("tone-7s.m4a").slice();
  const at = aacSetupAt(otherKind);
  otherKind[at] = (23 << 3) | (otherKind[at] & 0x07);
  assertEquals(audioSeconds(otherKind, "audio/mp4"), null, "another kind of AAC");
});

Deno.test("changing the end position written in an Ogg file does not shorten it", () => {
  const bytes = fixture("tone-7s.ogg").slice();
  // Every page's position is set to 1 sample; the packets themselves still count.
  for (let at = 0; at + 27 <= bytes.length; at++) {
    if (bytes[at] === 0x4f && bytes[at + 1] === 0x67 && bytes[at + 2] === 0x67 && bytes[at + 3] === 0x53) {
      const view = new DataView(bytes.buffer, at + 6, 8);
      if (view.getUint32(0, true) !== 0) {
        view.setUint32(0, 1, true);
        view.setUint32(4, 0, true);
      }
    }
  }
  const seconds = audioSeconds(bytes, "audio/ogg");
  assert(seconds !== null);
  assertAlmostEquals(seconds, 7, 0.1);
});

Deno.test("Opus packets say their own length", () => {
  assertEquals(opusPacketSamples(0b00001000, undefined), 960, "SILK 20 ms, one frame");
  assertEquals(opusPacketSamples(0b00011000, undefined), 2880, "SILK 60 ms, one frame");
  assertEquals(opusPacketSamples(0b11111001, undefined), 1920, "CELT 20 ms, two frames");
  assertEquals(opusPacketSamples(0b11111011, 3), 2880, "CELT 20 ms, three frames");
  assertEquals(opusPacketSamples(0b11111011, 7), null, "more than 120 ms in one packet is not valid");
  assertEquals(opusPacketSamples(0b11111011, 0), null, "no frames is not valid");
  assertEquals(opusPacketSamples(0b11111011, undefined), null, "a cut-off packet is not valid");
});
