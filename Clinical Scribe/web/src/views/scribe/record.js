// The two recording tabs, Clinical Scribe and Voice Note: choose a template of that
// type, record, then follow the processing until the note is ready. Only one
// recording runs at a time; the other tab says so and leads back to it.
import { chip, banner, pageHead } from "../../components/feedback.js";
import { selectField, textField } from "../../components/fields.js";
import { listTemplates } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { minutes } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import { modeOf } from "../../lib/modes.js";
import { appHooks } from "../../lib/platform/hooks.js";
import { refusedMessage } from "../../lib/recorder/capture-rules.js";
import * as recorder from "../../lib/recorder/recorder.js";
import { isAdmin, profile, store } from "../../lib/store.js";
import { refreshContext } from "../app.js";
import { scribeTabs } from "../shell.js";
import { interruptedBanners } from "./interrupted.js";
import { drawRecording } from "./live-card.js";
import { modeSwitch, otherRecordingCard } from "./mode-switch.js";
import { renderProgress } from "./progress.js";
import { currentScribe, rememberedTemplate, rememberTemplate, setCurrentScribe } from "./recording-memory.js";
import { defaultTemplateId, templateOptions, templatesOfMode } from "./template-options.js";

const NOTICES = {
  near_credit: { kind: "warn", text: "About 2 minutes of transcription time are left. The recording will finish by itself when they run out." },
  near_max: { kind: "warn", text: "About 2 minutes are left before the longest allowed recording. It will finish by itself." },
  credit_reached: { kind: "info", text: "Your transcription minutes ran out, so the recording was finished." },
  max_reached: { kind: "info", text: "The longest allowed recording was reached, so the recording was finished." },
  stopped_on_phone: { kind: "info", text: "The recording stopped on the phone. What was recorded is being saved." },
  resume_in_call: { kind: "warn", text: refusedMessage("in_call") },
  resume_mic: { kind: "warn", text: refusedMessage("mic") },
};
// Notices that only matter while recording.
const WHILE_RECORDING = new Set(["near_credit", "near_max", "resume_in_call", "resume_mic"]);
const LIVE = new Set(["recording", "paused", "finishing"]);
const IDLE = { phase: "idle", error: "", notice: "" };

export async function renderRecord(container, route) {
  const mode = modeOf(route.mode);
  const stage = h("div", { class: "stage" });
  replace(container, pageHead(mode.name), scribeTabs(route), modeSwitch(mode.id), stage);

  let templates = [];
  let templatesError = "";
  try {
    templates = templatesOfMode(await listTemplates(), mode.id);
  } catch (error) {
    templatesError = messageOf(error);
  }

  let cleanupStage = null;
  let lastPhase = null;

  const draw = (state) => {
    cleanupStage?.();
    cleanupStage = null;
    // The recorder holds one recording; it belongs to this tab or to the other one.
    const mine = state.mode === mode.id;
    if (recorder.isRecording() && !mine) {
      replace(stage, otherRecordingCard(state.mode));
      return;
    }
    if (mine && state.phase === "done" && state.scribeId) setCurrentScribe(mode.id, state.scribeId);
    const following = currentScribe(mode.id);
    if (!recorder.isRecording() && following && !(mine && state.phase === "error")) {
      const notice = mine && state.notice && NOTICES[state.notice] && !WHILE_RECORDING.has(state.notice) ? NOTICES[state.notice] : null;
      cleanupStage = renderProgress(stage, following, {
        templates,
        notice,
        mode: mode.id,
        onNewRecording: () => {
          setCurrentScribe(mode.id, null);
          recorder.reset();
          refreshContext().then(() => draw(recorder.recorderState()));
        },
      });
      return;
    }
    if (mine && LIVE.has(state.phase)) {
      cleanupStage = drawRecording(stage, state, templates, NOTICES);
      return;
    }
    cleanupStage = drawReady(stage, mine ? state : IDLE, mode, templates, templatesError, () => draw(recorder.recorderState()));
  };

  const stop = recorder.onRecorderChange((state) => {
    // Redraw when the phase changes; notices update the current view.
    const key = `${state.mode}:${state.phase}`;
    if (key !== lastPhase || state.phase === "error" || state.notice) {
      lastPhase = key;
      draw(state);
    }
  });

  return () => {
    stop();
    cleanupStage?.();
  };
}

