// Information gaps: places where a recording paused by itself (a call, other sound,
// a locked iPhone) and nothing was recorded. The part recorded after a gap carries
// it to the server, which marks the place in the transcript with a line starting
// "[Information gap at 12:34."; the note points out each one with a sentence starting
// "There is an information gap after". Shared by the recorder, the processing screen
// and History.
import { clock, duration } from "./format.js";

// Why the recording paused, in words that follow "because of". The same words as in
// the transcript line (app_private.gap_cause on the server).
const CAUSES = {
  call: "a phone call",
  other_audio: "another app playing sound",
  mic_lost: "the microphone stopping",
  mic_busy: "another app using the microphone",
  hidden: "the screen locking or another app opening",
  media: "sound playing in Clinical Scribe",
};

export function causeOf(reason) {
  return CAUSES[reason] ?? "an interruption";
}

/**
 * The gaps of a recording from its parts on the server, in order: [{ at, seconds,
 * reason }], at being the time recorded before the gap. The same sum the server uses
 * for the transcript line: the measured length of every earlier part.
 */
export function gapsOf(segments) {
  let at = 0;
  const gaps = [];
  for (const part of [...(segments ?? [])].sort((a, b) => a.seq - b.seq)) {
    if (part.gap_seconds !== null && part.gap_seconds !== undefined) {
      gaps.push({ at, seconds: Math.max(0, Number(part.gap_seconds) || 0), reason: part.gap_reason || "interrupted" });
    }
    at += Math.max(0, Number(part.measured_seconds ?? part.duration_seconds) || 0);
  }
  return gaps;
}

/** "At 12:34, for 1 min 20 s, because of a phone call" */
export function gapText(gap) {
  return `At ${clock(gap.at)}, for ${duration(Math.max(1, gap.seconds))}, because of ${causeOf(gap.reason)}`;
}

/** The line that marks a gap in a transcript. */
export function isGapMarker(line) {
  return /^\[Information gap at \d+:\d{2}(?::\d{2})?\./.test(String(line ?? "").trim());
}

/** The sentence a note uses to point out a gap, alone or as a list line. */
export function isGapSentence(line) {
  return /^(?:[-•*]\s+)?There is an information gap after\b/i.test(String(line ?? "").trim());
}
