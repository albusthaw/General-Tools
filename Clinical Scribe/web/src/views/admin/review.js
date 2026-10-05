// Review records: an admin opens someone else's records only inside a review with
// a stated reason. The server writes every list, record and copy to the audit log
// before returning anything.
import { button, withBusy } from "../../components/button.js";
import { modeChip, noteCard, statusChip, transcriptCard } from "../../components/cards.js";
import { banner, emptyState, loading, pageHead, toast } from "../../components/feedback.js";
import { checkbox, selectField, textArea } from "../../components/fields.js";
import { listUsers } from "../../lib/api/admin.js";
import { currentReview, endReview, listRecords, openRecord, recordCopy, startReview } from "../../lib/api/review.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf, UserError } from "../../lib/errors.js";
import { dateTime, duration, timeOnly } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { modeOf } from "../../lib/modes.js";
import { profile } from "../../lib/store.js";

// "Recording at 10:30" or "Voice note at 10:30" when a record has no label.
const titleOf = (record) => record.title || `${modeOf(record.mode).untitled} ${timeOnly(record.started_at)}`;

const WARNING_TEXT =
  "Open someone else's records only when there is a clear need, such as a clinical audit, a complaint or a safety review. Everything you open or copy is saved in the audit log with your name, the person, the record and your reason.";

