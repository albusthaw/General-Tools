// "Write another note" from an existing transcript with any template.
import { button, withBusy } from "../../components/button.js";
import { toast } from "../../components/feedback.js";
import { selectField } from "../../components/fields.js";
import { requestNote } from "../../lib/api/scribes.js";
import { h } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";
import { defaultTemplateId, templateOptions } from "./template-options.js";

export function anotherNoteForm(scribeId, templates, onRequested) {
  if (!templates.length) return null;
  const picker = selectField("Template", templateOptions(templates), { value: defaultTemplateId(templates) });
  const error = h("p", { class: "field-error", attrs: { role: "alert" }, hidden: true });
  const go = button("Write note", { icon: "noteWrite", variant: "primary" });
  go.addEventListener("click", () =>
    withBusy(go, async () => {
      error.hidden = true;
      try {
        const noteId = await requestNote(scribeId, picker.value());
        toast("The note is being written.", "info");
        onRequested?.(noteId);
      } catch (err) {
        error.textContent = messageOf(err);
        error.hidden = false;
      }
    })
  );
  return h(
    "section",
    { class: "glass-card card another-note", attrs: { "aria-labelledby": `another-${scribeId}` } },
    h("div", { class: "card-head" }, h("h3", { attrs: { id: `another-${scribeId}` } }, icon("plus"), h("span", { text: "Write another note" }))),
    h("div", { class: "another-row" }, picker.el, go),
    error,
  );
}
