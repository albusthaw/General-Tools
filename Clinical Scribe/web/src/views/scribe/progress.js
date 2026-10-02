// Shows what happens after Finish: saving audio, transcribing, writing the note,
// then the note and transcript. It checks the server every few seconds while
// the page is open; the work itself carries on even if the page is closed.
import { button, withBusy } from "../../components/button.js";
import { noteCard, transcriptCard } from "../../components/cards.js";
import { banner, chip, toast } from "../../components/feedback.js";
import { getNotes, getScribe, getSegments, retryNote, retryScribe } from "../../lib/api/scribes.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";
import { href } from "../../lib/router.js";
import { onQueueChange, pendingFor, status as queueStatus } from "../../lib/uploads/queue.js";
import { refreshContext } from "../app.js";
import { anotherNoteForm } from "./another-note.js";

const POLL_MS = 3000;

function stepItem(label, state, detail = "") {
  const glyph = state === "done"
    ? icon("check")
    : state === "active"
    ? h("span", { class: "spinner small", attrs: { "aria-hidden": "true" } })
    : state === "failed"
    ? icon("close")
    : h("span", { class: "step-dot", attrs: { "aria-hidden": "true" } });
  const stateText = { done: "done", active: "in progress", failed: "needs attention", waiting: "waiting", skipped: "skipped" }[state] ?? state;
  return h(
    "li",
    { class: ["step", `is-${state}`] },
    h("span", { class: "step-icon" }, glyph),
    h("span", { class: "step-text" }, h("span", { class: "step-label", text: label }), h("span", { class: "visually-hidden", text: `, ${stateText}` }), detail ? h("span", { class: "step-detail", text: detail }) : null),
  );
}

function stepsFor({ scribe, segments, notes, localPending, refusal }) {
  const total = segments.length || scribe.segment_count || 0;
  const doneParts = segments.filter((s) => s.status === "done").length;
  const anyNoteDone = notes.some((n) => n.status === "done");
  const noteBusy = notes.some((n) => n.status === "queued" || n.status === "writing");
  const allNotesFailed = notes.length > 0 && notes.every((n) => n.status === "failed");

  let saving = "active";
  let savingDetail = localPending > 0 ? `${localPending} ${localPending === 1 ? "part" : "parts"} left to send` : "Almost done";
  if (refusal) {
    saving = "failed";
    savingDetail = "";
  } else if (scribe.status !== "recording") {
    saving = "done";
    savingDetail = "";
  }

  let transcribing = "waiting";
  let transcribingDetail = "";
  if (scribe.status === "processing") {
    transcribing = "active";
    transcribingDetail = total > 1 ? `Part ${Math.min(doneParts + 1, total)} of ${total}` : "";
  } else if (scribe.status === "transcribed") transcribing = "done";
  else if (scribe.status === "failed") transcribing = "failed";

  let writing = "waiting";
  let writingDetail = "";
  if (scribe.status === "transcribed") {
    if (anyNoteDone) writing = "done";
    else if (noteBusy) writing = "active";
    else if (allNotesFailed) writing = "failed";
    else {
      writing = "skipped";
      writingDetail = "Note writing is not set up yet";
    }
  }
  const ready = anyNoteDone || writing === "skipped" ? "done" : "waiting";

  return [
    stepItem("Saving audio", saving, savingDetail),
    stepItem("Transcribing", transcribing, transcribingDetail),
    stepItem("Writing note", writing, writingDetail),
    stepItem("Ready", ready),
  ];
}

