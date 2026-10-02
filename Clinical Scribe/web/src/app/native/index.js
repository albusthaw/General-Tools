// Everything the app build needs from Android, loaded only inside the Android app.
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Clipboard } from "@capacitor/clipboard";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { currentConnection, displayName } from "../../lib/connection/store.js";
import { parseAppLink } from "../../lib/platform/links.js";
import { handleBack } from "../back.js";
import { snackbar } from "../snackbar.js";
import { saveFile } from "./files.js";
import { finishGoogleSignIn, startGoogleSignIn } from "./google.js";
import { haptic } from "./haptics.js";
import { createCapture, findRecording, recoverParts } from "./native-capture.js";
import { beforeRecording } from "./permissions.js";
import { watchRecorder } from "./recording.js";
import { authStorage } from "./storage.js";

export { authStorage, beforeRecording, createCapture, findRecording, haptic, recoverParts, saveFile, startGoogleSignIn };

const LINK_KEY = "cs-connect-link";
const USED_KEY = "cs-launch-link-used";

function remember(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Not important.
  }
}

function recall(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function onLink(url) {
  const link = parseAppLink(url);
  if (!link) return;
  if (link.kind === "auth") {
    finishGoogleSignIn(link);
    return;
  }
  if (currentConnection()) {
    snackbar(`Clinical Scribe is connected to ${displayName(currentConnection())}. To use another server, open More and choose Change server.`, { timeout: 9000 });
    return;
  }
  remember(LINK_KEY, link.server);
  window.location.reload();
}

export async function setUp() {
  await SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => {});
  App.addListener("backButton", () => {
    if (!handleBack()) App.minimizeApp();
  });
  App.addListener("appUrlOpen", ({ url }) => onLink(url));
  watchRecorder();
}

/** The server link from a connect link that opened the app, used once. */
export async function takeConnectLink() {
  const pending = recall(LINK_KEY);
  remember(LINK_KEY, null);
  if (pending) return pending;
  if (recall(USED_KEY)) return "";
  const launch = await App.getLaunchUrl().catch(() => null);
  remember(USED_KEY, "1");
  const link = launch?.url ? parseAppLink(launch.url) : null;
  return link?.kind === "connect" ? link.server : "";
}

export async function readClipboard() {
  const result = await Clipboard.read();
  return typeof result?.value === "string" ? result.value : "";
}

export async function copyText(text) {
  try {
    await Clipboard.write({ string: text });
    return true;
  } catch {
    return false;
  }
}

/** Opens a web address in the phone's browser (https only). */
export function openExternal(address) {
  if (!/^https:\/\//.test(address)) return;
  Browser.open({ url: address }).catch(() => {});
}
