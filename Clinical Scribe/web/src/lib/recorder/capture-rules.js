// Rules shared by the two ways of recording: the browser's microphone (the website
// and the iPhone web app) and the Android app's own recorder. They say why a
// recording paused by itself, what the recorder screen tells the person about it,
// and what to say when recording cannot start or carry on.
import { UserError } from "../errors.js";

// A call, other sound, a locked screen or a lost microphone never ends a recording.
// It pauses with one of these reasons, and the person taps Resume when ready.
const PAUSED = {
  call: "Paused for a phone call. Tap Resume when you are ready.",
  other_audio: "Paused because another app played sound. Tap Resume to carry on.",
  interrupted: "Paused because the microphone was needed elsewhere, for example for a call. Tap Resume to carry on.",
  hidden: "Paused because the screen locked or another app opened. Tap Resume to carry on.",
  media: "Paused while sound played in Clinical Scribe. Tap Resume to carry on.",
  mic_lost: "The microphone stopped. Tap Resume to try again.",
  mic_busy: "Another app is using the microphone. Tap Resume to try again.",
};

// Pauses the person made (in the app, or in the Android notification).
const OWN_PAUSES = new Set(["user", "notification"]);

/** The message for a pause the person did not ask for, or null. */
export function pausedMessage(reason) {
  return PAUSED[reason] ?? null;
}

export function isOwnPause(reason) {
  return OWN_PAUSES.has(reason);
}

const REFUSED = {
  in_call: "You can resume when the call has ended.",
  mic: "The microphone could not start again. If a call is going on, try again when it has ended.",
};

/** What to say when Resume could not carry on ("in_call" or "mic"). */
export function refusedMessage(code) {
  return REFUSED[code] ?? REFUSED.mic;
}

/** A problem the person can act on; its message is shown as it is. */
export function captureError(message) {
  return new UserError(message, "capture");
}

/** The message for a microphone the browser could not open. */
export function micMessage(error) {
  const name = error?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError") return "The microphone is being used by another app. Close it and try again.";
  return "The microphone could not be started. Please try again.";
}

const PHONE_START = {
  mic_denied: "Microphone access is blocked. Allow the microphone for Clinical Scribe in the phone's settings, then try again.",
  mic_busy: "The microphone is being used by another app. Close it and try again.",
  in_call: "Recording cannot start during a call. Try again when the call has ended.",
  not_allowed: "Recording can only start while Clinical Scribe is open on the screen. Please try again.",
  busy: "Another recording is still being saved on this phone. Please try again in a moment.",
};

/** The message when the Android app's recorder could not start. */
export function phoneStartMessage(code) {
  return PHONE_START[code] ?? "The microphone could not be started. Please try again.";
}
