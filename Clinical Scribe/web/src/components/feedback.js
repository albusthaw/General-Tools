// Toasts, banners, chips, empty states and loading placeholders.
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { button } from "./button.js";

export function toast(message, kind = "ok", timeout = 3800) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const name = kind === "bad" ? "xCircle" : kind === "info" ? "info" : "checkCircle";
  const el = h("div", { class: ["toast", kind], attrs: { role: kind === "bad" ? "alert" : "status" } }, icon(name), h("span", { text: message }));
  wrap.append(el);
  setTimeout(() => el.remove(), timeout);
}

/** banner({ kind: "info"|"warn"|"bad"|"ok", title, text, action: { label, onClick, variant } }) */
export function banner({ kind = "info", title = "", text = "", action = null, children = null }) {
  const name = kind === "warn" ? "alert" : kind === "bad" ? "xCircle" : kind === "ok" ? "checkCircle" : "info";
  return h(
    "div",
    { class: ["banner", kind], attrs: { role: kind === "bad" || kind === "warn" ? "alert" : "status" } },
    icon(name),
    h("div", { class: "banner-body" }, title ? h("strong", { text: title }) : null, text ? h("p", { text }) : null, children),
    action ? button(action.label, { size: "small", variant: action.variant ?? "", onClick: action.onClick, icon: action.icon }) : null,
  );
}

export function chip(text, color = "", iconName = null) {
  return h("span", { class: ["chip", color] }, iconName ? icon(iconName) : null, h("span", { text }));
}

export function emptyState({ icon: iconName = "info", title, text = "", action = null }) {
  return h(
    "div",
    { class: "empty" },
    h("div", { class: "empty-icon" }, icon(iconName)),
    h("h2", { text: title }),
    text ? h("p", { text }) : null,
    action ? button(action.label, { variant: "primary", icon: action.icon, onClick: action.onClick }) : null,
  );
}

export function loading(text = "Loading…") {
  return h("div", { class: "loading", attrs: { role: "status" } }, h("span", { class: "spinner", attrs: { "aria-hidden": "true" } }), h("span", { text }));
}

export function pageHead(title, actions = []) {
  return h(
    "div",
    { class: "page-head" },
    h("h1", { text: title, attrs: { tabindex: "-1" } }),
    actions.length ? h("div", { class: "head-actions" }, actions) : null,
  );
}
