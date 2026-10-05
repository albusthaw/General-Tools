// The frame around every screen: side menu (a drawer on smaller screens), top bar,
// phone tab bar and account menu.
import { iconButton } from "../components/button.js";
import { menuButton } from "../components/menu.js";
import { config } from "../config.js";
import { h, replace } from "../lib/dom.js";
import { clock, initials } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { MODES, modeOf } from "../lib/modes.js";
import { elapsedSeconds, onRecorderChange } from "../lib/recorder/recorder.js";
import { currentRoute, href, navigate, onRouteChange } from "../lib/router.js";
import { isAdmin, profile } from "../lib/store.js";
import { watchTabNames } from "../lib/tab-names.js";
import { openAccountDialog, openPasswordDialog } from "./account.js";
import { VIEWS } from "./registry.js";

const SCRIBE_TABS = [
  { name: "scribe", path: MODES.scribe.path, label: MODES.scribe.name, icon: MODES.scribe.icon },
  { name: "voice", path: MODES.voice.path, label: MODES.voice.name, icon: MODES.voice.icon },
  { name: "templates", path: "/templates", label: "Templates", icon: "template" },
  { name: "history", path: "/history", label: "History", icon: "history" },
];

export const ADMIN_LINKS = [
  { name: "admin-users", path: "/admin/users", label: "User settings", icon: "users" },
  { name: "admin-ai", path: "/admin/ai", label: "AI settings", icon: "sliders" },
  { name: "admin-recordings", path: "/admin/recordings", label: "Recording", icon: "waveform" },
  { name: "admin-review", path: "/admin/review", label: "Review records", icon: "shield" },
  { name: "admin-audit", path: "/admin/audit", label: "Audit log", icon: "scroll" },
  { name: "admin-google", path: "/admin/google", label: "Google sign-in", icon: "globe" },
  { name: "admin-email", path: "/admin/email", label: "Email (SMTP)", icon: "mail" },
];

// For everyone: in the side menu on the website, in More in the apps.
export const APPS_LINK = { name: "apps", path: "/apps", label: "Phone apps", icon: "phone" };

function tabName(route) {
  return route.name === "history-detail" || route.name === "history-voice" ? "history" : route.name;
}

function scribeTabLinks(route) {
  const active = tabName(route);
  return SCRIBE_TABS.map((tab) =>
    h("a", { class: "module-tab", href: href(tab.path), attrs: { "aria-current": tab.name === active ? "page" : null } }, icon(tab.icon), h("span", { text: tab.label }))
  );
}

// Tabs shown at the top of the Clinical Scribe pages on mid-size screens. Phones
// have the bottom tab bar, and wide screens list the same tabs in the side menu.
export function scribeTabs(route) {
  return h("nav", { class: ["module-tabs", "glass-float"], attrs: { "aria-label": "Clinical Scribe" } }, scribeTabLinks(route));
}

