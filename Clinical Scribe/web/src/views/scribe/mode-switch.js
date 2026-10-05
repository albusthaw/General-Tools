// The pair of cards at the top of both recording tabs, Clinical Scribe and Voice
// Note, each with its icon and a short line that tells them apart. The open tab's
// card is lit; the other one opens its tab.
import { button } from "../../components/button.js";
import { h } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";
import { MODE_LIST, modeOf } from "../../lib/modes.js";
import { href, navigate } from "../../lib/router.js";

export function modeSwitch(active) {
  return h(
    "nav",
    { class: "mode-switch", attrs: { "aria-label": "Ways to record" } },
    MODE_LIST.map((mode) =>
      h(
        "a",
        {
          class: ["mode-card", `is-${mode.id}`],
          href: href(mode.path),
          attrs: { "aria-current": mode.id === active ? "page" : null },
        },
        h("span", { class: "mode-icon" }, icon(mode.icon, { size: 22 })),
        h(
          "span",
          { class: "mode-text" },
          h("span", { class: "mode-name", text: mode.name }),
          h("span", { class: "mode-line", text: mode.line }),
        ),
      )
    ),
  );
}

// Shown on a recording tab while a recording of the other type is going on: one
// recording at a time, with a way back to it.
export function otherRecordingCard(recordingMode) {
  const other = modeOf(recordingMode);
  return h(
    "section",
    { class: ["glass-card", "card", "busy-card", `is-${other.id}`], attrs: { role: "status" } },
    h("span", { class: "busy-icon", attrs: { "aria-hidden": "true" } }, icon(other.icon, { size: 26 })),
    h(
      "div",
      { class: "busy-text" },
      h("h2", { text: other.busyTitle }),
      h("p", { text: "One recording at a time. Finish it before you start another one." }),
    ),
    button("Go to the recording", { variant: "primary", icon: "chevronRight", iconAfter: true, onClick: () => navigate(other.path) }),
  );
}
