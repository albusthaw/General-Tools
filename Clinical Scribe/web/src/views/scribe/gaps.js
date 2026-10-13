// Where a recording paused by itself (a call, other sound, a locked iPhone) and
// nothing was recorded. Shown on the recorder card while recording, on the
// processing screen and in History, next to the transcript and the note that mark
// each place as an information gap.
import { banner } from "../../components/feedback.js";
import { h } from "../../lib/dom.js";
import { gapText } from "../../lib/gaps.js";

/**
 * gaps: [{ at, seconds, reason }] (lib/gaps.js). live: while recording. noun: what
 * was recorded, for the title ("recording" or "voice note").
 */
export function gapsBanner(gaps, { live = false, noun = "recording" } = {}) {
  if (!gaps?.length) return null;
  const one = gaps.length === 1;
  const times = one ? "once" : `${gaps.length} times`;
  const where = one ? "Nothing was recorded at this place." : "Nothing was recorded at these places.";
  const marked = one ? "point it out as an information gap." : "point out each one as an information gap.";
  const box = banner({
    kind: "warn",
    title: live ? `The ${noun} paused by itself ${times} so far` : `The ${noun} paused by itself ${times}`,
    text: `${where} The transcript and the note ${live ? "will " : ""}${marked}`,
    children: h("ul", { class: "gap-list" }, gaps.map((gap) => h("li", { text: gapText(gap) }))),
  });
  box.classList.add("gaps-banner");
  return box;
}
