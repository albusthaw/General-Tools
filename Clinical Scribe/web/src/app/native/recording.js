// Recording with the screen off on Android: while a recording runs, the Android
// code keeps a recording notification with the time and Pause or Resume, which
// lets the microphone keep working when the screen is off. The notification never
// shows the recording label, so the label is not sent to Android at all. The
// screen stays awake while the app is open, until the last part is uploaded.
// Each change also gives a short vibration.
import { elapsedSeconds, onRecorderChange, pause, resume } from "../../lib/recorder/recorder.js";
import { haptic } from "./haptics.js";
import { ScribeNative } from "./plugin.js";

const LIVE = new Set(["recording", "paused"]);

export function watchRecorder() {
  let previous = "idle";

  onRecorderChange((state) => {
    const phase = state.phase;
    if (phase === previous) return;
    const was = previous;
    previous = phase;
    const elapsedMs = Math.round(elapsedSeconds() * 1000);

    if (phase === "recording" && !LIVE.has(was)) {
      haptic("medium");
      ScribeNative.keepAwake({ on: true }).catch(() => {});
      ScribeNative.startRecording({ startedAt: Date.now() - elapsedMs }).catch(() => {});
    } else if (LIVE.has(phase)) {
      haptic("light");
      ScribeNative.updateRecording({ paused: phase === "paused", elapsedMs }).catch(() => {});
    } else if (LIVE.has(was)) {
      ScribeNative.stopRecording().catch(() => {});
      if (phase === "finishing" || phase === "done") haptic("success");
      if (phase !== "finishing") ScribeNative.keepAwake({ on: false }).catch(() => {});
    } else if (was === "finishing") {
      ScribeNative.keepAwake({ on: false }).catch(() => {});
    }
  });

  // Pause and Resume pressed in the notification.
  ScribeNative.addListener("recordingAction", ({ action }) => {
    if (action === "pause") pause();
    else if (action === "resume") resume();
  });
}
