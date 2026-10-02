// Swipe a row to the left to show its actions; press and hold it for the same
// actions in a sheet. The row's own page offers them too, so nothing depends on
// gestures alone.
import { h } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";
import { openActions } from "../action-sheet.js";

const ACTION_WIDTH = 84;
const LONG_PRESS_MS = 520;
const MOVE_SLOP = 8;
// After a swipe or a long press the browser may still send a click for the same
// touch, at once. That click is dropped; it never comes later than this.
const LEFTOVER_CLICK_MS = 600;

/**
 * enhanceRows(container, { rows: ".list-row", rowActions(row) → [{ label, icon, danger, onClick }], haptic })
 */
export function enhanceRows(container, { rows, rowActions, haptic }) {
  let touch = null;
  let open = null;
  let leftover = null;

  function closeOpen() {
    if (!open) return;
    open.classList.remove("is-open");
    open.querySelector(".swipe-body").style.transform = "";
    open = null;
  }

  // Wraps a row once, so its actions can sit behind it.
  function wrap(row, actions) {
    const existing = row.parentElement?.classList.contains("swipe-body") ? row.parentElement.parentElement : null;
    if (existing) return existing;
    const buttons = actions.map((action) =>
      h(
        "button",
        {
          type: "button",
          class: ["swipe-action", action.danger && "danger"],
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeOpen();
            action.onClick();
          },
        },
        icon(action.icon),
        h("span", { text: action.label }),
      )
    );
    const body = h("div", { class: "swipe-body" });
    const box = h("div", { class: "swipe-wrap" }, h("div", { class: "swipe-actions" }, buttons), body);
    box.style.setProperty("--actions-width", `${actions.length * ACTION_WIDTH}px`);
    row.replaceWith(box);
    body.append(row);
    return box;
  }

  function longPress(row) {
    const actions = rowActions(row);
    if (!actions.length) return;
    haptic?.("medium");
    const title = row.querySelector(".row-title")?.textContent ?? "";
    const opener = row.getAttribute("href");
    openActions(title, [opener ? { label: "Open", icon: "chevronRight", onClick: () => (window.location.hash = opener.replace(/^#/, "")) } : null, ...actions].filter(Boolean));
  }

  function onStart(event) {
    const row = event.target.closest(rows);
    if (!row || !container.contains(row) || event.touches.length !== 1) return;
    const point = event.touches[0];
    touch = { row, x: point.clientX, y: point.clientY, dx: 0, mode: null, box: null, base: 0, timer: null };
    touch.timer = setTimeout(() => {
      if (touch && !touch.mode) {
        touch.mode = "press";
        longPress(row);
      }
    }, LONG_PRESS_MS);
  }

  function onMove(event) {
    if (!touch) return;
    const point = event.touches[0];
    const dx = point.clientX - touch.x;
    const dy = point.clientY - touch.y;
    if (!touch.mode) {
      if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) return;
      clearTimeout(touch.timer);
      if (Math.abs(dx) <= Math.abs(dy)) {
        touch = null;
        return;
      }
      const actions = rowActions(touch.row);
      if (!actions.length) {
        touch = null;
        return;
      }
      touch.mode = "swipe";
      touch.box = wrap(touch.row, actions);
      if (open && open !== touch.box) closeOpen();
      touch.base = touch.box.classList.contains("is-open") ? -actions.length * ACTION_WIDTH : 0;
      touch.width = actions.length * ACTION_WIDTH;
    }
    if (touch.mode !== "swipe") return;
    touch.dx = Math.min(0, Math.max(-touch.width - 40, touch.base + dx));
    touch.box.querySelector(".swipe-body").style.transform = `translateX(${touch.dx}px)`;
    touch.box.classList.add("is-dragging");
  }

  function onEnd() {
    if (!touch) return;
    clearTimeout(touch.timer);
    if (touch.mode) {
      clearTimeout(leftover);
      leftover = setTimeout(() => (leftover = null), LEFTOVER_CLICK_MS);
    }
    if (touch.mode === "swipe") {
      const box = touch.box;
      box.classList.remove("is-dragging");
      const body = box.querySelector(".swipe-body");
      if (touch.dx < -touch.width / 2) {
        body.style.transform = `translateX(${-touch.width}px)`;
        box.classList.add("is-open");
        if (open !== box) haptic?.("light");
        open = box;
      } else {
        body.style.transform = "";
        box.classList.remove("is-open");
        if (open === box) open = null;
      }
    }
    touch = null;
  }

  // A swipe or a long press must not also open the row, or close the sheet it just
  // opened: the click the browser sends for that same touch is dropped. A new tap
  // starts a new touch, so it always works.
  function onDocumentClick(event) {
    if (!leftover) return;
    clearTimeout(leftover);
    leftover = null;
    event.preventDefault();
    event.stopPropagation();
  }

  function onDocumentTouch(event) {
    clearTimeout(leftover);
    leftover = null;
    if (open && !open.contains(event.target)) closeOpen();
  }

  // A tap on an open row closes it.
  function onClick(event) {
    if (open && open.contains(event.target) && !event.target.closest(".swipe-action")) {
      event.preventDefault();
      event.stopPropagation();
      closeOpen();
    }
  }

  container.addEventListener("touchstart", onStart, { passive: true });
  container.addEventListener("touchmove", onMove, { passive: true });
  container.addEventListener("touchend", onEnd);
  container.addEventListener("touchcancel", onEnd);
  container.addEventListener("click", onClick, true);
  container.addEventListener("contextmenu", (event) => {
    if (event.target.closest(rows)) event.preventDefault();
  });
  document.addEventListener("touchstart", onDocumentTouch, { capture: true, passive: true });
  document.addEventListener("click", onDocumentClick, true);

  return () => {
    clearTimeout(leftover);
    document.removeEventListener("touchstart", onDocumentTouch, { capture: true });
    document.removeEventListener("click", onDocumentClick, true);
  };
}
