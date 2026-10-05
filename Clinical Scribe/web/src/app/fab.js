// The Android floating button: on History a new recording of the tab's type ("New
// recording" or "New voice note"), or a page's own main action (such as "Create
// template"). It shows its label at rest and shrinks to a round button while
// scrolling down. On iPhone the page action becomes a "+" button in the top bar
// instead (see frame.js).
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { MODE_LIST } from "../lib/modes.js";
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
    // Pages without their own action: each History tab offers a new recording of its type.
    update(route) {
      const type = MODE_LIST.find((mode) => mode.historyRoute === route.name);
      set(type ? { label: type.newTitle, icon: type.icon, onClick: () => navigate(type.path) } : null);
    },
    set,
    destroy() {
      window.removeEventListener("scroll", onScroll);
    },
  };
}