function drawReady(stage, state, mode, templates, templatesError, redraw) {
  const context = store.get().context;
  const ready = context?.ready?.transcription;
  const credit = context?.credit;
  const options = templateOptions(templates);
  const templatePicker = selectField("Note template", options.length ? options : [{ value: "", label: "No templates available" }], {
    value: defaultTemplateId(templates, rememberedTemplate(mode.id)),
  });
  const label = textField("Label (optional)", { placeholder: "For example: Room 3, 10:30 clinic", maxLength: 120, autocomplete: "off" });

  const lowCredit = credit && !credit.unlimited && credit.seconds_left < 30;
  const startButton = h(
    "button",
    {
      type: "button",
      class: ["record-button", `is-${mode.id}`],
      disabled: !ready || lowCredit || state.phase === "preparing",
      attrs: { "aria-label": mode.startLabel },
    },
    h("span", { class: "record-ring", attrs: { "aria-hidden": "true" } }),
    icon(mode.id === "voice" ? "voice" : "mic", { size: 34 }),
  );
  startButton.addEventListener("click", async () => {
    if (appHooks.beforeRecording && !(await appHooks.beforeRecording())) return;
    const templateId = templatePicker.value() || null;
    if (templateId) rememberTemplate(mode.id, templateId);
    await recorder.start({ userId: profile().id, templateId, title: label.value(), mode: mode.id });
  });

  const creditChip = credit
    ? credit.unlimited
      ? chip("Unlimited minutes", "blue", "timer")
      : chip(`${minutes(credit.seconds_left)} left`, credit.seconds_left < 600 ? "amber" : "blue", "timer")
    : null;

  const warnings = [];
  if (!ready) {
    warnings.push(banner({
      kind: "warn",
      title: "Transcription is not set up yet",
      text: isAdmin() ? "Add the service key for the transcription service in AI settings." : "Ask your administrator to finish setting up the service keys.",
      action: isAdmin() ? { label: "Open AI settings", onClick: () => (window.location.hash = "/admin/ai") } : null,
    }));
  } else if (lowCredit) {
    warnings.push(banner({ kind: "warn", title: "No transcription minutes left", text: "Ask your administrator to add more minutes." }));
  }
  if (state.phase === "error" && state.error) {
    warnings.push(banner({ kind: "bad", title: "Recording could not start", text: state.error }));
  }
  if (templatesError) warnings.push(banner({ kind: "bad", text: templatesError }));

  const card = h(
    "section",
    { class: ["glass-card", "card", "recorder-card", `is-${mode.id}`], attrs: { "aria-labelledby": "new-recording-title" } },
    h("div", { class: "card-head" }, h("h2", { attrs: { id: "new-recording-title" }, text: mode.newTitle }), creditChip),
    h("div", { class: "form-grid" }, templatePicker.el, label.el),
    h(
      "div",
      { class: "record-start" },
      startButton,
      h("p", { class: "record-caption", text: state.phase === "preparing" ? "Starting…" : mode.startLabel }),
      h("p", { class: "mode-hint" }, icon("info"), h("span", { text: mode.hint })),
      h("p", { class: "record-hint", text: "Keep this page open while you record. Audio is saved as you go." }),
    ),
  );
  appHooks.enhancePicker?.(templatePicker.input, { title: "Note template" });
  const extras = appHooks.recorderExtras?.(card, { phase: "ready" });
  replace(stage, h("div", { class: "stack" }, interruptedBanners(mode.id, redraw), warnings, card));
  return extras ?? null;
}
