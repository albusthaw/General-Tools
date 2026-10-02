// A short vibration when a recording starts, pauses, resumes or is saved. The
// recording itself, and its notification with Pause and Resume, run in the
// app's Android code (see native-capture.js), so they carry on with the screen off.
import { onRecorderChange } from "../../lib/recorder/recorder.js";
import { haptic } from "./haptics.js";

const LIVE = new Set(["recording", "paused"]);

export function watchRecorder() {
  let previous = "idle";

  onRecorderChange(({ phase }) => {
    if (phase === previous) return;
    const was = previous;
    previous = phase;
    // A recording taken up again when the app opens starts without "preparing".
    if (phase === "recording" && was === "preparing") haptic("medium");
    else if (LIVE.has(phase) && LIVE.has(was)) haptic("light");
    else if (phase === "finishing" && LIVE.has(was)) haptic("success");
  });
}