export function renderProgress(stage, scribeId, { templates, notice = null, onNewRecording }) {
  let timer = null;
  let stopped = false;
  let refusal = null;
  let shownNotes = new Set();
  let firstDraw = true;

  const stopQueue = onQueueChange((event) => {
    if (event.scribeId && event.scribeId !== scribeId) return;
    if (event.type === "finish_refused") refusal = event.error;
    if (["uploaded", "finished", "finish_refused", "error"].includes(event.type)) schedule(200);
  });

  function schedule(ms) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(load, ms);
  }

  function onVisible() {
    if (document.visibilityState === "visible") schedule(100);
  }
  document.addEventListener("visibilitychange", onVisible);

  async function load() {
    if (stopped) return;
    if (document.visibilityState === "hidden") return;
    try {
      const [scribe, segments, notes, localPending] = await Promise.all([
        getScribe(scribeId),
        getSegments(scribeId),
        getNotes(scribeId),
        pendingFor(scribeId),
      ]);
      if (stopped) return;
      if (!scribe) {
        replace(stage, banner({ kind: "info", title: "This recording is no longer here", text: "It may have been deleted." }), h("div", { class: "btn-row" }, button("New recording", { variant: "primary", icon: "mic", onClick: onNewRecording })));
        return;
      }
      draw(scribe, segments, notes, localPending);
      const busy = scribe.status === "recording" || scribe.status === "processing" || notes.some((n) => n.status === "queued" || n.status === "writing");
      if (busy && !refusal) schedule(POLL_MS);
      else if (scribe.status === "transcribed") refreshContext();
    } catch (error) {
      replace(stage, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: () => schedule(0) } }));
      schedule(POLL_MS * 3);
    }
  }

  function draw(scribe, segments, notes, localPending) {
    const done = notes.some((n) => n.status === "done");
    const failed = scribe.status === "failed";
    const heading = refusal ? "Not processed yet" : failed ? "Processing stopped" : done ? "Your note is ready" : scribe.status === "transcribed" ? "Transcript ready" : "Processing";

    const problems = [];
    if (refusal) {
      problems.push(banner({ kind: "bad", title: "The recording was saved but not processed", text: messageOf(refusal) }));
    }
    if (failed) {
      problems.push(banner({
        kind: "bad",
        title: "Transcription did not finish",
        text: scribe.error_message || "Please try again.",
        action: {
          label: "Try again",
          icon: "refresh",
          onClick: (event) => withBusy(event.currentTarget, async () => {
            try {
              await retryScribe(scribeId);
              schedule(0);
            } catch (error) {
              toast(messageOf(error), "bad", 6000);
            }
          }),
        },
      }));
    }
    if (!queueStatus().running && localPending > 0 && navigator.onLine === false) {
      problems.push(banner({ kind: "warn", title: "You are offline", text: "The audio is kept on this device and will be sent when the connection is back." }));
    }

    const progress = h(
      "section",
      { class: "glass-card card progress-card", attrs: { "aria-labelledby": "progress-title" } },
      h(
        "div",
        { class: "card-head" },
        h("div", {}, h("h2", { attrs: { id: "progress-title" }, text: heading }), scribe.title ? h("p", { class: "card-sub", text: scribe.title }) : null),
        done ? chip("Ready", "green", "check") : failed || refusal ? chip("Needs attention", "red") : chip("Working", "blue"),
      ),
      h("ol", { class: "steps", attrs: { "aria-live": "polite" } }, stepsFor({ scribe, segments, notes, localPending, refusal })),
      !done && !failed && !refusal ? h("p", { class: "progress-note" }, icon("info"), h("span", { text: "You can close this page. The work carries on and the note will be waiting in History." })) : null,
      h(
        "div",
        { class: "card-foot" },
        h("a", { class: "btn", href: href(`/history/${scribeId}`) }, icon("history"), h("span", { text: "Open in History" })),
        button("New recording", { icon: "mic", variant: done || failed || refusal ? "primary" : "", onClick: onNewRecording }),
      ),
    );

    const noteCards = notes.map((note) => {
      const isNew = !firstDraw && !shownNotes.has(note.id) && note.status === "done";
      return noteCard(note, {
        highlight: isNew,
        onRetry: async (n) => {
          await retryNote(n.id);
          schedule(0);
        },
      });
    });
    shownNotes = new Set(notes.filter((n) => n.status === "done").map((n) => n.id));
    firstDraw = false;

    replace(
      stage,
      h(
        "div",
        { class: "stack" },
        notice ? banner({ kind: notice.kind, text: notice.text }) : null,
        problems,
        progress,
        noteCards,
        scribe.status === "transcribed" ? anotherNoteForm(scribeId, templates, () => schedule(0)) : null,
        scribe.status === "transcribed" && scribe.transcript ? transcriptCard(scribe.transcript, { collapsed: notes.length > 0 }) : null,
      ),
    );
  }

  load();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopQueue();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
