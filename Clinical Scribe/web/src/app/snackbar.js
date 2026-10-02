// A short message with an optional action, shown above the tab bar in the apps.
import { button } from "../components/button.js";
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

export function snackbar(message, { kind = "info", action = null, timeout = 8000 } = {}) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return null;
  const name = kind === "bad" ? "xCircle" : kind === "ok" ? "checkCircle" : "info";
  const el = h(
    "div",
    { class: ["toast", "snackbar", kind], attrs: { role: kind === "bad" ? "alert" : "status" } },
    icon(name),
    h("span", { text: message }),
    action
      ? button(action.label, {
        size: "small",
        variant: "quiet",
        onClick: () => {
          el.remove();
          action.onClick();
        },
      })
      : null,
  );
  wrap.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}
