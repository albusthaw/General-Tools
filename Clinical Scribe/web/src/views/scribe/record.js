// The Scribe tab: choose a template, record, then follow the processing until
// the note is ready.
import { button, withBusy } from "../../components/button.js";
import { confirmDialog } from "../../components/dialog.js";
import { banner, chip, pageHead } from "../../components/feedback.js";
import { selectField, textField } from "../../components/fields.js";
import { discardScribe } from "../../lib/api/scribes.js";
import { listTemplates } from "../../lib/api/templates.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { clock, minutes, timeOnly } from "../../lib/format.js";
import { icon } from "../../lib/icons.js";
import * as recorder from "../../lib/recorder/recorder.js";
import { isAdmin, profile, store } from "../../lib/store.js";
import { dropScribe, requestFinish } from "../../lib/uploads/queue.js";
import { refreshContext } from "../app.js";
import { scribeTabs } from "../shell.js";
import { renderProgress } from "./progress.js";
import { defaultTemplateId, templateOptions } from "./template-options.js";

const CURRENT_KEY = "cs-current-scribe";
const NOTICES = {
  near_credit: { kind: "warn", text: "About 2 minutes of transcription time are left. The recording will finish by itself when they run out." },
  near_max: { kind: "warn", text: "About 2 minutes are left before the longest allowed recording. It will finish by itself." },
  credit_reached: { kind: "info", text: "Your transcription minutes ran out, so the recording was finished." },
  max_reached: { kind: "info", text: "The longest allowed recording was reached, so the recording was finished." },
  mic_ended: { kind: "info", text: "The microphone stopped, so the recording was finished." },
};

function lastTemplateKey() {
  return `cs-last-template-${profile()?.id ?? ""}`;
}

function rememberTemplate(id) {
  try {
    localStorage.setItem(lastTemplateKey(), id);
  } catch {
    // Not important.
  }
}

function rememberedTemplate() {
  try {
    return localStorage.getItem(lastTemplateKey());
  } catch {
    return null;
  }
}

export function currentScribe() {
  try {
    return sessionStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

function setCurrentScribe(id) {
  try {
    if (id) sessionStorage.setItem(CURRENT_KEY, id);
    else sessionStorage.removeItem(CURRENT_KEY);
  } catch {
    // Not important.
  }
}

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

function interruptedBanners(onChange) {
  const list = store.get().interrupted ?? [];
  return list.map((item) => {
    const box = banner({
      kind: "warn",
      title: "A recording was interrupted",
      text: `The recording${item.title ? ` "${item.title}"` : ""} started at ${timeOnly(item.startedAt)} was not finished. The audio that was saved can still be processed.`,
    });
    const actions = h("div", { class: "btn-row" });
    const keep = button("Process the saved audio", { size: "small", variant: "primary" });
    keep.addEventListener("click", () =>
      withBusy(keep, async () => {
        await requestFinish(item.scribeId, null);
        store.set({ interrupted: (store.get().interrupted ?? []).filter((x) => x.scribeId !== item.scribeId) });
        setCurrentScribe(item.scribeId);
        onChange();
      })
    );
    const drop = button("Delete it", { size: "small", variant: "quiet danger-text" });
    drop.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Delete this recording?",
        message: "The saved audio will be deleted and cannot be recovered.",
        confirmLabel: "Delete recording",
        danger: true,
      });
      if (!ok) return;
      await dropScribe(item.scribeId);
      await discardScribe(item.scribeId).catch(() => {});
      store.set({ interrupted: (store.get().interrupted ?? []).filter((x) => x.scribeId !== item.scribeId) });
      onChange();
    });
    actions.append(keep, drop);
    box.querySelector(".banner-body").append(actions);
    return box;
  });
}