export async function renderReview(container) {
  const body = h("div", { class: "stack" }, loading());
  replace(container, pageHead("Review records"), body);
  let review = null;

  function closedReview(error, message) {
    if (error instanceof UserError && error.code === "review_closed") {
      review = null;
      showStart(message ?? error.message);
      return true;
    }
    return false;
  }

  async function showStart(notice = "") {
    let people = [];
    try {
      people = (await listUsers({ limit: 200 })).filter((p) => p.id !== profile().id);
    } catch (error) {
      replace(body, banner({ kind: "bad", text: messageOf(error) }));
      return;
    }
    const person = selectField(
      "Whose records do you need to review?",
      [{ value: "", label: "Choose a person" }, ...people.map((p) => ({ value: p.id, label: p.full_name ? `${p.full_name} (${p.email})` : p.email }))],
    );
    const reason = textArea("Reason for this review", { rows: 3, maxLength: 500, placeholder: "For example: Clinical audit of discharge notes requested by the governance team." });
    const confirm = checkbox("I understand that this review is recorded in the audit log, with my name and reason.");
    const start = button("Start review", { variant: "primary", icon: "shield" });
    const error = h("p", { class: "field-error", attrs: { role: "alert" }, hidden: true });

    start.addEventListener("click", () => {
      person.setError("");
      reason.setError("");
      error.hidden = true;
      if (!person.value()) return person.setError("Choose a person.");
      if (reason.value().length < 10) return reason.setError("Give a clear reason of at least 10 characters.");
      if (!confirm.value()) {
        error.textContent = "Tick the box to confirm you understand the review is recorded.";
        error.hidden = false;
        return;
      }
      withBusy(start, async () => {
        try {
          const started = await startReview(person.value(), reason.value(), true);
          review = { ...started, reason: reason.value() };
          showRecords();
        } catch (err) {
          error.textContent = messageOf(err);
          error.hidden = false;
        }
      });
    });

    replace(
      body,
      notice ? banner({ kind: "info", text: notice }) : null,
      banner({ kind: "warn", title: "These records belong to the clinicians who made them", text: WARNING_TEXT }),
      people.length
        ? h(
          "section",
          { class: "glass-card card", attrs: { "aria-labelledby": "start-review-title" } },
          h("div", { class: "card-head" }, h("h2", { attrs: { id: "start-review-title" } }, icon("shield"), h("span", { text: "Start a review" }))),
          h("div", { class: "stack" }, person.el, reason.el, confirm.el, error),
          h("div", { class: "card-foot" }, start),
        )
        : h("div", { class: "glass-card" }, emptyState({ icon: "users", title: "No one else to review", text: "Only other people's records can be reviewed." })),
    );
  }

  function reviewBar() {
    const end = button("End review", { variant: "primary", size: "small", icon: "check" });
    end.addEventListener("click", () =>
      withBusy(end, async () => {
        try {
          await endReview(review.review_id);
        } catch {
          // Ending twice is harmless.
        }
        review = null;
        toast("The review has ended.");
        showStart();
      })
    );
    const who = review.target.full_name ? `${review.target.full_name} (${review.target.email})` : review.target.email;
    return h(
      "div",
      { class: "review-bar", attrs: { role: "status" } },
      icon("shield"),
      h(
        "div",
        { class: "review-bar-text" },
        h("strong", { text: `Review in progress: ${who}` }),
        h("span", { text: `Reason: ${review.reason}` }),
        h("span", { class: "small", text: "Everything you open is recorded. The review ends after 30 minutes without activity." }),
      ),
      end,
    );
  }

  async function showRecords() {
    replace(body, reviewBar(), loading("Loading records…"));
    try {
      const records = await listRecords(review.review_id);
      replace(
        body,
        reviewBar(),
        h(
          "section",
          { class: "glass-card card list-card", attrs: { "aria-label": "Records" } },
          records.length
            ? h(
              "div",
              { class: "list" },
              records.map((record) =>
                h(
                  "button",
                  { type: "button", class: "list-row", onClick: () => showRecord(record.id) },
                  h("span", { class: ["row-icon", `is-${modeOf(record.mode).id}`] }, icon(modeOf(record.mode).icon)),
                  h(
                    "span",
                    { class: "row-main" },
                    h("span", { class: "row-title", text: titleOf(record) }),
                    h("span", { class: "row-meta" }, h("span", { text: dateTime(record.started_at) }), record.duration_seconds ? h("span", { text: duration(record.duration_seconds) }) : null, h("span", { text: `${record.note_count} ${Number(record.note_count) === 1 ? "note" : "notes"}` })),
                    h("span", { class: "type-chips" }, modeChip(record.mode)),
                  ),
                  h("span", { class: "row-end" }, statusChip(record.status)),
                  icon("chevronRight", { className: "chev" }),
                )
              ),
            )
            : emptyState({ icon: "history", title: "No records", text: "This person has no recordings." }),
        ),
      );
    } catch (error) {
      if (!closedReview(error)) replace(body, reviewBar(), banner({ kind: "bad", text: messageOf(error) }));
    }
  }

  async function showRecord(scribeId) {
    replace(body, reviewBar(), loading("Opening the record…"));
    try {
      const record = await openRecord(review.review_id, scribeId);
      const logCopy = (what, noteId = null) => recordCopy(review.review_id, scribeId, what, noteId).catch((error) => closedReview(error));
      replace(
        body,
        reviewBar(),
        h("button", { type: "button", class: "back-link", onClick: showRecords }, icon("arrowLeft"), h("span", { text: "All records" })),
        h(
          "div",
          { class: "page-head detail-head" },
          h(
            "div",
            { class: "detail-title" },
            h("h2", { class: "record-title", text: titleOf(record) }),
            h("p", { class: "detail-meta" }, h("span", { text: dateTime(record.started_at) }), record.duration_seconds ? h("span", { text: duration(record.duration_seconds) }) : null, modeChip(record.mode), statusChip(record.status)),
          ),
        ),
        record.transcript ? transcriptCard(record.transcript, { collapsed: false, onCopied: () => logCopy("transcript") }) : banner({ kind: "info", text: "There is no transcript for this record." }),
        (record.notes ?? []).map((note) => noteCard(note, { onCopied: () => logCopy("note", note.id) })),
      );
    } catch (error) {
      if (!closedReview(error)) replace(body, reviewBar(), banner({ kind: "bad", text: messageOf(error) }));
    }
  }

  try {
    const current = await currentReview();
    if (current) {
      review = current;
      showRecords();
    } else {
      showStart();
    }
  } catch (error) {
    replace(body, banner({ kind: "bad", text: messageOf(error) }));
  }
}
