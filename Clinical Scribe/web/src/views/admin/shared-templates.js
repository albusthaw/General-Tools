// Shared templates, managed by admins from AI settings.
import { button } from "../../components/button.js";
import { confirmDialog } from "../../components/dialog.js";
import { banner, chip, loading, toast } from "../../components/feedback.js";
import { menuButton } from "../../components/menu.js";
import { listSharedForAdmin, restoreTemplate, setDefaultTemplate, deleteTemplate } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";
import { openTemplateBuilder } from "../scribe/template-builder.js";

export function sharedTemplatesCard() {
  const list = h("div", { class: "list" }, loading());
  const create = button("Create shared template", { size: "small", variant: "primary", icon: "plus" });
  const card = h(
    "section",
    { class: "glass-card card", attrs: { "aria-labelledby": "shared-templates-title" } },
    h(
      "div",
      { class: "card-head" },
      h("div", {}, h("h2", { attrs: { id: "shared-templates-title" } }, icon("template"), h("span", { text: "Shared templates" }))),
      create,
    ),
    list,
  );

  async function run(work, message) {
    try {
      await work();
      toast(message);
      load();
    } catch (error) {
      toast(messageOf(error), "bad", 6000);
    }
  }

  async function load() {
    try {
      const templates = await listSharedForAdmin();
      replace(
        list,
        templates.map((t) =>
          h(
            "div",
            { class: "list-row" },
            h("span", { class: "row-icon" }, icon("template")),
            h(
              "span",
              { class: "row-main" },
              h("span", { class: "row-title", text: t.name }),
              t.description ? h("span", { class: "row-meta", text: t.description }) : null,
            ),
            h("span", { class: "row-end" }, t.is_default ? chip("Default", "blue", "star") : null, t.is_archived ? chip("Archived") : null),
            menuButton({
              label: `Actions for ${t.name}`,
              items: [
                { label: "Edit", icon: "pencil", hidden: t.is_archived, onClick: () => openTemplateBuilder({ existing: t, onSaved: load }) },
                { label: "Make default", icon: "star", hidden: t.is_default || t.is_archived, onClick: () => run(() => setDefaultTemplate(t.id), `"${t.name}" is now the default.`) },
                { label: "Restore", icon: "refresh", hidden: !t.is_archived, onClick: () => run(() => restoreTemplate(t.id), "The template has been restored.") },
                {
                  label: "Archive",
                  icon: "archive",
                  danger: true,
                  hidden: t.is_archived || t.is_default,
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: "Archive this template?",
                      message: `"${t.name}" will no longer be offered. Notes already written with it are not affected. You can restore it later.`,
                      confirmLabel: "Archive",
                      danger: true,
                      onConfirm: () => deleteTemplate(t.id),
                    });
                    if (ok) {
                      toast("The template has been archived.");
                      load();
                    }
                  },
                },
              ],
            }),
          )
        ),
      );
    } catch (error) {
      replace(list, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: load } }));
    }
  }

  create.addEventListener("click", () => openTemplateBuilder({ scope: "shared", onSaved: load }));
  load();
  return card;
}
