// Recording: every recording and whether its audio is still kept, for admins only.
// Audio follows the "Keep audio" setting in AI settings; once deleted it shows as
// deleted. Listening or downloading needs a reason and is written to the audit log.
import { button, withBusy } from "../../components/button.js";
import { modeChip, statusChip } from "../../components/cards.js";
import { banner, chip, emptyState, loading, pageHead } from "../../components/feedback.js";
import { getSettings, listRecordings, listUsers } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { dateOnly, dateTime, duration } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { openRecording } from "./recording-player.js";

const PAGE = 50;
const AUDIO_FILTERS = [
  { value: "", label: "All audio" },
  { value: "kept", label: "Audio kept" },
  { value: "deleted", label: "Audio deleted" },
];
const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "scribe", label: "Clinical Scribe" },
  { value: "voice", label: "Voice Note" },
];

// A row of filter chips; one is pressed at a time.
function filterChips(label, filters, onPick) {
  let value = "";
  const items = filters.map((filter) =>
    h("button", {
      type: "button",
      class: "filter-chip",
      text: filter.label,
      attrs: { "aria-pressed": String(filter.value === value) },
      onClick: () => {
        value = filter.value;
        items.forEach((item, index) => item.setAttribute("aria-pressed", String(filters[index].value === value)));
        onPick(value);
      },
    })
  );
  return h("div", { class: "chip-row", attrs: { role: "group", "aria-label": label } }, items);
}

function retentionText(days) {
  if (days === 0) return "Audio is deleted as soon as the transcript is ready.";
  if (days === -1) return "Audio is kept until the recording is deleted.";
  return `Audio is kept for ${days} days after the transcript is ready.`;
}

function audioChip(row) {
  if (row.audio_state === "deleted") {
    const when = row.deleted_at ? dateOnly(row.deleted_at) : "";
    if (row.deleted_reason === "person") return chip(`Deleted with the recording · ${when}`, "red", "trash");
    if (row.deleted_reason === "account_removed") return chip(`Deleted with the account · ${when}`, "red", "trash");
    return chip(`Deleted · ${when}`, "red", "trash");
  }
  if (row.audio_state === "none") return chip("No audio saved");
  if (row.keep_until) {
    return new Date(row.keep_until).getTime() <= Date.now()
      ? chip("Being deleted", "amber", "timer")
      : chip(`Kept until ${dateOnly(row.keep_until)}`, "green", "waveform");
  }
  return chip("Kept", "green", "waveform");
}

function recordingStatus(row) {
  if (row.status === "deleted") return chip("Deleted", "red");
  if (row.status === "recording") return chip("Being recorded", "amber");
  return statusChip(row.status);
}

export async function renderRecordings(container) {
  let person = "";
  let audio = "";
  let type = "";
  let rows = [];
  let more = false;

  const intro = h("p", { class: "page-intro" }, "Loading…");
  const personSelect = h("select", { class: "select", attrs: { "aria-label": "Person" } }, h("option", { value: "", text: "Everyone" }));
  personSelect.addEventListener("change", () => {
    person = personSelect.value;
    load(true);
  });
  const audioChips = filterChips("Audio", AUDIO_FILTERS, (value) => {
    audio = value;
    load(true);
  });
  const typeChips = filterChips("Type", TYPE_FILTERS, (value) => {
    type = value;
    load(true);
  });
  const tableBox = h("div", { class: "table-wrap" }, loading("Loading recordings…"));
  const moreBox = h("div", { class: "load-more" });

  replace(
    container,
    pageHead("Recording"),
    banner({
      kind: "info",
      title: "Only administrators can see this page",
      text: "Audio is never public. To listen to or download a recording you give a reason, and that is written in the audit log with your name.",
    }),
    intro,
    h("div", { class: "toolbar" }, h("label", { class: "select-box" }, icon("users"), personSelect), typeChips, audioChips),
    h("section", { class: "glass-card card table-card" }, tableBox),
    moreBox,
  );

  function table() {
    return h(
      "table",
      { class: "table stack-on-phone recordings-table" },
      h("thead", {}, h("tr", {}, ["Recorded", "Clinician", "Type", "Length", "Status", "Audio", ""].map((label) => h("th", { scope: "col", text: label })))),
      h(
        "tbody",
        {},
        rows.map((row) =>
          h(
            "tr",
            { class: row.audio_state === "deleted" ? "is-muted" : "" },
            h("td", {}, h("div", { class: "cell-main" }, h("strong", { text: dateTime(row.recorded_at) }))),
            h("td", { attrs: { "data-label": "Clinician" } }, h("div", { class: "cell-main" }, h("span", { text: row.owner_name || row.owner_email || "—" }), row.owner_name ? h("span", { class: "muted small", text: row.owner_email }) : null)),
            h("td", { attrs: { "data-label": "Type" } }, modeChip(row.mode)),
            h("td", { class: "small", attrs: { "data-label": "Length" } }, h("span", { text: duration(row.duration_seconds) })),
            h("td", { attrs: { "data-label": "Status" } }, recordingStatus(row)),
            h("td", { attrs: { "data-label": "Audio" } }, audioChip(row)),
            h(
              "td",
              { class: "cell-actions" },
              row.audio_state === "kept"
                ? button("Listen", { icon: "play", size: "small", attrs: { "aria-label": `Listen to the recording from ${dateTime(row.recorded_at)}` }, onClick: () => openRecording(row) })
                : null,
            ),
          )
        ),
      ),
    );
  }

  function draw() {
    replace(
      tableBox,
      rows.length
        ? table()
        : emptyState({ icon: "waveform", title: "No recordings", text: person || audio || type ? "Nothing matches this filter." : "Recordings appear here once clinicians start recording." }),
    );
    replace(moreBox, more ? loadMoreButton() : null);
  }

  function loadMoreButton() {
    const btn = button("Show more", { icon: "chevronDown" });
    btn.addEventListener("click", () => withBusy(btn, () => load(false)));
    return btn;
  }

  async function load(fresh) {
    if (fresh) replace(tableBox, loading("Loading recordings…"));
    try {
      const before = fresh || rows.length === 0 ? null : rows[rows.length - 1].recorded_at;
      const page = await listRecordings({ person: person || null, audio, before, limit: PAGE, mode: type });
      rows = fresh ? page : [...rows, ...page];
      more = page.length === PAGE;
      draw();
    } catch (error) {
      replace(tableBox, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: () => load(true) } }));
    }
  }

  try {
    const [settings, people] = await Promise.all([getSettings(), listUsers({ limit: 200 })]);
    intro.textContent = `${retentionText(settings.settings.audio_retention_days)} You can change this under AI settings → Recordings and sign-in.`;
    for (const p of people) personSelect.append(h("option", { value: p.id, text: p.full_name ? `${p.full_name} (${p.email})` : p.email }));
  } catch {
    intro.textContent = "Audio follows the “Keep audio” setting under AI settings.";
  }
  appHooks.enhanceList?.(tableBox, { onRefresh: () => load(true) });
  await load(true);
}
