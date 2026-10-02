// The top bar of the apps. At rest the page's own heading is the large title;
// once it scrolls under the bar, a small title appears in the glass bar. Pages
// that slide in over a tab get a back button.
import { h, replace } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

export function createAppBar({ onBack, theme }) {
  const backLabel = h("span", { class: "app-back-label" });
  const back = h("button", { type: "button", class: "app-back", hidden: true, onClick: () => onBack() }, icon(theme === "ios" ? "chevronLeft" : "arrowLeft"), backLabel);
  const title = h("span", { class: "app-bar-title", attrs: { "aria-hidden": "true" } });
  const actions = h("div", { class: "app-bar-actions" });
  const el = h("header", { class: "app-bar" }, h("div", { class: "app-bar-inner" }, back, title, actions));

  let headingObserver = null;
  let pageObserver = null;
  let heading = null;

  function watchHeading(next) {
    headingObserver?.disconnect();
    heading = next;
    if (!heading) {
      el.classList.add("is-compact");
      return;
    }
    title.textContent = heading.textContent;
    const offset = Math.round(el.getBoundingClientRect().height) || 56;
    headingObserver = new IntersectionObserver(([entry]) => el.classList.toggle("is-compact", !entry.isIntersecting), {
      rootMargin: `-${offset}px 0px 0px 0px`,
      threshold: 0,
    });
    headingObserver.observe(heading);
  }

  return {
    el,
    actions,
    update({ title: text, parent }) {
      title.textContent = text;
      back.hidden = !parent;
      backLabel.textContent = parent?.label ?? "";
      if (parent) back.setAttribute("aria-label", `Back to ${parent.label}`);
      el.classList.remove("is-compact");
      el.classList.toggle("has-back", Boolean(parent));
      replace(actions);
    },
    // Follows the page's heading, also when the page redraws it.
    watch(content) {
      pageObserver?.disconnect();
      const find = () => content.querySelector(".page-head h1") ?? content.querySelector("h1");
      watchHeading(find());
      pageObserver = new MutationObserver(() => {
        const next = find();
        if (next !== heading) watchHeading(next);
        else if (next) title.textContent = next.textContent;
      });
      pageObserver.observe(content, { childList: true, subtree: true });
    },
    destroy() {
      headingObserver?.disconnect();
      pageObserver?.disconnect();
    },
  };
}
