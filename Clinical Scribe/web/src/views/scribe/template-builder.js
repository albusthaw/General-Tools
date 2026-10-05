// Template builder: choose the Template Type, describe the note, let the template
// helper draft it, review, ask for changes or edit, then save. Used for personal
// templates and, by admins, for shared templates. With scope "ask" (admins on the
// Templates tab), the admin chooses who can use the new template; everyone is
// chosen first. The Template Type is chosen once and stays with the template.
import { button, withBusy } from "../../components/button.js";
import { modeChip } from "../../components/cards.js";
import { openDialog } from "../../components/dialog.js";
import { toast } from "../../components/feedback.js";
import { fieldGroup, segmented, textArea, textField } from "../../components/fields.js";
import { draftTemplate, reviseTemplate, saveTemplate } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";
import { MODE_LIST, modeOf } from "../../lib/modes.js";

export function openTemplateBuilder({ scope = "personal", existing = null, mode = "scribe", onSaved } = {}) {
  const content = h("div", { class: "builder" });
  const dialog = openDialog({
    title: existing ? "Edit template" : scope === "shared" ? "Create shared template" : "Create template",
    body: [content],
    wide: true,
  });
  let chosenScope = scope === "ask" ? "shared" : scope;
  let chosenMode = modeOf(existing ? existing.mode : mode).id;

  // Template Type: chosen while describing a new template; after that it is shown
  // as it is, because the draft was written for it.
  const typeChoice = (editable) => {
    if (!editable) {
      return fieldGroup("Template Type", h("div", { class: "type-fixed" }, modeChip(chosenMode)), existing ? "The Template Type stays as it was made." : null);
    }
    const hint = h("p", { class: "field-hint", text: modeOf(chosenMode).line });
    const control = segmented("Template Type", MODE_LIST.map((m) => ({ value: m.id, label: m.name })), {
      value: chosenMode,
      onChange: (value) => {
        chosenMode = value;
        hint.textContent = modeOf(value).line;
        content.querySelector("textarea")?.setAttribute("placeholder", modeOf(value).example);
      },
    });
    return h("div", { class: "field" }, h("span", { class: "field-label", text: "Template Type" }), control.el, hint);
  };

  // Only when creating, and only for admins on the Templates tab.
  const scopeChoice = () => {
    if (existing || scope !== "ask") return null;
    const control = segmented("Who can use this template?", [
      { value: "shared", label: "Everyone in the clinic" },
      { value: "personal", label: "Only me" },
    ], { value: chosenScope, onChange: (value) => (chosenScope = value) });
    return fieldGroup("Who can use this template?", control.el, "A template for everyone appears for all staff straight away. Only admins can change it.");
  };

  let request = existing?.source_request ?? "";
  let draft = existing ? { name: existing.name, description: existing.description ?? "", body: existing.body } : null;

  const working = (text) =>
    h("div", { class: "builder-working", attrs: { role: "status" } }, h("span", { class: "spinner", attrs: { "aria-hidden": "true" } }), h("span", { text }));

  function describeStep(problem = "") {
    const description = textArea("Describe the note you want", { value: request, placeholder: modeOf(chosenMode).example, rows: 6, maxLength: 4000, hint: "Name the sections you want, in order. The more detail you give, the better the template." });
    const error = h("p", { class: "field-error", attrs: { role: "alert" }, text: problem, hidden: !problem });
    const go = button("Create template", { variant: "primary", icon: "template" });
    go.addEventListener("click", () => {
      const text = description.value();
      if (text.length < 10) {
        description.setError("Describe the note in a little more detail.");
        return;
      }
      request = text;
      withBusy(go, async () => {
        replace(content, working("Creating your template. This can take up to a minute…"));
        try {
          draft = await draftTemplate(text, chosenMode);
          reviewStep();
        } catch (err) {
          describeStep(messageOf(err));
        }
      });
    });
    replace(
      content,
      h("p", { class: "builder-intro", text: "Describe the note in your own words. A detailed template will be drafted for you to check and change before saving." }),
      typeChoice(true),
      scopeChoice(),
      description.el,
      error,
      h("div", { class: "builder-foot" }, button("Cancel", { onClick: () => dialog.close() }), go),
    );
    description.input.focus();
  }

  function reviewStep() {
    const name = textField("Template name", { value: draft.name, maxLength: 80, autocomplete: "off" });
    const description = textField("Short description", { value: draft.description, maxLength: 300, autocomplete: "off" });
    const body = textArea("Template", { value: draft.body, tall: true, maxLength: 12000, hint: "Section headings end with a colon. Text in square brackets tells the note writer what to include." });
    const changes = textArea("Ask for changes", { rows: 3, maxLength: 2000, placeholder: "For example: add a social history section and split examination into systems." });
    const error = h("p", { class: "field-error", attrs: { role: "alert" }, hidden: true });
    const showError = (message) => {
      error.textContent = message ?? "";
      error.hidden = !message;
    };

    const update = button("Update template", { icon: "refresh" });
    update.addEventListener("click", () => {
      const wanted = changes.value();
      if (wanted.length < 3) {
        changes.setError("Say what you would like changed.");
        return;
      }
      withBusy(update, async () => {
        showError("");
        try {
          draft = await reviseTemplate({ name: name.value(), description: description.value(), body: body.input.value }, wanted, chosenMode);
          reviewStep();
          toast("The template has been updated.", "info");
        } catch (err) {
          showError(messageOf(err));
        }
      });
    });

    const save = button("Save template", { variant: "primary", icon: "check" });
    save.addEventListener("click", () => {
      showError("");
      for (const field of [name, body]) field.setError("");
      if (!name.value()) return name.setError("Give the template a name.");
      if (body.input.value.trim().length < 10) return body.setError("The template is too short.");
      withBusy(save, async () => {
        try {
          const id = await saveTemplate({
            id: existing?.id ?? null,
            name: name.value(),
            description: description.value(),
            body: body.input.value.trim(),
            sourceRequest: request,
            scope: existing?.scope ?? chosenScope,
            mode: chosenMode,
          });
          toast(existing ? "The template is saved." : chosenScope === "shared" ? "The template is ready for everyone in the clinic." : "The template has been created.");
          dialog.close();
          onSaved?.(id);
        } catch (err) {
          showError(messageOf(err));
        }
      });
    });

    replace(
      content,
      typeChoice(false),
      scopeChoice(),
      h("div", { class: "form-grid" }, name.el, description.el),
      body.el,
      h("div", { class: "builder-changes" }, h("h3", {}, icon("pencil"), h("span", { text: "Want something different?" })), changes.el, h("div", { class: "btn-row" }, update)),
      error,
      h(
        "div",
        { class: "builder-foot" },
        existing ? button("Cancel", { onClick: () => dialog.close() }) : button("Start again", { icon: "arrowLeft", onClick: () => describeStep() }),
        save,
      ),
    );
  }

  if (draft) reviewStep();
  else describeStep();
  return dialog;
}
