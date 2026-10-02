// On phones, the website's sign-in page offers the phone app: the iPhone web app,
// or the Android app when it is published with the site. Never inside the apps,
// never on computers, and not again once hidden.
import { iconButton } from "../components/button.js";
import { openDialog } from "../components/dialog.js";
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { publishedAndroidApp } from "../lib/connection/published.js";
import { detectPlatform } from "../lib/platform/detect.js";
import { APP_SCHEME } from "../lib/platform/links.js";

const KEY = "cs-get-app-hidden";

function isHidden() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function hide(box) {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // It shows again next time.
  }
  box.remove();
}

function androidSteps() {
  const site = new URL("./", window.location.href).toString();
  openDialog({
    title: "Get the Android app",
    body: [h("p", { text: "Open the downloaded file, then tap Install. If your phone asks, allow installs from your browser." })],
    actions: [
      { label: "Close" },
      {
        label: "Open the app",
        variant: "primary",
        onClick: () => {
          window.location.href = `${APP_SCHEME}://connect?server=${encodeURIComponent(site)}`;
        },
      },
    ],
  });
}

export function getAppOffer() {
  const platform = detectPlatform(window);
  if ((platform !== "ios" && platform !== "android-web") || isHidden()) return null;
  const box = h("aside", { class: "glass-card get-app", attrs: { "aria-label": "Phone app" } });
  const close = iconButton("close", "Hide", { size: "small", onClick: () => hide(box) });

  if (platform === "ios") {
    replace(box, icon("phone"), h("span", { class: "get-app-text", text: "Get the iPhone app" }), h("a", { class: "btn small primary", href: "./app/", text: "Open" }), close);
    return box;
  }

  box.hidden = true;
  publishedAndroidApp(new URL("./", window.location.href).toString())
    .then((app) => {
      if (!app) return;
      const download = h("a", {
        class: "btn small primary",
        href: app.url,
        text: "Download",
        attrs: { download: "" },
        onClick: () => setTimeout(androidSteps, 600),
      });
      replace(box, icon("phone"), h("span", { class: "get-app-text", text: "Get the Android app" }), download, close);
      box.hidden = false;
    })
    .catch(() => {});
  return box;
}
