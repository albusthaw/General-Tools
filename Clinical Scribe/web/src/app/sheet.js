// In the apps, dialogs become sheets: they rise from the bottom of the screen,
// show a grabber, and close when dragged down (unless they must be answered).
import { h } from "../lib/dom.js";

const CLOSE_DISTANCE = 110;

export function decorateSheet(dialog, close) {
  dialog.classList.add("sheet");
  const grabber = h("div", { class: "sheet-grabber", attrs: { "aria-hidden": "true" } });
  dialog.prepend(grabber);
  const head = dialog.querySelector(".dialog-head");
  // Only sheets that have a close button may be dragged away.
  const dismissible = Boolean(head?.querySelector(".icon-only"));
  if (!dismissible) return;

  let start = null;
  let distance = 0;
  const begin = (event) => {
    if (event.pointerType === "mouse" || event.target.closest("button, a, input, textarea, select")) return;
    start = event.clientY;
    distance = 0;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dialog.classList.add("is-dragging");
  };
  const move = (event) => {
    if (start === null) return;
    distance = Math.max(0, event.clientY - start);
    dialog.style.transform = `translateY(${distance}px)`;
  };
  const end = () => {
    if (start === null) return;
    start = null;
    dialog.classList.remove("is-dragging");
    dialog.style.transform = "";
    if (distance > CLOSE_DISTANCE) close(false);
  };
  for (const target of [grabber, head]) {
    if (!target) continue;
    target.addEventListener("pointerdown", begin);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }
}
