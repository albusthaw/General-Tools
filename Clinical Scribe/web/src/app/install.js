// In Safari on an iPhone or iPad, before Clinical Scribe is on the Home Screen:
// three steps to add it, or carry on in Safari.
import { button } from "../components/button.js";
import { config } from "../config.js";
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { isStandalone } from "../lib/platform/detect.js";
import { brand } from "../views/login.js";

const KEY = "cs-continue-in-safari";

export function shouldOfferInstall(platform) {
  if (platform !== "ios" || isStandalone(window)) return false;
  try {
    return sessionStorage.getItem(KEY) !== "1";
  } catch {
    return true;
  }
}

function step(number, glyph, text) {
  return h(
    "li",
    { class: "install-step" },
    h("span", { class: "install-number", attrs: { "aria-hidden": "true" }, text: String(number) }),
    h("span", { class: "install-glyph", attrs: { "aria-hidden": "true" } }, glyph),
    h("span", { class: "install-text", text }),
  );
}

export function renderInstall(root, onContinue) {
  const dots = h("span", { class: "install-dots", text: "⋯" });
  replace(
    root,
    h(
      "main",
      { class: "login app-install" },
      h(
        "section",
        { class: "glass-card login-card", attrs: { "aria-labelledby": "install-title" } },
        brand(),
        h("h1", { class: "login-title", attrs: { id: "install-title" }, text: "Add to Home Screen" }),
        h(
          "ol",
          { class: "install-steps" },
          step(1, dots, "Tap ⋯ at the bottom of Safari, then tap Share."),
          step(2, icon("plusSquare"), "Tap Add to Home Screen."),
          step(3, icon("toggle"), "Keep Open as Web App switched on, then tap Add."),
        ),
        button("Continue in Safari", {
          variant: "quiet",
          block: true,
          onClick: () => {
            try {
              sessionStorage.setItem(KEY, "1");
            } catch {
              // The steps simply show again next time.
            }
            onContinue();
          },
        }),
      ),
      h("p", { class: "login-foot", text: `Version ${config.appVersion}` }),
    ),
  );
}
