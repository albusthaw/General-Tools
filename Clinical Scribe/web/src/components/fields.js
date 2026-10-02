// Form fields with labels, hints and inline errors.
import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

let counter = 0;
const nextId = (prefix) => `${prefix}-${++counter}`;

// `control` is the input that gets the label; `shown` is what is placed on the page
// (the input itself, or a box around it).
function wrap(label, control, { hint, id, className = "", shown = control }) {
  const hintId = hint ? `${id}-hint` : null;
  const errorEl = h("p", { class: "field-error", attrs: { id: `${id}-error`, role: "alert" }, hidden: true });
  if (hintId) control.setAttribute("aria-describedby", hintId);
  const el = h(
    "div",
    { class: ["field", className] },
    h("label", { class: "field-label", attrs: { for: id }, text: label }),
    shown,
    hint ? h("p", { class: "field-hint", attrs: { id: hintId }, text: hint }) : null,
    errorEl,
  );
  return {
    el,
    setError(message) {
      errorEl.textContent = message ?? "";
      errorEl.hidden = !message;
      control.setAttribute("aria-invalid", message ? "true" : "false");
      if (message) control.setAttribute("aria-errormessage", `${id}-error`);
      else control.removeAttribute("aria-errormessage");
    },
  };
}

export function textField(label, { value = "", type = "text", placeholder = "", hint, autocomplete, required = false, maxLength, inputMode, className, attrs = {} } = {}) {
  const id = nextId("f");
  const input = h("input", {
    class: "input",
    id,
    type,
    value,
    placeholder,
    required,
    attrs: { autocomplete, maxlength: maxLength, inputmode: inputMode, ...attrs },
  });
  const field = wrap(label, input, { hint, id, className });
  return { ...field, input, value: () => input.value.trim() };
}

export function passwordField(label, { autocomplete = "current-password", hint, placeholder = "", className } = {}) {
  const id = nextId("p");
  const input = h("input", { class: "input", id, type: "password", placeholder, attrs: { autocomplete, spellcheck: "false" } });
  const toggle = h(
    "button",
    {
      type: "button",
      class: "btn icon-only quiet small reveal",
      attrs: { "aria-label": "Show password", "aria-pressed": "false" },
      onClick: () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.setAttribute("aria-pressed", String(show));
        toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
        toggle.replaceChildren(icon(show ? "eyeOff" : "eye"));
      },
    },
    icon("eye"),
  );
  const box = h("div", { class: "input-wrap" }, input, toggle);
  const field = wrap(label, input, { hint, id, className, shown: box });
  return { ...field, input, value: () => input.value };
}

export function textArea(label, { value = "", placeholder = "", hint, rows = 5, tall = false, maxLength, className } = {}) {
  const id = nextId("t");
  const input = h("textarea", {
    class: ["textarea", tall && "tall"],
    id,
    placeholder,
    rows,
    attrs: { maxlength: maxLength, spellcheck: "true" },
  });
  input.value = value;
  const field = wrap(label, input, { hint, id, className });
  return { ...field, input, value: () => input.value.trim() };
}

// Options may be grouped: [{ group: "Shared", options: [{ value, label }] }].
function optionNodes(options) {
  return options.map((option) =>
    option.options
      ? h("optgroup", { label: option.group }, option.options.map((inner) => h("option", { value: inner.value, text: inner.label })))
      : h("option", { value: option.value, text: option.label })
  );
}

function flatValues(options) {
  return options.flatMap((option) => (option.options ? option.options.map((inner) => inner.value) : [option.value]));
}

/** options: [{ value, label }] or groups (see optionNodes) */
export function selectField(label, options, { value = "", hint, className, onChange } = {}) {
  const id = nextId("s");
  const input = h("select", { class: "select", id, onChange }, optionNodes(options));
  input.value = value;
  const field = wrap(label, input, { hint, id, className });
  return {
    ...field,
    input,
    value: () => input.value,
    setOptions(next, keep = input.value) {
      input.replaceChildren(...optionNodes(next));
      const values = flatValues(next);
      input.value = values.includes(keep) ? keep : values[0] ?? "";
    },
  };
}

export function checkbox(label, { checked = false, onChange } = {}) {
  const input = h("input", { type: "checkbox", checked, onChange });
  const el = h("label", { class: "check" }, input, h("span", { text: label }));
  return { el, input, value: () => input.checked };
}

export function switchRow(title, { description = "", checked = false, onChange } = {}) {
  const id = nextId("w");
  const input = h("input", { type: "checkbox", id, checked, attrs: { role: "switch" }, onChange });
  const el = h(
    "div",
    { class: "switch-row" },
    h("label", { class: "switch-text", attrs: { for: id } }, h("strong", { text: title }), description ? h("span", { class: "field-hint", text: description }) : null),
    h("span", { class: "switch" }, input, h("span")),
  );
  return { el, input, value: () => input.checked };
}

/** options: [{ value, label }] */
export function segmented(label, options, { value, onChange } = {}) {
  let current = value ?? options[0]?.value;
  const buttons = options.map((option) =>
    h("button", {
      type: "button",
      text: option.label,
      attrs: { "aria-pressed": String(option.value === current) },
      onClick: () => {
        if (current === option.value) return;
        current = option.value;
        for (const btn of buttons) btn.setAttribute("aria-pressed", String(btn === buttonFor(current)));
        onChange?.(current);
      },
    })
  );
  const buttonFor = (v) => buttons[options.findIndex((option) => option.value === v)];
  const group = h("div", { class: "segmented", attrs: { role: "group", "aria-label": label } }, buttons);
  return {
    el: group,
    value: () => current,
    set(v) {
      current = v;
      for (const btn of buttons) btn.setAttribute("aria-pressed", String(btn === buttonFor(v)));
    },
  };
}

export function fieldGroup(label, control, hint) {
  return h(
    "div",
    { class: "field" },
    h("span", { class: "field-label", text: label }),
    control,
    hint ? h("p", { class: "field-hint", text: hint }) : null,
  );
}
