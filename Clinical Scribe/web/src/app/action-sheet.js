// A short list of actions in a sheet: the long-press menu of a row.
import { openDialog } from "../components/dialog.js";
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

/** actions: [{ label, icon, danger, onClick }] */
export function openActions(title, actions) {
  let view = null;
  const list = h(
    "div",
    { class: "action-list", attrs: { role: "menu", "aria-label": title } },
    actions.map((action) =>
      h(
        "button",
        {
          type: "button",
          class: ["action-item", action.danger && "danger"],
          attrs: { role: "menuitem" },
          onClick: () => {
            view?.close(true);
            action.onClick?.();
          },
        },
        action.icon ? icon(action.icon) : null,
        h("span", { text: action.label }),
      )
    ),
  );
  view = openDialog({ title, body: [list], actions: [{ label: "Cancel", variant: "quiet", result: false }] });
  list.querySelector(".action-item")?.focus();
  return view;
}
