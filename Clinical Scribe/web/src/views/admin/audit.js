// Audit log: every admin action and record review, newest first. Read-only.
import { button, withBusy } from "../../components/button.js";
import { banner, emptyState, loading, pageHead, toast } from "../../components/feedback.js";
import { selectField, textField } from "../../components/fields.js";
import { listAudit, listUsers } from "../../lib/api/admin.js";
import { downloadText, toCsv } from "../../lib/csv.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { dateTime } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { describe, GROUPS } from "./audit-text.js";

const PAGE = 50;

function entryRow(entry) {
  const { text, details } = describe(entry);
  const isReview = entry.action.startsWith("review.");
  const detailBox = h(
    "dl",
    { class: "kv audit-details", hidden: true },
    details.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })]),
  );
  const toggle = details.length
    ? h("button", {
      type: "button",
      class: "btn quiet small",
      text: "Details",
      attrs: { "aria-expanded": "false" },
      onClick: (event) => {
        const open = detailBox.hidden;
        detailBox.hidden = !open;
        event.currentTarget.setAttribute("aria-expanded", String(open));
      },
    })
    : null;
  return h(
    "li",
    { class: ["audit-row", isReview && "is-review"] },
    h("span", { class: "audit-icon" }, icon(isReview ? "shield" : "scroll")),
    h(
      "div",
      { class: "audit-main" },
      h("p", { class: "audit-text", text: text }),
      entry.reason ? h("p", { class: "audit-reason", text: `Reason: ${entry.reason}` }) : null,
      h("p", { class: "audit-time", text: dateTime(entry.created_at) }),
      detailBox,
    ),
    toggle,
  );
}

function toIsoStart(value) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function toIsoEnd(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export async function renderAudit(container) {
  let people = [];
  try {
    people = await listUsers({ limit: 200 });
  } catch {
    people = [];
  }
  const group = selectField("Show", GROUPS);
  const person = selectField("Person", [{ value: "", label: "Anyone" }, ...people.map((p) => ({ value: p.id, label: p.full_name || p.email }))]);
  const from = textField("From", { type: "date" });
  const to = textField("To", { type: "date" });
  const apply = button("Show results", { variant: "primary", icon: "search" });
  const download = button("Download CSV", { icon: "download" });
  const list = h("ol", { class: "audit-list" });
  const box = h("section", { class: "glass-card card list-card", attrs: { "aria-label": "Audit entries" } }, loading("Loading the audit log…"));
  const more = button("Show more", { icon: "chevronDown" });
  more.hidden = true;

  replace(
    container,
    pageHead("Audit log", [download]),
    h("section", { class: "glass-card card filters" }, h("div", { class: "filter-grid" }, group.el, person.el, from.el, to.el), h("div", { class: "btn-row end" }, apply)),
    box,
    h("div", { class: "btn-row center" }, more),
  );

  const filters = () => ({ group: group.value(), person: person.value() || null, from: toIsoStart(from.value()), to: toIsoEnd(to.value()) });
  let entries = [];

  async function load(reset) {
    try {
      const before = reset ? null : entries[entries.length - 1]?.id ?? null;
      const page = await listAudit({ ...filters(), beforeId: before, limit: PAGE });
      entries = reset ? page : entries.concat(page);
      more.hidden = page.length < PAGE;
      if (!entries.length) {
        replace(box, emptyState({ icon: "scroll", title: "Nothing found", text: "No entries match these filters." }));
        return;
      }
      replace(list, entries.map(entryRow));
      replace(box, list);
    } catch (error) {
      replace(box, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: () => load(true) } }));
    }
  }

  apply.addEventListener("click", () => withBusy(apply, () => load(true)));
  more.addEventListener("click", () => withBusy(more, () => load(false)));
  download.addEventListener("click", () =>
    withBusy(download, async () => {
      try {
        const rows = [];
        let before = null;
        for (let i = 0; i < 20; i++) {
          const page = await listAudit({ ...filters(), beforeId: before, limit: 500 });
          rows.push(...page);
          if (page.length < 500) break;
          before = page[page.length - 1].id;
        }
        const csv = toCsv(rows, [
          { label: "Time", value: (r) => new Date(r.created_at).toISOString() },
          { label: "Done by", value: (r) => r.actor_name || r.actor_email },
          { label: "Done by (email)", value: (r) => r.actor_email },
          { label: "What happened", value: (r) => describe(r).text },
          { label: "Person affected", value: (r) => r.target_email },
          { label: "Record number", value: (r) => r.scribe_id ?? "" },
          { label: "Reason", value: (r) => r.reason },
          { label: "Details", value: (r) => describe(r).details.filter(([label]) => label !== "Device").map(([label, value]) => `${label}: ${value}`).join("; ") },
          { label: "Device", value: (r) => r.user_agent },
        ]);
        const saved = await downloadText(`clinical-scribe-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
        if (saved) toast(`${rows.length} entries ${saved === "saved" ? "saved" : "downloaded"}.`);
      } catch (error) {
        toast(messageOf(error), "bad", 6000);
      }
    })
  );

  appHooks.enhanceList?.(box, { onRefresh: () => load(true) });
  await load(true);
}
