// The recorder in the apps: a one-hand layout with a large Pause/Resume circle
// inside a sound ring that follows the voice, and hints that fit each phone. The
// Android app records with the screen off by itself; on an iPhone, Screen off
// keeps recording with a dark screen.
import { button } from "../components/button.js";
import { h } from "../lib/dom.js";
import * as recorder from "../lib/recorder/recorder.js";
import { faceDownReady, screenOffTapped } from "./screen-off.js";

function hintFor(platform) {
  if (platform === "android") return "Recording carries on when the screen is off.";
  if (faceDownReady()) return "Use Screen off, or lay the phone face down, to keep recording with a dark screen.";
  return "Use Screen off to keep recording with a dark screen.";
}

export function recorderExtras(card, { phase, platform }) {
  const hint = card.querySelector(".record-hint");
  if (hint) hint.textContent = hintFor(platform);
  if (phase === "ready") {
    card.classList.add("app-ready");
    return null;
  }

  card.classList.add("app-live");
  const controls = card.querySelector(".live-controls");
  const pause = controls?.querySelector(".btn:not(.primary)");
  if (!controls || !pause) return null;
  const ring = h("span", { class: "sound-ring", attrs: { "aria-hidden": "true" } });
  const caption = h("span", { class: "pause-caption", attrs: { "aria-hidden": "true" }, text: pause.textContent.trim() });
  const holder = h("div", { class: "pause-holder" }, ring);
  pause.replaceWith(holder);
  holder.append(pause, caption);
  pause.classList.add("pause-circle");
  pause.setAttribute("aria-label", pause.textContent.trim());

  if (platform !== "android" && phase === "recording") {
    const dark = button("Screen off", { icon: "moon", variant: "quiet", onClick: screenOffTapped });
    dark.classList.add("screen-off-button");
    card.querySelector(".live-secondary")?.prepend(dark);
  }

  let frame = 0;
  let last = 0;
  const draw = (now) => {
    frame = requestAnimationFrame(draw);
    if (now - last < 50) return;
    last = now;
    ring.style.setProperty("--level", recorder.level().toFixed(3));
  };
  if (phase === "recording") frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}
