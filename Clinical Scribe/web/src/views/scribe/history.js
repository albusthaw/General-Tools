// The History tab: the person's own recordings, grouped by day.
import { button, withBusy } from "../../components/button.js";
import { statusChip } from "../../components/cards.js";
import { banner, emptyState, loading, pageHead } from "../../components/feedback.js";
import { listScribes } from "../../lib/api/scribes.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { dayLabel, duration, timeOnly } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { href, navigate } from "../../lib/router.js";
import { scribeTabs } from "../shell.js";
import { deleteRecording, renameRecording } from "./recording-actions.js";

const PAGE = 30;

function row(scribe) {
  const title = scribe.title || `Recording at ${timeOnly(scribe.started_at)}`;
  const notes = scribe.note_count === 1 ? "1 note" : `${scribe.note_count} notes`;
  return h(
    "a",
    { class: "list-row", href: href(`/history/${scribe.id}`), dataset: { id: scribe.id } },
    h("span", { class: "row-icon" }, icon(scribe.status === "transcribed" ? "noteWrite" : "waveform")),
    h(
      "span",
      { class: "row-main" },
      h("span", { class: "row-title", text: title }),
      h(
        "span",
        { class: "row-meta" },
        h("span", { text: timeOnly(scribe.started_at) }),
        scribe.duration_seconds ? h("span", { text: duration(scribe.duration_seconds) }) : null,
        scribe.status === "transcribed" ? h("span", { text: notes }) : null,
      ),
    ),
    h("span", { class: "row-end" }, statusChip(scribe.status)),
    icon("chevronRight", { className: "chev" }),
  );
}

export async function renderHistory(container, route) {
  const search = h("input", {
    class: "input search-input",
    type: "search",
    placeholder: "Search by label",
    attrs: { "aria-label": "Search recordings by label", autocomplete: "off" },
  });
  const listBox = h("div", { class: "history-list" });
  const more = button("Show more", { icon: "chevronDown" });
  more.hidden = true;
  replace(
    container,
    pageHead("History"),
    scribeTabs(route, "desktop-only"),
    h("div", { class: "toolbar" }, h("label", { class: "search-box" }, icon("search"), search)),
    h("section", { class: "glass-card card list-card" }, listBox),
    h("div", { class: "btn-row center" }, more),
  );

  let items = [];
  let term = "";
  let token = 0;

  function draw() {
    if (items.length === 0) {
      replace(
        listBox,
        term
          ? emptyState({ icon: "search", title: "No matches", text: "No recordings have a label that matches your search." })
          : emptyState({ icon: "history", title: "No recordings yet", text: "Your recordings, transcripts and notes will appear here.", action: { label: "Start a recording", icon: "mic", onClick: () => navigate("/scribe") } }),
      );
      return;
    }
    const groups = new Map();
    for (const item of items) {
      const label = dayLabel(item.started_at);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    }
    replace(
      listBox,
      [...groups.entries()].map(([label, rows]) =>
        h("section", { class: "day-group" }, h("h2", { class: "group-label", text: label }), h("div", { class: "list" }, rows.map(row)))
      ),
    );
  }

  async function load(reset) {
    const mine = ++token;
    if (reset) replace(listBox, loading("Loading your recordings…"));
    try {
      const before = reset ? null : items[items.length - 1]?.started_at ?? null;
      const page = await listScribes({ search: term, before, limit: PAGE });
      if (mine !== token) return;
      items = reset ? page : items.concat(page);
      more.hidden = page.length < PAGE;
      draw();
    } catch (error) {
      if (mine !== token) return;
      replace(listBox, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: () => load(true) } }));
    }
  }

  let debounce = null;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      term = search.value.trim();
      load(true);
    }, 300);
  });
  more.addEventListener("click", () => withBusy(more, () => load(false)));

  // In the apps: pull down to refresh, swipe or long-press a row for its actions.
  appHooks.enhanceList?.(listBox, {
    onRefresh: () => load(true),
    rows: ".list-row",
    rowActions: (rowEl) => {
      const scribe = items.find((item) => item.id === rowEl.dataset.id);
      if (!scribe) return [];
      return [
        { label: "Rename", icon: "pencil", onClick: () => renameRecording(scribe, () => load(true)) },
        scribe.status === "processing" ? null : { label: "Delete", icon: "trash", danger: true, onClick: () => deleteRecording(scribe, () => load(true)) },
      ].filter(Boolean);
    },
  });

  await load(true);
  return () => clearTimeout(debounce);
}
