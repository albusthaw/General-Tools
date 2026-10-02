// The recorder in the apps: a one-hand layout with a large Pause/Resume circle
// inside a sound ring that follows the voice, and hints that fit each phone.
import { h } from "../lib/dom.js";
import * as recorder from "../lib/recorder/recorder.js";

const HINTS = {
  android: "Recording carries on when the screen is off.",
  ios: "Keep Clinical Scribe open while recording.",
};

export function recorderExtras(card, { phase, platform }) {
  const hint = card.querySelector(".record-hint");
  const text = HINTS[platform] ?? HINTS.ios;
  if (hint) hint.textContent = text;
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
