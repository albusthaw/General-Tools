// Timing rules for the recorder: when a new part starts, and when to warn about
// or stop at the recording limit (the longest recording, or the minutes left).

export const WARN_BEFORE_LIMIT_S = 120;

// A new part starts once the current one holds this much sound.
export function partIsDue(partSeconds, segmentSeconds) {
  return partSeconds >= segmentSeconds;
}

// "stop" at the limit; "warn" once, two minutes before it, for limits longer than
// two minutes; otherwise null.
export function limitAction(elapsedSeconds, maxSeconds, alreadyWarned) {
  if (elapsedSeconds >= maxSeconds) return "stop";
  if (!alreadyWarned && maxSeconds > WARN_BEFORE_LIMIT_S && maxSeconds - elapsedSeconds <= WARN_BEFORE_LIMIT_S) return "warn";
  return null;
}
