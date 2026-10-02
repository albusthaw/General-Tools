// The Templates tab: shared templates and the person's own.
import { button } from "../../components/button.js";
import { confirmDialog, openDialog } from "../../components/dialog.js";
import { banner, chip, emptyState, loading, pageHead, toast } from "../../components/feedback.js";
import { noteView } from "../../components/text-view.js";
import { deleteTemplate, listTemplates } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { icon } from "../../lib/icons.js";
import { store } from "../../lib/store.js";
import { scribeTabs } from "../shell.js";
import { openTemplateBuilder } from "./template-builder.js";

function viewTemplate(template, reload) {
  const personal = template.scope === "personal";
  openDialog({
    title: template.name,
    wide: true,
    body: [
      template.description ? h("p", { class: "muted", text: template.description }) : null,
      h("div", { class: "template-preview" }, noteView(template.body)),
    ],
    actions: personal
      ? [
        {
          label: "Delete",
          variant: "quiet danger-text",
          icon: "trash",
          onClick: async ({ close }) => {
            close();
            const ok = await confirmDialog({
              title: "Delete this template?",
              message: `"${template.name}" will be deleted. Notes already written with it are not affected.`,
              confirmLabel: "Delete template",
              danger: true,
              onConfirm: () => deleteTemplate(template.id),
            });
            if (ok) {
              toast("The template has been deleted.");
              reload();
            }
            return true;
          },
        },
        {
          label: "Edit",
          icon: "pencil",
          variant: "primary",
          onClick: ({ close }) => {
            close();
            openTemplateBuilder({ existing: template, onSaved: reload });
            return true;
          },
        },
      ]
      : [{ label: "Close", variant: "primary" }],
  });
}

function templateCard(template, reload) {
  return h(
    "button",
    { type: "button", class: "glass-card template-card", onClick: () => viewTemplate(template, reload) },
    h("span", { class: "template-icon" }, icon("template")),
    h(
      "span",
      { class: "template-text" },
      h("span", { class: "template-name" }, h("span", { text: template.name }), template.is_default ? chip("Default", "blue", "star") : null),
      template.description ? h("span", { class: "template-desc", text: template.description }) : null,
    ),
    icon("chevronRight", { className: "chev" }),
  );
}

export async function renderTemplates(container, route) {
  const sharedBox = h("div", { class: "template-grid" }, loading());
  const mineBox = h("div", { class: "template-grid" });
  const create = button("Create template", { variant: "primary", icon: "plus" });

  replace(
    container,
    pageHead("Templates", [create]),
    scribeTabs(route, "desktop-only"),
    h(
      "div",
      { class: "stack" },
      store.get().context?.ready?.templates
        ? null
        : banner({ kind: "warn", title: "The template helper is not set up yet", text: "You can still use the shared templates. Creating new templates needs a service key in AI settings." }),
      h("section", { attrs: { "aria-labelledby": "shared-title" } }, h("h2", { class: "section-title", attrs: { id: "shared-title" }, text: "Shared templates" }), sharedBox),
      h("section", { attrs: { "aria-labelledby": "mine-title" } }, h("h2", { class: "section-title", attrs: { id: "mine-title" }, text: "Your templates" }), mineBox),
    ),
  );

  async function load() {
    try {
      const templates = await listTemplates();
      const shared = templates.filter((t) => t.scope === "shared");
      const mine = templates.filter((t) => t.scope === "personal");
      replace(sharedBox, shared.length ? shared.map((t) => templateCard(t, load)) : h("p", { class: "muted", text: "There are no shared templates." }));
      replace(
        mineBox,
        mine.length
          ? mine.map((t) => templateCard(t, load))
          : h("div", { class: "glass-card" }, emptyState({
            icon: "template",
            title: "No templates of your own yet",
            text: "Describe the note you want and a detailed template will be drafted for you.",
            action: { label: "Create template", icon: "plus", onClick: () => openTemplateBuilder({ onSaved: load }) },
          })),
      );
    } catch (error) {
      replace(sharedBox, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: load } }));
    }
  }

  create.addEventListener("click", () => openTemplateBuilder({ onSaved: load }));
  appHooks.pageAction?.(create);
  appHooks.enhanceList?.(container, { onRefresh: load });
  await load();
}
