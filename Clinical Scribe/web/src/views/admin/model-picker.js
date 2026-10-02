// Model choice: a live list from the AI service, plus "Other model" for typing a
// name that is not listed yet.
import { selectField, textField } from "../../components/fields.js";
import { listModels } from "../../lib/api/admin.js";
import { h } from "../../lib/dom.js";

const OTHER = "__other__";
const RECOMMENDED = new Set(["scribe_v2_medical", "gemini-3.5-transcribe", "gemini-3.8-flash", "deepseek-flash"]);

export function modelPicker(label, { provider, purpose, value }) {
  const select = selectField(label, [{ value, label: value }], { value });
  const other = textField("Model name", { value: "", autocomplete: "off", attrs: { spellcheck: "false" } });
  other.el.hidden = true;
  const note = h("p", { class: "field-hint", text: "Loading the list of models…" });
  const el = h("div", { class: "model-picker" }, select.el, other.el, note);

  select.input.addEventListener("change", () => {
    other.el.hidden = select.value() !== OTHER;
    if (!other.el.hidden) other.input.focus();
  });

  let loadedFor = null;
  async function load(nextProvider = provider) {
    provider = nextProvider;
    const keep = select.value() === OTHER ? other.value() || value : select.value() || value;
    loadedFor = provider;
    note.textContent = "Loading the list of models…";
    try {
      const result = await listModels(provider, purpose);
      if (loadedFor !== provider) return;
      const models = result?.models ?? [];
      const options = models.map((m) => ({ value: m.id, label: RECOMMENDED.has(m.id) ? `${m.label} (recommended)` : m.label }));
      if (keep && !options.some((o) => o.value === keep)) options.unshift({ value: keep, label: keep });
      options.push({ value: OTHER, label: "Other model…" });
      select.setOptions(options, keep);
      note.textContent = result?.needs_key ? "Save the service key to see every available model." : "";
    } catch (error) {
      const options = keep ? [{ value: keep, label: keep }] : [];
      options.push({ value: OTHER, label: "Other model…" });
      select.setOptions(options, keep);
      note.textContent = error?.message ? `The list could not be loaded: ${error.message}` : "The list could not be loaded.";
    }
    other.el.hidden = select.value() !== OTHER;
  }

  return {
    el,
    load,
    value() {
      return select.value() === OTHER ? other.value() : select.value();
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
}
