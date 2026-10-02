// Screen off, for recording on an iPhone. An iPhone stops the microphone of a web
// app when the phone locks, so Screen off keeps Clinical Scribe open with a black
// screen instead: the screen gives no light on most iPhones, the phone is kept
// from locking, and touches do nothing until a press and hold. A dim timer shows
// that the recording is running; it moves every minute so it never marks the
// screen. Once motion is allowed, laying the phone face down turns it dark too.
// It ends when the recording pauses or finishes.
import { h } from "../lib/dom.js";
import { clock } from "../lib/format.js";
import { isStandalone } from "../lib/platform/detect.js";
import { elapsedSeconds, onRecorderChange, recorderState } from "../lib/recorder/recorder.js";
import { canStayUnlocked, isFaceDown, timerSpot } from "./screen-off-rules.js";

const HOLD_MS = 1200;
const MOVE_EVERY_MS = 60_000;
const HINT_MS = 5000;
const FACE_DOWN_MS = 800;
const LEFTOVER_CLICK_MS = 800;

let current = null;
let watchingMotion = false;
let faceDownSince = null;

/** True once laying the phone face down turns the screen dark. */
export function faceDownReady() {
  return watchingMotion;
}

function onOrientation(event) {
  if (current || recorderState().phase !== "recording" || document.visibilityState !== "visible") {
    faceDownSince = null;
    return;
  }
  if (!isFaceDown(event.beta, event.gamma)) {
    faceDownSince = null;
    return;
  }
  if (faceDownSince === null) faceDownSince = Date.now();
  if (Date.now() - faceDownSince >= FACE_DOWN_MS) {
    faceDownSince = null;
    enterScreenOff();
  }
}

// The iPhone asks once whether the app may use motion. It must be asked straight
// from a tap, so this runs first in the Screen off button's tap.
function askForMotion() {
  const Orientation = window.DeviceOrientationEvent;
  if (watchingMotion || !Orientation) return;
  const listen = () => {
    if (watchingMotion) return;
    watchingMotion = true;
    window.addEventListener("deviceorientation", onOrientation);
  };
  if (typeof Orientation.requestPermission !== "function") {
    listen();
    return;
  }
  Orientation.requestPermission()
    .then((answer) => {
      if (answer === "granted") listen();
    })
    .catch(() => {});
}

// The finger that held the dark screen is still down when the app shows again;
// lifting it must not press the button underneath.
function dropLeftoverClick() {
  const drop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("click", drop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener("click", drop, { capture: true }), LEFTOVER_CLICK_MS);
}

// Keeps the phone from locking while the screen is dark. Some iPhones cannot (an
// older iOS, or Low Power Mode), so the person is told what to change.
function keepUnlocked(warning) {
  if (!canStayUnlocked(navigator.userAgent, isStandalone(window))) warning.hidden = false;
  const ask = navigator.wakeLock?.request?.("screen");
  if (!ask) {
    warning.hidden = false;
    return null;
  }
  return ask.catch(() => {
    warning.hidden = false;
    return null;
  });
}

export function enterScreenOff() {
  if (current || recorderState().phase !== "recording") return;
  const time = h("span", { class: "screen-off-time tabular" });
  const status = h("div", { class: "screen-off-status" }, h("span", { class: "screen-off-dot", attrs: { "aria-hidden": "true" } }), time);
  const hint = h("p", { class: "screen-off-hint", text: "Press and hold to show Clinical Scribe" });
  const warning = h("p", {
    class: "screen-off-warning",
    hidden: true,
    text: "This iPhone may lock by itself and pause the recording. To stop that, turn off Low Power Mode and set Auto-Lock to Never in Settings.",
  });
  const ring = h("span", { class: "screen-off-hold", attrs: { "aria-hidden": "true" } });
  const el = h(
    "div",
    { class: "screen-off", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Screen off. Press and hold to show Clinical Scribe.", tabindex: "-1" } },
    status,
    hint,
    warning,
    ring,
  );

  const lock = keepUnlocked(warning);
  let holdTimer = null;
  let hintTimer = null;

  const showTime = () => (time.textContent = `Recording ${clock(elapsedSeconds())}`);
  const move = () => {
    const spot = timerSpot(Math.random, window.innerWidth, window.innerHeight, status.offsetWidth || 160, status.offsetHeight || 24);
    status.style.setProperty("--x", `${spot.x}px`);
    status.style.setProperty("--y", `${spot.y}px`);
  };
  const showHint = () => {
    hint.classList.remove("is-faded");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.add("is-faded"), HINT_MS);
  };
  const startHold = (event) => {
    event?.preventDefault?.();
    showHint();
    clearTimeout(holdTimer);
    el.classList.add("is-holding");
    holdTimer = setTimeout(() => {
      exitScreenOff();
      dropLeftoverClick();
    }, HOLD_MS);
  };
  const stopHold = () => {
    clearTimeout(holdTimer);
    el.classList.remove("is-holding");
  };

  el.addEventListener("pointerdown", startHold);
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(type, stopHold);
  el.addEventListener("contextmenu", (event) => event.preventDefault());
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape") exitScreenOff();
    else if ((event.key === "Enter" || event.key === " ") && !event.repeat) startHold(event);
  });
  el.addEventListener("keyup", stopHold);

  const timers = [setInterval(showTime, 1000), setInterval(move, MOVE_EVERY_MS)];
  // A pause by itself (a call, a locked phone) or the end of the recording shows the app again.
  const stopWatch = onRecorderChange((state) => {
    if (state.phase !== "recording") queueMicrotask(exitScreenOff);
  });

  current = {
    el,
    close() {
      timers.forEach(clearInterval);
      clearTimeout(holdTimer);
      clearTimeout(hintTimer);
      stopWatch();
      Promise.resolve(lock).then((sentinel) => sentinel?.release?.().catch?.(() => {}));
      el.remove();
    },
  };
  document.body.append(el);
  showTime();
  move();
  showHint();
  el.focus({ preventScroll: true });
}

export function exitScreenOff() {
  const open = current;
  current = null;
  open?.close();
}

/** Taps on the Screen off button. */
export function screenOffTapped() {
  askForMotion();
  enterScreenOff();
}
