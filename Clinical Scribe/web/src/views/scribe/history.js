// The History tab, with a tab for each type: Clinical Scribe recordings and Voice
// Notes, grouped by day, 10 to a page. The search looks through every recording of
// that type: labels, transcripts and notes.
import { button } from "../../components/button.js";
import { statusChip } from "../../components/cards.js";
import { banner, emptyState, loading, pageHead } from "../../components/feedback.js";
import { searchRecordings } from "../../lib/api/scribes.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { dayLabel, duration, timeOnly } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { countOf, MODE_LIST, modeOf } from "../../lib/modes.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { href, navigate } from "../../lib/router.js";
import { profile } from "../../lib/store.js";
import { scribeTabs } from "../shell.js";
import { deleteRecording, renameRecording } from "./recording-actions.js";

// Each tab's search and page stay while the person opens a recording and comes
// back, for the same person only.
const kept = { userId: null, scribe: { term: "", page: 1 }, voice: { term: "", page: 1 } };

function freshKept(userId) {
  Object.assign(kept, { userId, scribe: { term: "", page: 1 }, voice: { term: "", page: 1 } });
}

// The two tabs at the top of History.
function historyTabs(active) {
  return h(
    "nav",
    { class: "history-tabs", attrs: { "aria-label": "History" } },
    MODE_LIST.map((type) =>
      h(
        "a",
        { class: ["history-tab", `is-${type.id}`], href: href(type.historyPath), attrs: { "aria-current": type.id === active ? "page" : null } },
        icon(type.icon),
        h("span", { text: type.name }),
      )
    ),
  );
}

// The extract with the searched words marked.
function marked(text, term) {
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!needle || lower.length !== text.length) return [text];
  const parts = [];
  let at = 0;
  for (let found = lower.indexOf(needle); found >= 0; found = lower.indexOf(needle, at)) {
    if (found > at) parts.push(text.slice(at, found));
    parts.push(h("mark", { text: text.slice(found, found + needle.length) }));
    at = found + needle.length;
  }
  parts.push(text.slice(at));
  return parts;
}

function row(scribe, term) {
  const type = modeOf(scribe.mode);
  const title = scribe.title || `${type.untitled} ${timeOnly(scribe.started_at)}`;
  const notes = scribe.note_count === 1 ? "1 note" : `${scribe.note_count} notes`;
  const where = scribe.found_in === "transcript" ? "Transcript" : scribe.found_in === "note" ? "Note" : "";
  return h(
    "a",
    { class: "list-row", href: href(`/history/${scribe.id}`), dataset: { id: scribe.id } },
    h("span", { class: ["row-icon", `is-${type.id}`] }, icon(type.icon)),
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
      where && scribe.extract ? h("span", { class: "row-extract" }, h("strong", { text: `${where}: ` }), marked(scribe.extract, term)) : null,
    ),
    h("span", { class: "row-end" }, statusChip(scribe.status)),
    icon("chevronRight", { className: "chev" }),
  );
}

export async function renderHistory(container, route) {
  const mode = modeOf(route.mode);
  const me = profile()?.id ?? null;
  if (kept.userId !== me) freshKept(me);
  const place = kept[mode.id];

  const search = h("input", {
    class: "input search-input",
    type: "search",
    value: place.term,
    placeholder: "Search labels, transcripts and notes",
    attrs: { "aria-label": `Search ${mode.nouns}`, autocomplete: "off", maxlength: "100" },
  });
  const found = h("p", { class: "search-count", attrs: { role: "status" } });
  const listBox = h("div", { class: "history-list" });
  const previous = button("Previous", { icon: "chevronLeft", size: "small" });
  const next = button("Next", { icon: "chevronRight", iconAfter: true, size: "small" });
  const where = h("span", { class: "pager-text" });
  const pager = h("nav", { class: "pager", attrs: { "aria-label": "Pages" }, hidden: true }, previous, where, next);
  replace(
    container,
    pageHead("History"),
    scribeTabs(route),
    historyTabs(mode.id),
    h("div", { class: "toolbar" }, h("label", { class: "search-box" }, icon("search"), search), found),
    h("section", { class: "glass-card card list-card" }, listBox),
    pager,
  );

  let items = [];
  let token = 0;

  function draw(result) {
    found.textContent = place.term ? `${countOf(mode.id, result.total)} found` : "";
    pager.hidden = result.pages <= 1;
    where.textContent = `Page ${result.page} of ${result.pages}`;
    previous.disabled = result.page <= 1;
    next.disabled = result.page >= result.pages;

    if (items.length === 0) {
      replace(
        listBox,
        place.term
          ? emptyState({ icon: "search", title: "No matches", text: `No ${mode.noun} has a label, transcript or note with those words.` })
          : emptyState({ icon: mode.icon, title: mode.emptyTitle, text: mode.emptyText, action: { label: mode.emptyAction, icon: mode.id === "voice" ? "voice" : "mic", onClick: () => navigate(mode.path) } }),
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
        h("section", { class: "day-group" }, h("h2", { class: "group-label", text: label }), h("div", { class: "list" }, rows.map((item) => row(item, place.term))))
      ),
    );
  }

  async function load({ quiet = false } = {}) {
    const mine = ++token;
    if (!quiet) replace(listBox, loading(`Loading your ${mode.nouns}…`));
    try {
      let result = await searchRecordings({ query: place.term, page: place.page, mode: mode.id });
      // The page may be past the end after recordings were deleted.
      if (result.items.length === 0 && result.total > 0 && place.page > result.pages) {
        place.page = result.pages;
        result = await searchRecordings({ query: place.term, page: place.page, mode: mode.id });
      }
      if (mine !== token) return;
      place.page = result.page;
      items = result.items;
      draw(result);
    } catch (error) {
      if (mine !== token) return;
      pager.hidden = true;
      replace(listBox, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: () => load() } }));
    }
  }

  // Both buttons wait while the page loads; the new page sets them again.
  async function goTo(page) {
    previous.disabled = true;
    next.disabled = true;
    place.page = page;
    await load();
    listBox.closest(".list-card")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  let debounce = null;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const term = search.value.trim();
      if (term === place.term) return;
      place.term = term;
      place.page = 1;
      load();
    }, 300);
  });
  previous.addEventListener("click", () => goTo(place.page - 1));
  next.addEventListener("click", () => goTo(place.page + 1));

  // In the apps: pull down to refresh, swipe or long-press a row for its actions.
  appHooks.enhanceList?.(listBox, {
    onRefresh: () => load({ quiet: true }),
    rows: ".list-row",
    rowActions: (rowEl) => {
      const scribe = items.find((item) => item.id === rowEl.dataset.id);
      if (!scribe) return [];
      return [
        { label: "Rename", icon: "pencil", onClick: () => renameRecording(scribe, () => load({ quiet: true })) },
        scribe.status === "processing" ? null : { label: "Delete", icon: "trash", danger: true, onClick: () => deleteRecording(scribe, () => load({ quiet: true })) },
      ].filter(Boolean);
    },
  });

  await load();
  return () => clearTimeout(debounce);
}
