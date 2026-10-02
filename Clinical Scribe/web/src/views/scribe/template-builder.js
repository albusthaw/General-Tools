// Template builder: describe the note, let the template helper draft it, review,
// ask for changes or edit, then save. Used for personal templates and, by
// admins, for shared templates.
import { button, withBusy } from "../../components/button.js";
import { openDialog } from "../../components/dialog.js";
import { toast } from "../../components/feedback.js";
import { textArea, textField } from "../../components/fields.js";
import { draftTemplate, reviseTemplate, saveTemplate } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";

const EXAMPLE = "For example: a medical clerking note with presenting complaint, history of presenting complaint, past medical history, drug history and allergies, social and family history, systems review, examination, impression and plan.";

export function openTemplateBuilder({ scope = "personal", existing = null, onSaved } = {}) {
  const content = h("div", { class: "builder" });
  const dialog = openDialog({
    title: existing ? "Edit template" : scope === "shared" ? "Create shared template" : "Create template",
    body: [content],
    wide: true,
  });

  let request = existing?.source_request ?? "";
  let draft = existing ? { name: existing.name, description: existing.description ?? "", body: existing.body } : null;

  const working = (text) =>
    h("div", { class: "builder-working", attrs: { role: "status" } }, h("span", { class: "spinner", attrs: { "aria-hidden": "true" } }), h("span", { text }));

  function describeStep(problem = "") {
    const description = textArea("Describe the note you want", { value: request, placeholder: EXAMPLE, rows: 6, maxLength: 4000, hint: "Name the sections you want, in order. The more detail you give, the better the template." });
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
          draft = await draftTemplate(text);
          reviewStep();
        } catch (err) {
          describeStep(messageOf(err));
        }
      });
    });
    replace(
      content,
      h("p", { class: "builder-intro", text: "Describe the note in your own words. A detailed template will be drafted for you to check and change before saving." }),
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
          draft = await reviseTemplate({ name: name.value(), description: description.value(), body: body.input.value }, wanted);
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
            scope: existing?.scope ?? scope,
          });
          toast(existing ? "The template is saved." : "The template has been created.");
          dialog.close();
          onSaved?.(id);
        } catch (err) {
          showError(messageOf(err));
        }
      });
    });

    replace(
      content,
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
