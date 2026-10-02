// Start-up of the app build: the Android app and the iPhone web app. It sets the
// look for the phone, connects to a server (asking for the server link the first
// time), then starts the same app as the website inside the app frame.
import "../styles/app/frame.css";
import "../styles/app/components.css";
import "../styles/app/recorder.css";
import "../styles/app/connect.css";
import "../styles/app/ios.css";
import "../styles/app/android.css";

import { useServer } from "../config.js";
import { storageName } from "../lib/connection/link.js";
import { currentConnection } from "../lib/connection/store.js";
import { detectPlatform, isStandalone } from "../lib/platform/detect.js";
import { createSupabase } from "../lib/supabase.js";
import { startApp } from "../views/app.js";
import { renderConnect } from "./connect.js";
import { mountAppFrame } from "./frame.js";
import { installAppHooks } from "./hooks.js";
import { renderInstall, shouldOfferInstall } from "./install.js";
import { appLogin } from "./login.js";
import { takeServerChoice } from "./server-switch.js";
import { registerServiceWorker } from "./service-worker.js";

export async function startMobileApp(root) {
  const platform = detectPlatform(window);
  const html = document.documentElement;
  html.dataset.app = "";
  html.dataset.theme = platform === "ios" ? "ios" : "android";
  html.dataset.platform = platform;
  html.dataset.standalone = String(platform === "android" || isStandalone(window));

  const native = platform === "android" ? await import("./native/index.js") : null;
  if (native) await native.setUp();
  installAppHooks({ platform, native });
  if (!native) registerServiceWorker();

  const begin = async () => {
    const saved = currentConnection();
    if (saved) {
      await start(root, saved, native);
      return;
    }
    // The iPhone web app published with a clinic's website suggests that clinic;
    // the Android app suggests the clinic of a connect link that opened it. After
    // Change server nothing is suggested: the person is choosing another server.
    const choosing = takeServerChoice();
    const fromLink = native ? await native.takeConnectLink() : "";
    renderConnect(root, {
      prefill: fromLink || (native || choosing ? "" : new URL("./", window.location.href).toString()),
      quietPrefill: !fromLink,
      readClipboard: native?.readClipboard ?? null,
      onConnected: (connection) => start(root, connection, native),
    });
  };
  if (shouldOfferInstall(platform)) renderInstall(root, begin);
  else await begin();
}

async function start(root, connection, native) {
  useServer(connection);
  createSupabase({
    url: connection.serverUrl,
    key: connection.publishableKey,
    storageKey: storageName(connection.serverUrl),
    storage: native?.authStorage,
  });
  await startApp(root, { frame: mountAppFrame, login: appLogin(connection) });
}
