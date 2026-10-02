// The Android floating button: "New recording" on History, or a page's own main
// action (such as "Create template"). It shows its label at rest and shrinks to
// a round button while scrolling down. On iPhone the page action becomes a "+"
// button in the top bar instead (see frame.js).
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { appHooks } from "../lib/platform/hooks.js";
import { navigate } from "../lib/router.js";

export function createFab({ enabled }) {
  const label = h("span", { class: "app-fab-label" });
  const el = h("button", { type: "button", class: "app-fab", hidden: true });
  let action = null;
  el.addEventListener("click", () => {
    appHooks.haptic?.("medium");
    action?.();
  });

  let lastY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 8) return;
    el.classList.toggle("is-small", y > lastY && y > 48);
    lastY = y;
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  function set(next) {
    if (!enabled) next = null;
    action = next?.onClick ?? null;
    el.hidden = !next;
    el.classList.remove("is-small");
    if (!next) return;
    label.textContent = next.label;
    replace(el, icon(next.icon, { size: 24 }), label);
    el.setAttribute("aria-label", next.label);
  }

  return {
    el,
    // Pages without their own action: History offers a new recording.
    update(route) {
      set(route.name === "history" ? { label: "New recording", icon: "mic", onClick: () => navigate("/scribe") } : null);
    },
    set,
    destroy() {
      window.removeEventListener("scroll", onScroll);
    },
  };
}
