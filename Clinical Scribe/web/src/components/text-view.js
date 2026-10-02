// Shows notes and transcripts as readable text: section headings in bold, list
// lines indented, speaker labels highlighted. Everything is set as plain text.
import { h } from "../lib/dom.js";

const HEADING = /^[^\n:]{1,60}:$/;
const SPEAKER = /^((?:Speaker \d+|Speaker|Clinician|Patient|Doctor|Nurse|Relative|Carer|Interpreter|Parent|Other)(?: \d+)?):\s?(.*)$/i;

// A small space for a blank line, so sections are separated without big gaps.
function gap() {
  return h("span", { class: "gap", attrs: { "aria-hidden": "true" } });
}

export function noteView(text) {
  const box = h("div", { class: "text-block" });
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      box.append(gap());
    } else if (HEADING.test(trimmed)) {
      box.append(h("span", { class: "heading-line", text: trimmed }));
    } else if (/^[-•*]\s+/.test(trimmed)) {
      box.append(h("span", { class: "list-line", text: `• ${trimmed.replace(/^[-•*]\s+/, "")}` }));
    } else {
      box.append(h("span", { class: "line", text: line }));
    }
  }
  return box;
}

export function transcriptView(text) {
  const box = h("div", { class: "text-block transcript" });
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      box.append(gap());
      continue;
    }
    const match = line.match(SPEAKER);
    if (match) {
      box.append(h("span", { class: "line" }, h("span", { class: "speaker", text: `${match[1]}: ` }), match[2]));
    } else {
      box.append(h("span", { class: "line", text: line }));
    }
  }
  return box;
}
