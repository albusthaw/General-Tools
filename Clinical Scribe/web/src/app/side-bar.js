// On tablets and wide windows the tabs move into a glass side bar, with Phone apps
// and the admin settings listed under them, like tablet apps.
import { config } from "../config.js";
import { h } from "../lib/dom.js";
import { initials } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { href } from "../lib/router.js";
import { isAdmin, profile } from "../lib/store.js";
import { ADMIN_LINKS, APPS_LINK } from "../views/shell.js";
import { TABS, tabOf } from "./tab-bar.js";

export function createSideBar() {
  const me = profile();
  const links = new Map();
  const link = (item) => {
    const el = h("a", { class: "nav-item", href: href(item.path) }, icon(item.icon), h("span", { text: item.label }));
    links.set(item.name, el);
    return el;
  };
  const el = h(
    "aside",
    { class: "app-side glass-float", attrs: { "aria-label": "Main menu" } },
    h("div", { class: "brand" }, h("span", { class: "brand-mark" }, icon("waveform")), h("span", { class: "brand-name", text: "Clinical Scribe" })),
    h(
      "nav",
      { class: "nav", attrs: { "aria-label": "Sections" } },
      TABS.filter((tab) => tab.name !== "more").map(link),
      link(APPS_LINK),
      isAdmin() ? h("p", { class: "nav-heading", text: "Admin settings" }) : null,
      isAdmin() ? ADMIN_LINKS.map(link) : null,
    ),
    h(
      "a",
      { class: "side-account", href: href("/more") },
      h("span", { class: "avatar", text: initials(me?.full_name, me?.email) }),
      h("span", { class: "account-text" }, h("span", { class: "account-name", text: me?.full_name || me?.email || "" }), h("span", { class: "account-role", text: `Version ${config.appVersion}` })),
    ),
  );
  links.set("more", el.querySelector(".side-account"));

  return {
    el,
    update(route) {
      const active = tabOf(route);
      for (const [name, item] of links) item.setAttribute("aria-current", name === active ? "page" : "false");
    },
    destroy() {},
  };
}
