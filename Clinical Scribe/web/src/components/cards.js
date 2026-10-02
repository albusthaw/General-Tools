// Note and transcript cards, shared by the Scribe screen, History and record review.
import { copyText } from "../lib/clipboard.js";
import { h } from "../lib/dom.js";
import { dateTime } from "../lib/format.js";
import { icon } from "../lib/icons.js";
import { button, withBusy } from "./button.js";
import { banner, chip, toast } from "./feedback.js";
import { appHooks } from "../lib/platform/hooks.js";
import { noteView, transcriptView } from "./text-view.js";

export function copyButton(getText, { label = "Copy", copiedLabel = "Copied", onCopied, variant = "", size = "small" } = {}) {
  const btn = button(label, { icon: "copy", variant, size });
  btn.addEventListener("click", async () => {
    const ok = await copyText(getText());
    if (ok) {
      if (appHooks.copied) appHooks.copied(btn);
      else toast(copiedLabel);
      onCopied?.();
    } else {
      toast("Copying did not work. Select the text and copy it instead.", "bad");
    }
  });
  return btn;
}

/** note: { id, template_name, status, content, error_message, created_at, completed_at } */
export function noteCard(note, { onCopied, onRetry, highlight = false } = {}) {
  const head = h(
    "div",
    { class: "card-head" },
    h(
      "div",
      {},
      h("h3", {}, icon("noteWrite"), h("span", { text: note.template_name })),
      h("p", { class: "card-sub", text: note.completed_at ? `Written ${dateTime(note.completed_at)}` : `Asked for ${dateTime(note.created_at)}` }),
    ),
    note.status === "done" ? copyButton(() => note.content ?? "", { label: "Copy note", copiedLabel: "Note copied", onCopied: () => onCopied?.(note) }) : null,
  );

  let body;
  if (note.status === "done") {
    body = noteView(note.content);
  } else if (note.status === "failed") {
    body = banner({
      kind: "bad",
      title: "This note could not be written",
      text: note.error_message || "Please try again.",
      action: onRetry ? { label: "Try again", icon: "refresh", onClick: (event) => withBusy(event.currentTarget, () => onRetry(note)) } : null,
    });
  } else {
    body = h(
      "div",
      { class: "writing", attrs: { role: "status" } },
      h("span", { class: "spinner", attrs: { "aria-hidden": "true" } }),
      h("span", { text: note.status === "writing" ? "Writing the note…" : "Waiting to write the note…" }),
    );
  }

  return h("article", { class: ["glass-card", "card", "note-card", highlight && "is-new"] }, head, body);
}

export function transcriptCard(text, { collapsed = true, onCopied } = {}) {
  const content = transcriptView(text);
  const region = h("div", { class: "transcript-body", hidden: collapsed }, content);
  const toggle = button(collapsed ? "Show transcript" : "Hide transcript", {
    icon: collapsed ? "chevronDown" : "chevronDown",
    variant: "quiet",
    size: "small",
    attrs: { "aria-expanded": String(!collapsed) },
  });
  toggle.addEventListener("click", () => {
    const open = region.hidden;
    region.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector("span").textContent = open ? "Hide transcript" : "Show transcript";
    toggle.classList.toggle("is-open", open);
  });
  return h(
    "article",
    { class: "glass-card card transcript-card" },
    h(
      "div",
      { class: "card-head" },
      h("div", {}, h("h3", {}, icon("waveform"), h("span", { text: "Transcript" })), h("p", { class: "card-sub", text: "Word for word, as recorded." })),
      h("div", { class: "btn-row" }, toggle, copyButton(() => text ?? "", { label: "Copy transcript", copiedLabel: "Transcript copied", onCopied })),
    ),
    region,
  );
}

export function statusChip(status) {
  switch (status) {
    case "recording":
      return chip("Not finished", "amber");
    case "processing":
      return chip("Processing", "blue");
    case "transcribed":
      return chip("Ready", "green");
    case "failed":
      return chip("Needs attention", "red");
    default:
      return chip(status);
  }
}
