// User settings: everyone with an account, and what admins can change.
import { button } from "../../components/button.js";
import { confirmDialog } from "../../components/dialog.js";
import { banner, chip, emptyState, loading, pageHead, toast } from "../../components/feedback.js";
import { menuButton } from "../../components/menu.js";
import { listUsers, removeUser, setRole, setStatus } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { minutes, relative } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { profile } from "../../lib/store.js";
import { openAddPerson, openChangePassword, openMinutes } from "./user-dialogs.js";

const FILTERS = [
  { value: "", label: "Everyone" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Waiting for approval" },
  { value: "suspended", label: "Suspended" },
];

function statusChip(status) {
  if (status === "active") return chip("Active", "green");
  if (status === "pending") return chip("Waiting for approval", "amber");
  return chip("Suspended", "red");
}

function minutesText(person) {
  if (person.credit_unlimited) return "Unlimited";
  return `ElevenLabs ${minutes(person.credit_seconds_elevenlabs)} · Gemini ${minutes(person.credit_seconds_gemini)}`;
}

export async function renderUsers(container) {
  const me = profile();
  const search = h("input", { class: "input search-input", type: "search", placeholder: "Search by name or email", attrs: { "aria-label": "Search people", autocomplete: "off" } });
  let filter = "";
  const chips = FILTERS.map((f) =>
    h("button", {
      type: "button",
      class: "filter-chip",
      text: f.label,
      attrs: { "aria-pressed": String(f.value === filter) },
      onClick: () => {
        filter = f.value;
        chips.forEach((c, i) => c.setAttribute("aria-pressed", String(FILTERS[i].value === filter)));
        load();
      },
    })
  );
  const tableBox = h("div", { class: "table-wrap" }, loading("Loading people…"));
  const add = button("Add person", { variant: "primary", icon: "plus", onClick: () => openAddPerson(load) });

  replace(
    container,
    pageHead("User settings", [add]),
    h("div", { class: "toolbar" }, h("label", { class: "search-box" }, icon("search"), search), h("div", { class: "chip-row", attrs: { role: "group", "aria-label": "Show" } }, chips)),
    h("section", { class: "glass-card card table-card" }, tableBox),
  );

  async function act(work, done) {
    try {
      await work();
      if (done) toast(done);
      load();
    } catch (error) {
      toast(messageOf(error), "bad", 6000);
    }
  }

  function actions(person) {
    const self = person.id === me.id;
    return menuButton({
      label: `Actions for ${person.full_name || person.email}`,
      items: [
        { label: "Change password", icon: "lock", onClick: () => openChangePassword(person, load) },
        { label: "Transcription minutes", icon: "timer", onClick: () => openMinutes(person, load) },
        {
          label: person.role === "admin" ? "Make user" : "Make admin",
          icon: "shield",
          onClick: async () => {
            const toAdmin = person.role !== "admin";
            const ok = await confirmDialog({
              title: toAdmin ? "Make this person an admin?" : "Remove admin rights?",
              message: toAdmin
                ? `${person.full_name || person.email} will be able to manage people, AI settings and the audit log, and review records.`
                : `${person.full_name || person.email} will only be able to use Clinical Scribe.`,
              confirmLabel: toAdmin ? "Make admin" : "Make user",
            });
            if (ok) act(() => setRole(person.id, toAdmin ? "admin" : "user"), "The role has been changed.");
          },
        },
        { separator: true },
        {
          label: "Approve",
          icon: "checkCircle",
          hidden: person.status !== "pending",
          onClick: () => act(() => setStatus(person.id, "active"), "The account has been approved."),
        },
        {
          label: "Suspend",
          icon: "lock",
          hidden: person.status !== "active" || self,
          onClick: async () => {
            const ok = await confirmDialog({
              title: "Suspend this account?",
              message: `${person.full_name || person.email} will be signed out and will not be able to sign in until the account is restored. Their records are kept.`,
              confirmLabel: "Suspend",
              danger: true,
            });
            if (ok) act(() => setStatus(person.id, "suspended"), "The account has been suspended.");
          },
        },
        {
          label: "Restore",
          icon: "refresh",
          hidden: person.status !== "suspended",
          onClick: () => act(() => setStatus(person.id, "active"), "The account has been restored."),
        },
        {
          label: "Remove person",
          icon: "trash",
          danger: true,
          hidden: self,
          onClick: async () => {
            const ok = await confirmDialog({
              title: "Remove this person?",
              message: `${person.full_name || person.email} will lose access, and all their recordings, transcripts, notes and personal templates will be deleted permanently. The audit log keeps a record of the removal.`,
              confirmLabel: "Remove permanently",
              danger: true,
              typeToConfirm: person.email,
              onConfirm: () => removeUser(person.id, person.email),
            });
            if (ok) {
              toast("The person has been removed.");
              load();
            }
          },
        },
      ],
    });
  }

  function table(people) {
    return h(
      "table",
      { class: "table stack-on-phone" },
      h("thead", {}, h("tr", {}, ["Person", "Role", "Status", "Transcription minutes", "Last signed in", ""].map((label) => h("th", { scope: "col", text: label })))),
      h(
        "tbody",
        {},
        people.map((person) =>
          h(
            "tr",
            {},
            h("td", {}, h("div", { class: "cell-main" }, h("strong", { text: person.full_name || "(no name)" }), h("span", { class: "muted small", text: person.email }))),
            h("td", { attrs: { "data-label": "Role" } }, person.role === "admin" ? chip("Admin", "blue", "shield") : chip("User")),
            h("td", { attrs: { "data-label": "Status" } }, statusChip(person.status)),
            h("td", { class: "small", attrs: { "data-label": "Minutes" } }, h("span", { text: minutesText(person) })),
            h("td", { class: "small", attrs: { "data-label": "Signed in" } }, h("span", { class: "cap-first", text: relative(person.last_sign_in_at) })),
            h("td", { class: "cell-actions" }, actions(person)),
          )
        ),
      ),
    );
  }

  let token = 0;
  async function load() {
    const mine = ++token;
    try {
      const people = await listUsers({ search: search.value.trim(), status: filter, limit: 200 });
      if (mine !== token) return;
      const waiting = people.filter((p) => p.status === "pending").length;
      replace(
        tableBox,
        waiting && !filter ? banner({ kind: "warn", title: `${waiting} ${waiting === 1 ? "account is" : "accounts are"} waiting for approval`, text: "Approve or remove them from the actions menu." }) : null,
        people.length ? table(people) : emptyState({ icon: "users", title: "No one found", text: "Try a different search." }),
      );
    } catch (error) {
      replace(tableBox, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: load } }));
    }
  }

  let debounce = null;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 300);
  });
  await load();
  return () => clearTimeout(debounce);
}
