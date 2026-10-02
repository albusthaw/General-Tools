// Model choice: the saved list for the service (kept current with "Update model
// lists"), plus "Other model…" for typing a name that is not listed.
import { selectField, textField } from "../../components/fields.js";
import { h } from "../../lib/dom.js";

const OTHER = "__other__";

function optionLabel(model) {
  if (model.recommended) return `${model.label} (recommended)`;
  if (model.available === false) return `${model.label} (not offered to your account)`;
  return model.label;
}

export function modelPicker(label, { value, models = [] }) {
  const select = selectField(label, [], { value });
  const other = textField("Model name", { value: "", autocomplete: "off", attrs: { spellcheck: "false" } });
  other.el.hidden = true;
  const note = h("p", { class: "field-hint model-note" });
  const el = h("div", { class: "model-picker" }, select.el, other.el, note);
  let list = models;

  function describe() {
    const chosen = list.find((model) => model.id === select.value());
    if (chosen) note.textContent = [chosen.note, chosen.id].filter(Boolean).join(" · ");
    else if (select.value() === OTHER) note.textContent = "Type the model name exactly as the service writes it.";
    else note.textContent = "This model is not in the current list. Update the lists, or test it before use.";
  }

  function render(keep) {
    const options = list.map((model) => ({ value: model.id, label: optionLabel(model) }));
    if (keep && keep !== OTHER && !options.some((option) => option.value === keep)) {
      options.unshift({ value: keep, label: `${keep} (not in the list)` });
    }
    options.push({ value: OTHER, label: "Other model…" });
    select.setOptions(options, keep);
    other.el.hidden = select.value() !== OTHER;
    describe();
  }

  select.input.addEventListener("change", () => {
    other.el.hidden = select.value() !== OTHER;
    if (!other.el.hidden) other.input.focus();
    describe();
  });
  render(value);

  const picker = {
    el,
    value() {
      return select.value() === OTHER ? other.value() : select.value();
    },
    setModels(next) {
      const keep = select.value() === OTHER ? other.value() || OTHER : select.value();
      list = Array.isArray(next) ? next : [];
      render(keep);
    },
    validate() {
      other.setError("");
      if (select.value() === OTHER && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,79}$/.test(other.value())) {
        other.setError("Enter a model name, for example gemini-3.8-flash.");
        return false;
      }
      return true;
    },
  };
  return picker;
}
