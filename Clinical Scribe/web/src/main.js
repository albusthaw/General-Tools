// Start-up: connect, restore the session, then show sign-in or the app. The app
// build (Android app and iPhone web app) starts in app/start.js instead.
import "@fontsource-variable/source-sans-3/index.css";
import "@fontsource-variable/source-serif-4/index.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/login.css";
import "./styles/scribe.css";
import "./styles/modes.css";
import "./styles/admin.css";

import { isConfigured } from "./config.js";
import { startApp } from "./views/app.js";
import { renderNotConnected } from "./views/blocked.js";

const root = document.getElementById("app");

// The app never runs inside another site's frame.
if (window.top !== window.self) {
  root.textContent = "";
} else if (import.meta.env.MODE === "app") {
  // The Android app and the iPhone web app: connect to a server first. (Checked at
  // build time, so the website's files never contain the apps' code.)
  import("./app/start.js").then(({ startMobileApp }) => startMobileApp(root));
} else if (!isConfigured) {
  renderNotConnected(root);
} else {
  startApp(root);
}
