// Opening a recording's audio: a warning, a reason and a tick come first. Then each
// part of the audio can be played or downloaded. The server writes the opening and
// every download to the audit log, with the reason.
import { button, withBusy } from "../../components/button.js";
import { openDialog } from "../../components/dialog.js";
import { banner, loading, toast } from "../../components/feedback.js";
import { checkbox, textArea } from "../../components/fields.js";
import { recordingPart, unlockRecording } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { saveFile } from "../../lib/files.js";
import { clock, dateTime } from "../../lib/format.js";

// The reason is offered again for the next recording in the same visit.
let lastReason = "";

function partRow(row, part, count, urls) {
  const label = `Part ${part.seq} of ${count} · ${clock(Number(part.duration_seconds) || 0)}`;
  const holder = h("div", { class: "player-slot" }, loading("Loading the audio…"));
  const download = button("Download", { icon: "download", size: "small" });
  download.addEventListener("click", () =>
    withBusy(download, async () => {
      try {
        const blob = await recordingPart(row.scribe_id, part.seq, { download: true });
        const day = String(row.recorded_at).slice(0, 10);
        const extension = /mp4|m4a/.test(part.mime_type) ? "m4a" : /ogg/.test(part.mime_type) ? "ogg" : /aac/.test(part.mime_type) ? "aac" : "webm";
        const saved = await saveFile(new Blob([blob], { type: part.mime_type }), `clinical-scribe-${day}-part-${part.seq}.${extension}`);
        if (saved) toast(saved === "saved" ? "The audio is saved. It is written in the audit log." : "Download started. It is written in the audit log.");
      } catch (error) {
        toast(messageOf(error), "bad");
      }
    })
  );
  // Parts load one after another, so a long recording does not fetch everything at once.
  const load = async () => {
    try {
      const blob = await recordingPart(row.scribe_id, part.seq);
      const url = URL.createObjectURL(new Blob([blob], { type: part.mime_type }));
      urls.push(url);
      replace(holder, h("audio", { controls: true, src: url, attrs: { preload: "metadata", "aria-label": label } }));
    } catch (error) {
      replace(holder, banner({ kind: "bad", text: messageOf(error) }));
    }
  };
  return { el: h("div", { class: "player-part" }, h("div", { class: "player-head" }, h("strong", { text: label }), download), holder), load };
}

export function openRecording(row) {
  const who = row.owner_name || row.owner_email || "this person";
  const reason = textArea("Reason", {
    rows: 3,
    maxLength: 500,
    value: lastReason,
    placeholder: "For example: Checking a disputed transcript for a complaint review.",
  });
  const confirm = checkbox("I understand that opening this audio is written in the audit log, with my name and reason.");
  const urls = [];

  const content = h(
    "div",
    { class: "stack" },
    banner({
      kind: "warn",
      title: `This audio belongs to ${who} and their patient`,
      text: "Open it only when there is a clear need, such as a complaint or a safety review. Your name, the time and your reason are saved in the audit log, and so is every download.",
    }),
    reason.el,
    confirm.el,
  );

  const view = openDialog({
    title: `Recording from ${dateTime(row.recorded_at)}`,
    body: [content],
    wide: true,
    onClose: () => urls.forEach((url) => URL.revokeObjectURL(url)),
    actions: [
      { label: "Cancel", variant: "quiet", result: false },
      {
        label: "Open audio",
        variant: "primary",
        icon: "play",
        onClick: async ({ showError }) => {
          reason.setError("");
          if (reason.value().length < 10) {
            reason.setError("Give a clear reason of at least 10 characters.");
            return false;
          }
          if (!confirm.value()) {
            showError("Tick the box to confirm you understand that opening the audio is recorded.");
            return false;
          }
          const opened = await unlockRecording(row.scribe_id, reason.value(), true);
          lastReason = reason.value();
          const parts = opened.parts ?? [];
          const rows = parts.map((part) => partRow(row, part, parts.length, urls));
          replace(
            content,
            h(
              "dl",
              { class: "facts" },
              h("dt", { text: "Clinician" }),
              h("dd", { text: opened.owner_name || who }),
              opened.title ? [h("dt", { text: "Label" }), h("dd", { text: opened.title })] : null,
              h("dt", { text: "Length" }),
              h("dd", { text: clock(Number(opened.duration_seconds) || 0) }),
            ),
            rows.map((item) => item.el),
            h("p", { class: "field-hint", text: "Access to this audio ends after 15 minutes. Open it again with a reason if you need more time." }),
          );
          const foot = view.dialog.querySelector(".dialog-foot");
          if (foot) replace(foot, button("Close", { variant: "primary", onClick: () => view.close(true) }));
          for (const item of rows) await item.load();
          return false;
        },
      },
    ],
  });
  return view;
}