export async function renderRecord(container, route) {
  const stage = h("div", { class: "stage" });
  replace(container, pageHead("Scribe"), scribeTabs(route, "desktop-only"), stage);

  let templates = [];
  let templatesError = "";
  try {
    templates = await listTemplates();
  } catch (error) {
    templatesError = messageOf(error);
  }

  let cleanupStage = null;
  let lastPhase = null;

  const draw = (state) => {
    cleanupStage?.();
    cleanupStage = null;
    if (state.phase === "done" && state.scribeId) setCurrentScribe(state.scribeId);
    const showProgress = !recorder.isRecording() && state.phase !== "error" && (state.phase === "done" || currentScribe());
    if (showProgress && currentScribe()) {
      const notice = state.notice && NOTICES[state.notice] && !["near_credit", "near_max"].includes(state.notice) ? NOTICES[state.notice] : null;
      cleanupStage = renderProgress(stage, currentScribe(), {
        templates,
        notice,
        onNewRecording: () => {
          setCurrentScribe(null);
          recorder.reset();
          refreshContext().then(() => draw(recorder.recorderState()));
        },
      });
      return;
    }
    if (state.phase === "recording" || state.phase === "paused" || state.phase === "finishing") {
      cleanupStage = drawRecording(stage, state, templates);
      return;
    }
    cleanupStage = drawReady(stage, state, templates, templatesError, () => draw(recorder.recorderState()));
  };

  const stop = recorder.onRecorderChange((state) => {
    // Redraw when the phase changes; notices update the current view.
    if (state.phase !== lastPhase || state.phase === "error" || state.notice) {
      lastPhase = state.phase;
      draw(state);
    }
  });

  return () => {
    stop();
    cleanupStage?.();
  };
}

function drawReady(stage, state, templates, templatesError, redraw) {
  const context = store.get().context;
  const ready = context?.ready?.transcription;
  const credit = context?.credit;
  const options = templateOptions(templates);
  const templatePicker = selectField("Note template", options.length ? options : [{ value: "", label: "No templates available" }], {
    value: defaultTemplateId(templates, rememberedTemplate()),
  });
  const label = textField("Label (optional)", { placeholder: "For example: Room 3, 10:30 clinic", maxLength: 120, autocomplete: "off" });

  const lowCredit = credit && !credit.unlimited && credit.seconds_left < 30;
  const startButton = h(
    "button",
    {
      type: "button",
      class: "record-button",
      disabled: !ready || lowCredit || state.phase === "preparing",
      attrs: { "aria-label": "Start recording" },
    },
    h("span", { class: "record-ring", attrs: { "aria-hidden": "true" } }),
    icon("mic", { size: 34 }),
  );
  startButton.addEventListener("click", async () => {
    const templateId = templatePicker.value() || null;
    if (templateId) rememberTemplate(templateId);
    await recorder.start({ userId: profile().id, templateId, title: label.value() });
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

  replace(
    stage,
    h(
      "div",
      { class: "stack" },
      interruptedBanners(redraw),
      warnings,
      h(
        "section",
        { class: "glass-card card recorder-card", attrs: { "aria-labelledby": "new-recording-title" } },
        h("div", { class: "card-head" }, h("h2", { attrs: { id: "new-recording-title" }, text: "New recording" }), creditChip),
        h("div", { class: "form-grid" }, templatePicker.el, label.el),
        h(
          "div",
          { class: "record-start" },
          startButton,
          h("p", { class: "record-caption", text: state.phase === "preparing" ? "Starting…" : "Start recording" }),
          h("p", { class: "record-hint", text: "Keep this page open while you record. Audio is saved as you go." }),
        ),
      ),
    ),
  );
  return null;
}

function drawRecording(stage, state, templates) {
  const paused = state.phase === "paused";
  const finishing = state.phase === "finishing";
  const timer = h("p", { class: "timer tabular", attrs: { role: "timer", "aria-live": "off" }, text: clock(recorder.elapsedSeconds()) });
  const live = meter();
  const tick = setInterval(() => {
    timer.textContent = clock(recorder.elapsedSeconds());
  }, 250);

  const templateName = templates.find((t) => t.id === state.templateId)?.name ?? "No template";
  const notice = state.notice && NOTICES[state.notice] ? banner({ kind: NOTICES[state.notice].kind, text: NOTICES[state.notice].text }) : null;

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

  replace(
    stage,
    h(
      "div",
      { class: "stack" },
      notice,
      h(
        "section",
        { class: ["glass-card", "card", "recorder-card", "is-live", paused && "is-paused"], attrs: { "aria-label": "Recording" } },
        h(
          "div",
          { class: "live-status", attrs: { role: "status" } },
          h("span", { class: "live-dot", attrs: { "aria-hidden": "true" } }),
          h("span", { text: finishing ? "Saving the recording…" : paused ? "Paused" : "Recording" }),
        ),
        timer,
        live.el,
        h("p", { class: "live-meta" }, h("span", { text: templateName }), state.title ? h("span", { text: state.title }) : null),
        h("div", { class: "live-controls" }, pauseButton, finishButton),
        h("div", { class: "live-secondary" }, discardButton),
        h("p", { class: "record-hint", text: "Keep this screen open. Your audio is saved as you go." }),
      ),
    ),
  );

  return () => {
    clearInterval(tick);
    live.stop();
  };
}