export function mountShell(root, { onSignOut }) {
  const me = profile();
  const admin = isAdmin();

  const accountMenu = (placement) =>
    menuButton({
      label: "Account",
      placement,
      align: placement === "up" ? "left" : "right",
      trigger: h(
        "button",
        { type: "button", class: placement === "up" ? "account-button" : "btn icon-only quiet", attrs: { "aria-label": "Account" } },
        h("span", { class: "avatar", text: initials(me.full_name, me.email) }),
        placement === "up"
          ? h("span", { class: "account-text" }, h("span", { class: "account-name", text: me.full_name || me.email }), h("span", { class: "account-role", text: admin ? "Admin" : "User" }))
          : null,
      ),
      items: [
        { label: me.email, info: true },
        { label: "Your details", icon: "user", onClick: openAccountDialog },
        { label: "Change password", icon: "lock", onClick: openPasswordDialog },
        { separator: true },
        { label: "Sign out", icon: "logout", onClick: onSignOut },
      ],
    });

  const navLinks = new Map();
  const navLink = (item) => {
    const link = h("a", { class: "nav-item", href: href(item.path) }, icon(item.icon), h("span", { text: item.label }));
    navLinks.set(item.name, link);
    return link;
  };

  const sidebarPill = h("a", { class: "recording-pill", href: href("/scribe"), hidden: true });
  const topbarPill = h("a", { class: "recording-pill", href: href("/scribe"), hidden: true });

  const sidebar = h(
    "aside",
    { class: "sidebar glass-float", attrs: { id: "sidebar", "aria-label": "Main menu" } },
    h("div", { class: "brand" }, h("span", { class: "brand-mark" }, icon("waveform")), h("span", { class: "brand-name", text: "Clinical Scribe" })),
    sidebarPill,
    h(
      "nav",
      { class: "nav", attrs: { "aria-label": "Sections" } },
      SCRIBE_TABS.map(navLink),
      navLink(APPS_LINK),
      admin ? h("p", { class: "nav-heading", text: "Admin settings" }) : null,
      admin ? ADMIN_LINKS.map(navLink) : null,
    ),
    h("div", { class: "sidebar-foot" }, accountMenu("up"), h("p", { class: "version-line", text: `Version ${config.appVersion}` })),
  );

  const shellEl = h("div", { class: "shell" });
  const closeDrawer = () => {
    shellEl.classList.remove("drawer-open");
    menuToggle.setAttribute("aria-expanded", "false");
  };
  const menuToggle = iconButton("menu", "Open menu", {
    attrs: { "aria-controls": "sidebar", "aria-expanded": "false" },
    onClick: () => {
      const open = !shellEl.classList.contains("drawer-open");
      shellEl.classList.toggle("drawer-open", open);
      menuToggle.setAttribute("aria-expanded", String(open));
      if (open) sidebar.querySelector(".nav-item")?.focus();
    },
  });
  const topTitle = h("span", { class: "topbar-title" });
  const topbar = h("header", { class: "topbar glass-float" }, menuToggle, topTitle, topbarPill, accountMenu("down"));
  const scrim = h("div", { class: "drawer-scrim", onClick: closeDrawer });
  const contentInner = h("div", { class: "content-inner" });
  const main = h("main", { class: "content", attrs: { id: "main", tabindex: "-1" } }, contentInner);
  const tabbar = h("nav", { class: "tabbar glass-float", attrs: { "aria-label": "Clinical Scribe" } });

  const skip = h("a", {
    class: "skip-link",
    href: "#main",
    text: "Skip to content",
    onClick: (event) => {
      event.preventDefault();
      main.focus();
    },
  });
  replace(shellEl, skip, sidebar, scrim, topbar, main, tabbar);
  replace(root, shellEl);

  document.addEventListener("keydown", onKey);
  function onKey(event) {
    if (event.key === "Escape" && shellEl.classList.contains("drawer-open")) {
      closeDrawer();
      menuToggle.focus();
    }
  }

  // Recording reminder on other pages; it leads back to the recording's own tab.
  let pillTimer = null;
  let routeName = "";
  let updatePill = () => {};
  const stopRecorderWatch = onRecorderChange((recorder) => {
    const busy = recorder.phase === "recording" || recorder.phase === "paused";
    const type = modeOf(recorder.mode);
    clearInterval(pillTimer);
    updatePill = () => {
      const show = busy && routeName !== type.route;
      for (const pill of [sidebarPill, topbarPill]) {
        pill.hidden = !show;
        if (!show) continue;
        pill.setAttribute("href", href(type.path));
        pill.setAttribute("aria-label", `${recorder.phase === "paused" ? "Paused" : "Recording"}: go to ${type.name}`);
        replace(pill, h("span", { class: "dot", attrs: { "aria-hidden": "true" } }), h("span", { class: "tabular", text: `${recorder.phase === "paused" ? "Paused" : "Recording"} ${clock(elapsedSeconds())}` }));
      }
    };
    updatePill();
    if (busy) pillTimer = setInterval(updatePill, 1000);
  });
  const tabNames = watchTabNames(tabbar, ".module-tab span");

  let cleanupView = null;
  let renderToken = 0;

  async function show(route) {
    if ((route.admin && !isAdmin()) || route.appOnly) {
      navigate("/scribe");
      return;
    }
    const token = ++renderToken;
    routeName = route.name;
    updatePill();
    closeDrawer();
    try {
      cleanupView?.();
    } catch {
      // A view that fails to clean up must not block navigation.
    }
    cleanupView = null;

    // The side menu lists the four tabs, so the lit item always matches the page.
    const activeNav = route.module === "scribe" ? tabName(route) : route.name;
    for (const [name, link] of navLinks) link.setAttribute("aria-current", name === activeNav ? "page" : "false");
    topTitle.textContent = route.title;
    document.title = `${route.title} · Clinical Scribe`;
    shellEl.classList.toggle("has-tabbar", route.module === "scribe");
    replace(tabbar, route.module === "scribe" ? scribeTabLinks(route) : []);
    tabNames.check();

    replace(contentInner);
    contentInner.style.animation = "none";
    void contentInner.offsetWidth;
    contentInner.style.animation = "";
    const view = VIEWS[route.name];
    const result = await view(contentInner, route);
    if (token !== renderToken) {
      if (typeof result === "function") result();
      return;
    }
    cleanupView = typeof result === "function" ? result : null;
    const heading = contentInner.querySelector("h1");
    if (heading) heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  const stopRoutes = onRouteChange(show);
  show(currentRoute());

  return {
    destroy() {
      stopRoutes();
      stopRecorderWatch();
      tabNames.stop();
      clearInterval(pillTimer);
      document.removeEventListener("keydown", onKey);
      try {
        cleanupView?.();
      } catch {
        // Ignore.
      }
      replace(root);
    },
  };
}
