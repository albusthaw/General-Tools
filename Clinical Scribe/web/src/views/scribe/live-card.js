// The card shown while recording: time, sound level, Pause or Resume, Finish and
// Discard, with the recording's type and template.
import { button } from "../../components/button.js";
import { modeChip } from "../../components/cards.js";
import { confirmDialog } from "../../components/dialog.js";
import { banner } from "../../components/feedback.js";
import { h, replace } from "../../lib/dom.js";
import { clock } from "../../lib/format.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { pausedMessage } from "../../lib/recorder/capture-rules.js";
import * as recorder from "../../lib/recorder/recorder.js";

function meter() {
  const bars = Array.from({ length: 28 }, () => h("span", { class: "meter-bar" }));
  const el = h("div", { class: "meter", attrs: { "aria-hidden": "true" } }, bars);
  const history = new Array(bars.length).fill(0);
  let frame = null;
  let last = 0;
  const draw = (now) => {
    frame = requestAnimationFrame(draw);
    if (now - last < 70) return;
    last = now;
    history.shift();
    history.push(recorder.level());
    history.forEach((value, i) => bars[i].style.setProperty("--level", String(Math.max(0.06, value))));
  };
  frame = requestAnimationFrame(draw);
  return { el, stop: () => cancelAnimationFrame(frame) };
}

/** notices: { [name]: { kind, text } } for messages the recorder may raise. */
export function drawRecording(stage, state, templates, notices) {
  const paused = state.phase === "paused";
  const finishing = state.phase === "finishing";
  const timer = h("p", { class: "timer tabular", attrs: { role: "timer", "aria-live": "off" }, text: clock(recorder.elapsedSeconds()) });
  const live = meter();
  const tick = setInterval(() => {
    timer.textContent = clock(recorder.elapsedSeconds());
  }, 250);

  const templateName = templates.find((t) => t.id === state.templateId)?.name ?? "No template";
  const notice = state.notice && notices[state.notice] ? banner({ kind: notices[state.notice].kind, text: notices[state.notice].text }) : null;
  // Why the recording paused by itself (a call, other sound, a locked screen).
  const why = paused ? pausedMessage(state.pauseReason) : null;
  const pausedNote = why ? banner({ kind: "warn", text: why }) : null;

  const pauseButton = button(paused ? "Resume" : "Pause", { icon: paused ? "play" : "pause", size: "large", disabled: finishing });
  pauseButton.addEventListener("click", () => (paused ? recorder.resume() : recorder.pause()));
  const finishButton = button(finishing ? "Saving…" : "Finish", { icon: "check", variant: "primary", size: "large", disabled: finishing });
  finishButton.addEventListener("click", () => recorder.finish());
  const discardButton = button("Discard", { icon: "trash", variant: "quiet danger-text", disabled: finishing });
  discardButton.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Discard this recording?",
      message: "The recording will be deleted and nothing will be transcribed.",
      confirmLabel: "Discard recording",
      danger: true,
    });
    if (ok) await recorder.discard();
  });

  const card = h(
    "section",
    { class: ["glass-card", "card", "recorder-card", "is-live", `is-${state.mode}`, paused && "is-paused"], attrs: { "aria-label": "Recording" } },
    h(
      "div",
      { class: "live-status", attrs: { role: "status" } },
      h("span", { class: "live-dot", attrs: { "aria-hidden": "true" } }),
      h("span", { text: finishing ? "Saving the recording…" : paused ? "Paused" : "Recording" }),
    ),
    timer,
    live.el,
    h("p", { class: "live-meta" }, modeChip(state.mode), h("span", { text: templateName }), state.title ? h("span", { text: state.title }) : null),
    h("div", { class: "live-controls" }, pauseButton, finishButton),
    h("div", { class: "live-secondary" }, discardButton),
    h("p", { class: "record-hint", text: "Keep this screen open. Your audio is saved as you go." }),
  );
  const extras = appHooks.recorderExtras?.(card, { phase: state.phase });
  replace(stage, h("div", { class: "stack" }, pausedNote, notice, card));

  return () => {
    clearInterval(tick);
    live.stop();
    extras?.();
  };
}
