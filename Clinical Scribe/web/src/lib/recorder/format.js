// Picks the best audio format the browser can record.
const CANDIDATES = [
  { full: "audio/webm;codecs=opus", base: "audio/webm", ext: "webm" },
  { full: "audio/webm", base: "audio/webm", ext: "webm" },
  { full: "audio/mp4;codecs=mp4a.40.2", base: "audio/mp4", ext: "m4a" },
  { full: "audio/mp4", base: "audio/mp4", ext: "m4a" },
  { full: "audio/ogg;codecs=opus", base: "audio/ogg", ext: "ogg" },
];

export function canRecord() {
  return Boolean(navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder === "function");
}

export function pickFormat() {
  if (!canRecord()) return null;
  for (const candidate of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate.full)) return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}
