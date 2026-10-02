// The tab bar of the apps: Scribe, Templates, History and More. On iPhone it is a
// floating glass capsule that shrinks while scrolling down and grows again when
// scrolling up; the selected tab sits in a glass "lens" that slides between tabs.
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { appHooks } from "../lib/platform/hooks.js";
import { href } from "../lib/router.js";

export const TABS = [
  { name: "scribe", path: "/scribe", label: "Scribe", icon: "mic" },
  { name: "templates", path: "/templates", label: "Templates", icon: "template" },
  { name: "history", path: "/history", label: "History", icon: "history" },
  { name: "more", path: "/more", label: "More", icon: "account" },
];

/** The tab a page belongs to. */
export function tabOf(route) {
  if (route.name === "history-detail") return "history";
  if (route.admin || route.name === "more") return "more";
  return route.name;
}

export function createTabBar() {
  const lens = h("span", { class: "app-tab-lens", attrs: { "aria-hidden": "true" } });
  const links = TABS.map((tab) =>
    h(
      "a",
      { class: "app-tab", href: href(tab.path), dataset: { tab: tab.name }, onClick: () => appHooks.haptic?.("selection") },
      h("span", { class: "app-tab-icon" }, icon(tab.icon, { size: 24 })),
      h("span", { class: "app-tab-label", text: tab.label }),
    )
  );
  const inner = h("div", { class: "app-tabs-inner" }, lens, links);
  const el = h("nav", { class: "app-tabs", attrs: { "aria-label": "Sections" } }, inner);

  function placeLens() {
    const active = links.find((link) => link.getAttribute("aria-current") === "page");
    if (!active) {
      lens.style.opacity = "0";
      return;
    }
    lens.style.opacity = "";
    lens.style.setProperty("--lens-x", `${active.offsetLeft}px`);
    lens.style.setProperty("--lens-w", `${active.offsetWidth}px`);
  }

  let lastY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 8) return;
    el.classList.toggle("is-min", y > lastY && y > 96);
    lastY = y;
  };
  const onResize = () => requestAnimationFrame(placeLens);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  el.addEventListener("transitionend", onResize);

  return {
    el,
    update(active) {
      for (const link of links) link.setAttribute("aria-current", link.dataset.tab === active ? "page" : "false");
      el.classList.remove("is-min");
      requestAnimationFrame(placeLens);
    },
    destroy() {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    },
  };
}
