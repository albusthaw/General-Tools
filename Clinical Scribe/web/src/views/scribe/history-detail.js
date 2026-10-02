// One recording in History: its transcript and every note written from it.
import { button, withBusy } from "../../components/button.js";
import { noteCard, statusChip, transcriptCard } from "../../components/cards.js";
import { banner, loading, toast } from "../../components/feedback.js";
import { menuButton } from "../../components/menu.js";
import { finishScribe, getNotes, getScribe, retryNote, retryScribe } from "../../lib/api/scribes.js";
import { listTemplates } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { dateTime, duration, timeOnly } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { href, navigate } from "../../lib/router.js";
import { refreshContext } from "../app.js";
import { scribeTabs } from "../shell.js";
import { anotherNoteForm } from "./another-note.js";
import { deleteRecording, renameRecording } from "./recording-actions.js";

const POLL_MS = 4000;

export async function renderHistoryDetail(container, route) {
  const scribeId = route.params[0];
  const body = h("div", { class: "stack" }, loading("Loading the recording…"));
  replace(
    container,
    h("a", { class: "back-link", href: href("/history") }, icon("arrowLeft"), h("span", { text: "History" })),
    scribeTabs(route, "desktop-only"),
    body,
  );

  let templates = [];
  let timer = null;
  let stopped = false;
  listTemplates().then((list) => (templates = list)).catch(() => {});

  function schedule(ms) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(load, ms);
  }

  async function load() {
    try {
      const [scribe, notes] = await Promise.all([getScribe(scribeId), getNotes(scribeId)]);
      if (stopped) return;
      if (!scribe) {
        replace(body, banner({ kind: "info", title: "This recording is not available", text: "It may have been deleted." }));
        return;
      }
      if (!templates.length) templates = await listTemplates().catch(() => []);
      draw(scribe, notes);
      const busy = scribe.status === "processing" || notes.some((n) => n.status === "queued" || n.status === "writing");
      if (busy && document.visibilityState === "visible") schedule(POLL_MS);
    } catch (error) {
      replace(body, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: () => load() } }));
    }
  }

  function rename(scribe) {
    renameRecording(scribe, () => load());
  }

  function remove(scribe) {
    deleteRecording(scribe, () => navigate("/history"));
  }

  function statusBanner(scribe) {
    if (scribe.status === "recording") {
      const process = button("Process the saved audio", { variant: "primary", size: "small", icon: "upload" });
      process.addEventListener("click", () =>
        withBusy(process, async () => {
          try {
            await finishScribe(scribeId, null);
            await refreshContext();
            load();
          } catch (error) {
            toast(messageOf(error), "bad", 6000);
          }
        })
      );
      const box = banner({
        kind: "warn",
        title: "This recording was not finished",
        text: scribe.segment_count
          ? "The audio saved before it stopped can still be processed."
          : "No audio was saved for this recording.",
      });
      if (scribe.segment_count) box.querySelector(".banner-body").append(h("div", { class: "btn-row" }, process));
      return box;
    }
    if (scribe.status === "processing") {
      return banner({ kind: "info", title: "Being processed", text: "The transcript and note will appear here when they are ready. You can leave this page." });
    }
    if (scribe.status === "failed") {
      return banner({
        kind: "bad",
        title: "Transcription did not finish",
        text: scribe.error_message || "Please try again.",
        action: scribe.audio_deleted_at ? null : {
          label: "Try again",
          icon: "refresh",
          onClick: (event) => withBusy(event.currentTarget, async () => {
            try {
              await retryScribe(scribeId);
              await refreshContext();
              load();
            } catch (error) {
              toast(messageOf(error), "bad", 6000);
            }
          }),
        },
      });
    }
    return null;
  }

  function draw(scribe, notes) {
    const title = scribe.title || `Recording at ${timeOnly(scribe.started_at)}`;
    const head = h(
      "div",
      { class: "page-head detail-head" },
      h(
        "div",
        { class: "detail-title" },
        h("h1", { text: title, attrs: { tabindex: "-1" } }),
        h(
          "p",
          { class: "detail-meta" },
          h("span", { text: dateTime(scribe.started_at) }),
          scribe.duration_seconds ? h("span", { text: duration(scribe.duration_seconds) }) : null,
          statusChip(scribe.status),
        ),
      ),
      h(
        "div",
        { class: "head-actions" },
        menuButton({
          label: "Recording actions",
          items: [
            { label: "Rename", icon: "pencil", onClick: () => rename(scribe) },
            { label: "Delete recording", icon: "trash", danger: true, hidden: scribe.status === "processing", onClick: () => remove(scribe) },
          ],
        }),
      ),
    );

    const transcribed = scribe.status === "transcribed";
    replace(
      body,
      head,
      statusBanner(scribe),
      transcribed ? transcriptCard(scribe.transcript ?? "", { collapsed: false }) : null,
      transcribed ? anotherNoteForm(scribeId, templates, () => schedule(0)) : null,
      notes.length ? h("h2", { class: "section-title", text: notes.length === 1 ? "Note" : `Notes (${notes.length})` }) : null,
      notes.map((note) => noteCard(note, {
        onRetry: async (n) => {
          await retryNote(n.id);
          schedule(0);
        },
      })),
    );
  }

  function onVisible() {
    if (document.visibilityState === "visible") schedule(0);
  }
  document.addEventListener("visibilitychange", onVisible);
  await load();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
