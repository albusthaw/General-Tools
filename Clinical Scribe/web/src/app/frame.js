// The app frame around every screen: the top bar with large titles, the tab bar
// (a side bar on wide screens), the mini recorder, the offline bar and, on Android,
// the floating button and the back gesture. The screens inside are the website's.
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { appHooks } from "../lib/platform/hooks.js";
import { currentRoute, navigate, onRouteChange } from "../lib/router.js";
import { isAdmin } from "../lib/store.js";
import { VIEWS } from "../views/registry.js";
import { createAppBar } from "./app-bar.js";
import { setPageBack } from "./back.js";
import { createFab } from "./fab.js";
import { enhanceRows } from "./gestures/swipe-rows.js";
import { createPullToRefresh } from "./gestures/pull-refresh.js";
import { createMiniRecorder } from "./mini-recorder.js";
import { renderMore } from "./more.js";
import { createOfflineBar } from "./offline.js";
import { setPageState } from "./page-state.js";
import { createSideBar } from "./side-bar.js";
import { createTabBar, tabOf } from "./tab-bar.js";
import { checkAppVersion } from "./update.js";

const APP_VIEWS = { ...VIEWS, more: renderMore };

/** Pages that slide in over a tab, and where their back button leads. */
export function parentOf(route) {
  if (route.name === "history-detail") return { path: "/history", label: "History" };
  if (route.admin || route.fromMore) return { path: "/more", label: "More" };
  return null;
}

export function mountAppFrame(root) {
  const theme = document.documentElement.dataset.theme;
  const content = h("div", { class: "content-inner" });
  const main = h("main", { class: "app-content", attrs: { id: "main", tabindex: "-1" } }, content);
  const frame = h("div", { class: "app-frame" });
  const bar = createAppBar({ onBack: goBack, theme });
  const tabs = createTabBar();
  const side = createSideBar();
  const offline = createOfflineBar();
  const fab = createFab({ enabled: theme === "android" });
  const mini = createMiniRecorder({ onVisibleChange: (shown) => frame.classList.toggle("has-mini", shown) });
  const pull = createPullToRefresh({ haptic: (kind) => appHooks.haptic?.(kind) });
  const skip = h("a", {
    class: "skip-link",
    href: "#main",
    text: "Skip to content",
    onClick: (event) => {
      event.preventDefault();
      main.focus();
    },
  });
  replace(frame, skip, side.el, bar.el, offline.el, pull.el, main, mini.el, fab.el, tabs.el);
  replace(root, frame);

  let route = null;
  let previousPath = null;
  // Set by a page that learns where it belongs after loading (see setParent).
  let parentPath = null;
  let cleanupView = null;
  let cleanupRows = [];
  let token = 0;

  function goBack() {
    const parent = route ? parentOf(route) : null;
    if (!parent) return false;
    const path = parentPath ?? parent.path;
    if (previousPath === path) window.history.back();
    else navigate(path);
    return true;
  }

  // What the open page can ask of the frame (through the app hooks).
  function pageControls() {
    return {
      enhanceList(element, { onRefresh, rows, rowActions } = {}) {
        if (onRefresh) pull.set(onRefresh);
        if (rows && rowActions) cleanupRows.push(enhanceRows(element, { rows, rowActions, haptic: (kind) => appHooks.haptic?.(kind) }));
      },
      // The page's main action: a "+" button in the top bar on iPhone, the
      // floating button on Android. The page's own button is then hidden.
      // Where the back button leads, when the page knows better than its
      // address: a Voice Note record goes back to the Voice Note tab of History.
      setParent(path) {
        if (route && parentOf(route)) parentPath = path;
      },
      setAction(button) {
        const label = button.textContent.trim();
        button.classList.add("moved-to-app-bar");
        if (theme === "ios") {
          bar.actions.append(h("button", { type: "button", class: "app-bar-button", attrs: { "aria-label": label, title: label }, onClick: () => button.click() }, icon("plus", { size: 22 })));
        } else {
          fab.set({ label, icon: "plus", onClick: () => button.click() });
        }
      },
    };
  }

  function clearPage() {
    try {
      cleanupView?.();
    } catch {
      // A page that fails to clean up must not block navigation.
    }
    cleanupView = null;
    for (const stop of cleanupRows) stop?.();
    cleanupRows = [];
    pull.set(null);
  }

  async function show(next) {
    if (next.admin && !isAdmin()) {
      navigate("/more");
      return;
    }
    previousPath = route?.path ?? null;
    route = next;
    parentPath = null;
    const mine = ++token;
    clearPage();
    const parent = parentOf(next);
    bar.update({ title: next.title, parent });
    tabs.update(tabOf(next));
    side.update(next);
    mini.update(next);
    fab.update(next);
    setPageState(pageControls());
    frame.dataset.route = next.name;
    document.title = `${next.title} · Clinical Scribe`;

    replace(content);
    content.className = `content-inner page-in ${parent ? "from-right" : "fade-in"}`;
    const result = await APP_VIEWS[next.name](content, next);
    if (mine !== token) {
      if (typeof result === "function") result();
      return;
    }
    cleanupView = typeof result === "function" ? result : null;
    bar.watch(content);
    window.scrollTo({ top: 0 });
    content.querySelector("h1")?.focus({ preventScroll: true });
  }

  const stopRoutes = onRouteChange(show);
  const stopBack = setPageBack(goBack);
  show(currentRoute());
  checkAppVersion();

  return {
    destroy() {
      stopRoutes();
      stopBack();
      clearPage();
      setPageState(null);
      for (const part of [bar, tabs, side, offline, fab, mini, pull]) part.destroy();
      replace(root);
    },
  };
}
