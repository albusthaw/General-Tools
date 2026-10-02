// Fills the app hooks used by the shared screens (see lib/platform/hooks.js).
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { appHooks } from "../lib/platform/hooks.js";
import { pageState } from "./page-state.js";
import { enhancePicker } from "./picker.js";
import { recorderExtras } from "./recorder-extras.js";
import { decorateSheet } from "./sheet.js";

export function installAppHooks({ platform, native }) {
  appHooks.decorateDialog = decorateSheet;
  appHooks.enhancePicker = enhancePicker;
  appHooks.recorderExtras = (card, options) => recorderExtras(card, { ...options, platform });
  appHooks.enhanceList = (element, options) => pageState()?.enhanceList(element, options);
  appHooks.pageAction = (button) => pageState()?.setAction(button);
  appHooks.haptic = native ? native.haptic : () => {};
  // A copy button turns into a green tick with "Copied" for a moment.
  appHooks.copied = (button) => {
    if (button.classList.contains("is-copied")) return;
    appHooks.haptic("success");
    const before = [...button.childNodes];
    button.setAttribute("aria-live", "polite");
    button.classList.add("is-copied");
    replace(button, icon("check"), h("span", { text: "Copied" }));
    setTimeout(() => {
      button.classList.remove("is-copied");
      replace(button, ...before);
    }, 1500);
  };
  if (native) {
    appHooks.saveFile = native.saveFile;
    appHooks.copyText = native.copyText;
    appHooks.startGoogleSignIn = native.startGoogleSignIn;
    appHooks.beforeRecording = native.beforeRecording;
    appHooks.openExternal = native.openExternal;
    // Android records by itself, so recording carries on with the screen off.
    appHooks.createCapture = native.createCapture;
    appHooks.findPhoneRecording = native.findRecording;
    appHooks.recoverPhoneParts = native.recoverParts;
  }
}
