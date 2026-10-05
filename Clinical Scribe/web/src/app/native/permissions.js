// Before the first recording on Android: a short explanation, then Android's own
// question for the microphone, and (Android 13 and newer) for notifications, so
// the recording can be seen and paused with the screen off.
import { openDialog } from "../../components/dialog.js";
import { h } from "../../lib/dom.js";
import { ScribeNative } from "./plugin.js";

function ask(text, { yes = "Continue", no = "Not now" } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title: "Before you record",
      body: [h("p", { text })],
      actions: [
        { label: no, onClick: () => ((answered = true), resolve(false)) },
        { label: yes, variant: "primary", onClick: () => ((answered = true), resolve(true)) },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}

function openSettingsSheet() {
  openDialog({
    title: "The microphone is not allowed",
    body: [h("p", { text: "Allow the microphone for Clinical Scribe in the phone's settings, then try again." })],
    actions: [
      { label: "Not now" },
      { label: "Open Settings", variant: "primary", onClick: () => ScribeNative.openSettings() },
    ],
  });
}

/** Resolves true when recording may start. */
export async function beforeRecording() {
  let status;
  try {
    status = await ScribeNative.permissionStatus();
  } catch {
    return true;
  }
  if (status.microphone !== "granted") {
    if (status.microphone === "denied") {
      openSettingsSheet();
      return false;
    }
    if (!(await ask("Clinical Scribe needs the microphone to record."))) return false;
    const result = await ScribeNative.requestMicrophone();
    if (result.microphone !== "granted") {
      if (result.microphone === "denied") openSettingsSheet();
      return false;
    }
  }
  if (status.notifications === "prompt") {
    if (await ask("Allow notifications to see and pause the recording when the screen is off.")) {
      await ScribeNative.requestNotifications().catch(() => {});
    }
  }
  return true;
}
