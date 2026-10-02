import { h } from "../lib/dom.js";
import { icon as drawIcon } from "../lib/icons.js";

/**
 * button("Copy note", { icon: "copy", variant: "primary", onClick })
 * variant: "" | "primary" | "danger" | "quiet" | "quiet danger-text"; size: "" | "small" | "large"
 */
export function button(label, { icon, variant = "", size = "", onClick, type = "button", disabled = false, block = false, attrs = {}, iconAfter = false } = {}) {
  const el = h("button", {
    type,
    class: ["btn", variant, size, block && "block"],
    disabled,
    attrs,
    onClick,
  });
  const glyph = icon ? drawIcon(icon) : null;
  if (glyph && !iconAfter) el.append(glyph);
  el.append(h("span", { text: label }));
  if (glyph && iconAfter) el.append(glyph);
  return el;
}

export function iconButton(iconName, label, { variant = "", size = "", onClick, attrs = {} } = {}) {
  return h(
    "button",
    {
      type: "button",
      class: ["btn", "icon-only", variant || "quiet", size],
      attrs: { "aria-label": label, title: label, ...attrs },
      onClick,
    },
    drawIcon(iconName),
  );
}

// Shows a spinner on the button while the work runs, and blocks double clicks.
export async function withBusy(btn, work) {
  if (btn.classList.contains("busy")) return undefined;
  btn.classList.add("busy");
  btn.setAttribute("aria-busy", "true");
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  try {
    return await work();
  } finally {
    btn.classList.remove("busy");
    btn.removeAttribute("aria-busy");
    btn.disabled = wasDisabled;
  }
}
