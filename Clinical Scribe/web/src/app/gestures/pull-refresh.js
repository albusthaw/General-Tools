// Pull down at the very top of a page to reload it. Touch only: every page also
// reloads when it is opened again, so nothing depends on this gesture.
import { h } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";

const TRIGGER = 72;
const MAX = 120;

export function createPullToRefresh({ haptic }) {
  const el = h("div", { class: "ptr", attrs: { "aria-hidden": "true" } }, h("span", { class: "ptr-badge" }, icon("refresh")));
  let handler = null;
  let start = null;
  let pulled = 0;
  let armed = false;
  let busy = false;

  function reset() {
    start = null;
    pulled = 0;
    armed = false;
    el.classList.remove("is-pulling", "is-armed", "is-refreshing");
    el.style.removeProperty("--pull");
  }

  function onStart(event) {
    if (!handler || busy || window.scrollY > 0 || event.touches.length !== 1) return;
    if (event.target.closest("dialog, input, textarea, select, .swipe-wrap.is-open")) return;
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    pulled = 0;
    armed = false;
  }

  function onMove(event) {
    if (!start) return;
    const dy = event.touches[0].clientY - start.y;
    const dx = Math.abs(event.touches[0].clientX - start.x);
    if (pulled === 0 && (dy <= 0 || dx > dy)) {
      start = null;
      return;
    }
    if (window.scrollY > 0) {
      reset();
      return;
    }
    pulled = Math.min(MAX, Math.max(0, dy * 0.5));
    el.style.setProperty("--pull", `${pulled}px`);
    el.classList.add("is-pulling");
    const nowArmed = pulled >= TRIGGER * 0.75;
    if (nowArmed && !armed) haptic?.("light");
    armed = nowArmed;
    el.classList.toggle("is-armed", armed);
  }

  async function onEnd() {
    if (!start) return;
    start = null;
    if (!armed) {
      reset();
      return;
    }
    busy = true;
    el.classList.remove("is-pulling");
    el.classList.add("is-refreshing");
    try {
      await handler();
    } catch {
      // The page shows its own message when loading fails.
    } finally {
      busy = false;
      reset();
    }
  }

  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("touchend", onEnd);
  document.addEventListener("touchcancel", reset);

  return {
    el,
    set(fn) {
      handler = fn ?? null;
      if (!busy) reset();
    },
    destroy() {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
    },
  };
}
