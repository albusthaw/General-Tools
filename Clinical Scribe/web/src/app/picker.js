// In the apps, a long list choice (such as the note template) opens a sheet with
// a search field instead of the small drop-down list. The original select stays
// in the form and receives the choice.
import { openDialog } from "../components/dialog.js";
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

const SEARCH_FROM = 7;

function optionsOf(select) {
  const groups = [];
  for (const child of select.children) {
    if (child.tagName === "OPTGROUP") {
      groups.push({ label: child.label, options: [...child.children].map((o) => ({ value: o.value, label: o.textContent })) });
    } else {
      groups.push({ label: "", options: [{ value: child.value, label: child.textContent }] });
    }
  }
  return groups;
}

function selectedLabel(select) {
  return select.selectedOptions?.[0]?.textContent ?? "";
}

export function enhancePicker(select, { title }) {
  if (!select || select.dataset.appPicker) return;
  select.dataset.appPicker = "1";
  const field = select.closest(".field");
  const value = h("span", { class: "picker-value" });
  const row = h("button", { type: "button", class: "picker-row", attrs: { id: `${select.id}-picker` } }, value, icon("chevronRight"));
  const refresh = () => {
    value.textContent = selectedLabel(select);
    row.setAttribute("aria-label", `${title}: ${value.textContent}`);
  };
  refresh();
  select.classList.add("picker-hidden");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.after(row);
  field?.querySelector(".field-label")?.setAttribute("for", row.id);
  select.addEventListener("change", refresh);
  row.addEventListener("click", () => open());

  function open() {
    const groups = optionsOf(select);
    const total = groups.reduce((sum, group) => sum + group.options.length, 0);
    const search = total >= SEARCH_FROM ? h("input", { class: "input search-input", type: "search", placeholder: "Search", attrs: { "aria-label": `Search ${title.toLowerCase()}`, autocomplete: "off" } }) : null;
    const list = h("div", { class: "picker-list", attrs: { role: "listbox", "aria-label": title } });
    let view = null;
    const draw = () => {
      const term = (search?.value ?? "").trim().toLowerCase();
      list.replaceChildren(
        ...groups.flatMap((group) => {
          const matches = group.options.filter((option) => !term || option.label.toLowerCase().includes(term));
          if (!matches.length) return [];
          return [
            group.label ? h("p", { class: "picker-group", text: group.label }) : null,
            ...matches.map((option) =>
              h(
                "button",
                {
                  type: "button",
                  class: "picker-option",
                  attrs: { role: "option", "aria-selected": String(option.value === select.value) },
                  onClick: () => {
                    select.value = option.value;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                    view?.close(true);
                    row.focus();
                  },
                },
                h("span", { text: option.label }),
                option.value === select.value ? icon("check") : null,
              )
            ),
          ].filter(Boolean);
        }),
      );
      if (!list.children.length) list.append(h("p", { class: "muted", text: "Nothing matches." }));
    };
    search?.addEventListener("input", draw);
    draw();
    view = openDialog({ title, body: [search ? h("label", { class: "search-box" }, icon("search"), search) : null, list] });
    if (search) view.dialog.classList.add("is-tall");
    (list.querySelector('[aria-selected="true"]') ?? list.querySelector(".picker-option"))?.focus();
  }
}
