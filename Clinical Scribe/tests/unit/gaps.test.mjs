// Unit tests for information gaps (lib/gaps.js): where a recording paused by itself
// is worked out from its parts the same way the server marks the transcript, said in
// plain words, and the transcript line and the note sentence are recognised.
import assert from "node:assert/strict";
import { test } from "node:test";
import { causeOf, gapsOf, gapText, isGapMarker, isGapSentence } from "../../web/src/lib/gaps.js";

test("a gap sits after all the parts before it, measured where the server measured them", () => {
  const parts = [
    { seq: 3, duration_seconds: 30, measured_seconds: null, gap_seconds: 15.5, gap_reason: "other_audio" },
    { seq: 1, duration_seconds: 600, measured_seconds: 601.2, gap_seconds: null, gap_reason: null },
    { seq: 2, duration_seconds: 152, measured_seconds: 152.4, gap_seconds: 81.2, gap_reason: "call" },
  ];
  assert.deepEqual(gapsOf(parts), [
    { at: 601.2, seconds: 81.2, reason: "call" },
    { at: 753.6, seconds: 15.5, reason: "other_audio" },
  ]);
  assert.deepEqual(gapsOf([]), []);
  assert.deepEqual(gapsOf(null), []);
  assert.deepEqual(gapsOf([{ seq: 1, duration_seconds: 5, gap_seconds: 0, gap_reason: null }]), [{ at: 0, seconds: 0, reason: "interrupted" }]);
});

test("a gap is said in plain words", () => {
  assert.equal(gapText({ at: 754, seconds: 80, reason: "call" }), "At 12:34, for 1 min 20 s, because of a phone call");
  assert.equal(gapText({ at: 3723, seconds: 0.2, reason: "hidden" }), "At 1:02:03, for 1 s, because of the screen locking or another app opening");
  assert.equal(causeOf("other_audio"), "another app playing sound");
  assert.equal(causeOf("interrupted"), "an interruption");
  assert.equal(causeOf("anything else"), "an interruption");
});

test("the transcript line and the note sentence are recognised, nothing else", () => {
  assert.equal(isGapMarker("[Information gap at 12:34. The recording paused for 1 minute 20 seconds because of a phone call. Nothing was recorded during this time.]"), true);
  assert.equal(isGapMarker("  [Information gap at 1:02:03. The recording paused for 5 seconds because of an interruption.]"), true);
  assert.equal(isGapMarker("Speaker 1: there was an information gap at 12:34."), false);
  assert.equal(isGapMarker("[inaudible]"), false);
  assert.equal(isGapSentence("There is an information gap after the chest pain history (12:34). Please relate accordingly."), true);
  assert.equal(isGapSentence("- There is an information gap after 12:34 in the recording. Please relate accordingly."), true);
  assert.equal(isGapSentence("No information gap was found."), false);
});
