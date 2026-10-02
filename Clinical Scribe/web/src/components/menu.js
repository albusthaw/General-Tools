// A button that opens a small list of actions.
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

let openMenu = null;

function closeOpen() {
  if (openMenu) {
    openMenu.close();
    openMenu = null;
  }
}

/** Closes an open menu; true when one was open (used by the Android back gesture). */
export function closeOpenMenu() {
  if (!openMenu) return false;
  closeOpen();
  return true;
}

document.addEventListener("click", (event) => {
  if (openMenu && !openMenu.anchor.contains(event.target)) closeOpen();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openMenu) {
    const trigger = openMenu.trigger;
    closeOpen();
    trigger.focus();
  }
});

/**
 * menuButton({ label, items: [{ label, icon, onClick, danger }], trigger, placement: "down"|"up", align: "right"|"left" })
 * `trigger` replaces the default "more" icon button.
 */
export function menuButton({ label = "More actions", items, trigger = null, placement = "down", align = "right" }) {
  const button = trigger ?? h(
    "button",
    { type: "button", class: "btn icon-only quiet small", attrs: { "aria-label": label, title: label } },
    icon("more"),
  );
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const anchor = h("div", { class: "menu-anchor" }, button);

  function close() {
    anchor.querySelector(".menu")?.remove();
    button.setAttribute("aria-expanded", "false");
  }

  function open() {
    closeOpen();
    const visible = items.filter((item) => item && !item.hidden);
    const menu = h(
      "div",
      { class: ["menu", placement === "up" && "up", align === "left" && "left"], attrs: { role: "menu" } },
      visible.map((item) => {
        if (item.separator) return h("div", { class: "menu-sep", attrs: { role: "separator" } });
        if (item.label && item.info) return h("div", { class: "menu-label", text: item.label });
        return h(
          "button",
          {
            type: "button",
            class: ["menu-item", item.danger && "danger"],
            attrs: { role: "menuitem" },
            onClick: () => {
              closeOpen();
              item.onClick?.();
            },
          },
          item.icon ? icon(item.icon) : null,
          h("span", { text: item.label }),
        );
      }),
    );
    anchor.append(menu);
    button.setAttribute("aria-expanded", "true");
    openMenu = { anchor, close, trigger: button };
    menu.querySelector(".menu-item")?.focus();
    menu.addEventListener("keydown", (event) => {
      const entries = [...menu.querySelectorAll(".menu-item")];
      const index = entries.indexOf(document.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        entries[(index + 1) % entries.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        entries[(index - 1 + entries.length) % entries.length]?.focus();
      }
    });
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (button.getAttribute("aria-expanded") === "true") closeOpen();
    else open();
  });
  return anchor;
}
