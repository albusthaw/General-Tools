// The Templates tab: shared templates and the person's own. Admins also create,
// change, archive and share the clinic's shared templates here.
import { button } from "../../components/button.js";
import { confirmDialog, openDialog } from "../../components/dialog.js";
import { banner, chip, emptyState, loading, pageHead, toast } from "../../components/feedback.js";
import { noteView } from "../../components/text-view.js";
import { deleteTemplate, listTemplates, setDefaultTemplate, shareTemplate } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { icon } from "../../lib/icons.js";
import { isAdmin, store } from "../../lib/store.js";
import { scribeTabs } from "../shell.js";
import { openTemplateBuilder } from "./template-builder.js";

// Asks first, then runs the change and reloads the list.
async function confirmThen({ title, message, confirmLabel, danger = false, work, done, reload }) {
  const ok = await confirmDialog({ title, message, confirmLabel, danger, onConfirm: work });
  if (ok) {
    toast(done);
    reload();
  }
}

// What a person can do with a template: their own can be edited and deleted (an
// admin can also share it with everyone); admins also look after shared ones.
function templateActions(template, reload) {
  const admin = isAdmin();
  const edit = {
    label: "Edit",
    icon: "pencil",
    variant: "primary",
    onClick: ({ close }) => {
      close();
      openTemplateBuilder({ existing: template, onSaved: reload });
      return true;
    },
  };
  const after = (work) => async ({ close }) => {
    close();
    await work();
    return true;
  };

  if (template.scope === "personal") {
    return [
      {
        label: "Delete",
        variant: "quiet danger-text",
        icon: "trash",
        onClick: after(() => confirmThen({
          title: "Delete this template?",
          message: `"${template.name}" will be deleted. Notes already written with it are not affected.`,
          confirmLabel: "Delete template",
          danger: true,
          work: () => deleteTemplate(template.id),
          done: "The template has been deleted.",
          reload,
        })),
      },
      admin ? {
        label: "Share with everyone",
        icon: "users",
        onClick: after(() => confirmThen({
          title: "Share this template with everyone?",
          message: `"${template.name}" will be available to everyone in the clinic. Only admins can change or archive it.`,
          confirmLabel: "Share template",
          work: () => shareTemplate(template.id),
          done: "The template is now shared with everyone.",
          reload,
        })),
      } : null,
      edit,
    ].filter(Boolean);
  }

  if (!admin) return [{ label: "Close", variant: "primary" }];
  return [
    template.is_default ? null : {
      label: "Archive",
      variant: "quiet danger-text",
      icon: "archive",
      onClick: after(() => confirmThen({
        title: "Archive this template?",
        message: `"${template.name}" will no longer be offered. Notes already written with it are not affected. You can restore it later in AI settings.`,
        confirmLabel: "Archive",
        danger: true,
        work: () => deleteTemplate(template.id),
        done: "The template has been archived.",
        reload,
      })),
    },
    template.is_default ? null : {
      label: "Make default",
      icon: "star",
      onClick: async () => {
        await setDefaultTemplate(template.id);
        toast(`"${template.name}" is now the default.`);
        reload();
        return true;
      },
    },
    edit,
  ].filter(Boolean);
}

function viewTemplate(template, reload) {
  openDialog({
    title: template.name,
    wide: true,
    body: [
      template.description ? h("p", { class: "muted", text: template.description }) : null,
      h("div", { class: "template-preview" }, noteView(template.body)),
    ],
    actions: templateActions(template, reload),
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
            action: { label: "Create template", icon: "plus", onClick: () => openTemplateBuilder({ scope: isAdmin() ? "ask" : "personal", onSaved: load }) },
          })),
      );
    } catch (error) {
      replace(sharedBox, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: load } }));
    }
  }

  create.addEventListener("click", () => openTemplateBuilder({ scope: isAdmin() ? "ask" : "personal", onSaved: load }));
  appHooks.pageAction?.(create);
  appHooks.enhanceList?.(container, { onRefresh: load });
  await load();
}
