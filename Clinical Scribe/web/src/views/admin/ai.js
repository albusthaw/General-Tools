// AI settings: service keys, which service and model does each job, recording
// limits, and shared templates.
import { button, withBusy } from "../../components/button.js";
import { banner, loading, pageHead, toast } from "../../components/feedback.js";
import { fieldGroup, segmented, selectField, switchRow } from "../../components/fields.js";
import { config } from "../../config.js";
import { getSettings, updateSettings, usageSummary } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { icon } from "../../lib/icons.js";
import { refreshContext } from "../app.js";
import { keysCard } from "./ai-keys.js";
import { modelPicker } from "./model-picker.js";
import { sharedTemplatesCard } from "./shared-templates.js";

const LANGUAGES = [
  ["", "Detect automatically"],
  ["en-GB", "English (UK)"],
  ["en-US", "English (US)"],
  ["ar", "Arabic"],
  ["bn", "Bengali"],
  ["my", "Burmese"],
  ["zh", "Chinese"],
  ["fr", "French"],
  ["de", "German"],
  ["hi", "Hindi"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["ms", "Malay"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["es", "Spanish"],
  ["ta", "Tamil"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["ur", "Urdu"],
  ["vi", "Vietnamese"],
].map(([value, label]) => ({ value, label }));

function settingsCard({ id, iconName, title, children, onSave }) {
  const saveBtn = button("Save changes", { variant: "primary", icon: "check" });
  const error = h("p", { class: "field-error", attrs: { role: "alert" }, hidden: true });
  saveBtn.addEventListener("click", () =>
    withBusy(saveBtn, async () => {
      error.hidden = true;
      try {
        const changes = onSave();
        if (!changes) return;
        await updateSettings(changes);
        toast("Settings saved.");
        await refreshContext();
      } catch (err) {
        error.textContent = messageOf(err);
        error.hidden = false;
      }
    })
  );
  return h(
    "section",
    { class: "glass-card card", attrs: { "aria-labelledby": id } },
    h("div", { class: "card-head" }, h("h2", { attrs: { id } }, icon(iconName), h("span", { text: title }))),
    h("div", { class: "stack settings-body" }, children),
    error,
    h("div", { class: "card-foot" }, saveBtn),
  );
}

function transcriptionCard(s) {
  let provider = s.transcription_provider;
  const providerControl = segmented("Transcription service", [{ value: "elevenlabs", label: "ElevenLabs" }, { value: "gemini", label: "Gemini" }], {
    value: provider,
    onChange: (v) => {
      provider = v;
      elevenBox.hidden = v !== "elevenlabs";
      geminiBox.hidden = v !== "gemini";
    },
  });
  const eleven = modelPicker("ElevenLabs model", { provider: "elevenlabs", purpose: "transcription", value: s.elevenlabs_model });
  const gemini = modelPicker("Gemini model", { provider: "gemini", purpose: "transcription", value: s.gemini_transcription_model });
  const zero = switchRow("Ask ElevenLabs not to keep recordings", { description: "Zero retention. Only some ElevenLabs plans allow it; others will refuse the recording.", checked: s.elevenlabs_zero_retention });
  const elevenBox = h("div", { class: "stack" }, eleven.el, zero.el);
  const geminiBox = h("div", { class: "stack" }, gemini.el);
  elevenBox.hidden = provider !== "elevenlabs";
  geminiBox.hidden = provider !== "gemini";
  const language = selectField("Main language of consultations", LANGUAGES, { value: s.transcription_language });
  eleven.load();
  gemini.load();

  const card = settingsCard({
    id: "transcription-title",
    iconName: "waveform",
    title: "Transcription",
    children: [fieldGroup("Service", providerControl.el, "Credit is counted separately for each service."), elevenBox, geminiBox, language.el],
    onSave: () => {
      if (!eleven.validate() || !gemini.validate()) return null;
      return {
        transcription_provider: provider,
        elevenlabs_model: eleven.value(),
        gemini_transcription_model: gemini.value(),
        elevenlabs_zero_retention: zero.value(),
        transcription_language: language.value(),
      };
    },
  });
  return { card, elevenlabsModel: () => eleven.value() };
}

function writingCard(s) {
  let provider = s.note_provider;
  const providerControl = segmented("Note service", [{ value: "gemini", label: "Gemini" }, { value: "deepseek", label: "DeepSeek" }], {
    value: provider,
    onChange: (v) => {
      provider = v;
      geminiBox.hidden = v !== "gemini";
      deepseekBox.hidden = v !== "deepseek";
    },
  });
  const gemini = modelPicker("Gemini model", { provider: "gemini", purpose: "text", value: s.gemini_note_model });
  const deepseek = modelPicker("DeepSeek model", { provider: "deepseek", purpose: "text", value: s.deepseek_note_model });
  const geminiBox = h("div", {}, gemini.el);
  const deepseekBox = h("div", {}, deepseek.el);
  geminiBox.hidden = provider !== "gemini";
  deepseekBox.hidden = provider !== "deepseek";
  const reasoning = switchRow("Careful reasoning", { description: "Slower, and may cost more, but can help with complex consultations.", checked: s.note_reasoning });
  const spelling = segmented("Spelling", [{ value: "en-GB", label: "British English" }, { value: "en-US", label: "American English" }], { value: s.note_spelling });
  gemini.load();
  deepseek.load();

  return settingsCard({
    id: "notes-title",
    iconName: "noteWrite",
    title: "Notes",
    children: [fieldGroup("Service", providerControl.el), geminiBox, deepseekBox, reasoning.el, fieldGroup("Spelling in notes", spelling.el)],
    onSave: () => {
      if (!gemini.validate() || !deepseek.validate()) return null;
      return {
        note_provider: provider,
        gemini_note_model: gemini.value(),
        deepseek_note_model: deepseek.value(),
        note_reasoning: reasoning.value(),
        note_spelling: spelling.value(),
      };
    },
  });
}

function templateHelperCard(s) {
  let provider = s.template_provider;
  const providerControl = segmented("Template service", [{ value: "gemini", label: "Gemini" }, { value: "deepseek", label: "DeepSeek" }], {
    value: provider,
    onChange: (v) => {
      provider = v;
      geminiBox.hidden = v !== "gemini";
      deepseekBox.hidden = v !== "deepseek";
    },
  });
  const gemini = modelPicker("Gemini model", { provider: "gemini", purpose: "text", value: s.gemini_template_model });
  const deepseek = modelPicker("DeepSeek model", { provider: "deepseek", purpose: "text", value: s.deepseek_template_model });
  const geminiBox = h("div", {}, gemini.el);
  const deepseekBox = h("div", {}, deepseek.el);
  geminiBox.hidden = provider !== "gemini";
  deepseekBox.hidden = provider !== "deepseek";
  gemini.load();
  deepseek.load();

  return settingsCard({
    id: "template-helper-title",
    iconName: "template",
    title: "Template helper",
    children: [fieldGroup("Service", providerControl.el), geminiBox, deepseekBox],
    onSave: () => {
      if (!gemini.validate() || !deepseek.validate()) return null;
      return { template_provider: provider, gemini_template_model: gemini.value(), deepseek_template_model: deepseek.value() };
    },
  });
}

function recordingCard(s) {
  const retention = selectField("Keep audio after transcription", [
    { value: "0", label: "Delete once the transcript is ready" },
    { value: "7", label: "7 days" },
    { value: "30", label: "30 days" },
    { value: "-1", label: "Keep until the recording is deleted" },
  ], { value: String(s.audio_retention_days) });
  const longest = selectField("Longest recording", [30, 60, 90, 120, 180, 240, 360].map((m) => ({ value: String(m), label: m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? "hour" : "hours"}` })), { value: String(s.max_recording_minutes) });
  const idle = selectField("Sign out after no activity for", [
    { value: "15", label: "15 minutes" },
    { value: "30", label: "30 minutes" },
    { value: "60", label: "1 hour" },
    { value: "120", label: "2 hours" },
    { value: "0", label: "Never" },
  ], { value: String(s.idle_signout_minutes) });
  return settingsCard({
    id: "recording-title",
    iconName: "timer",
    title: "Recordings and sign-in",
    children: [h("div", { class: "form-grid" }, retention.el, longest.el), idle.el],
    onSave: () => ({
      audio_retention_days: Number(retention.value()),
      max_recording_minutes: Number(longest.value()),
      idle_signout_minutes: Number(idle.value()),
    }),
  });
}

function statusStrip(data, usage) {
  const items = [];
  if (!data.worker_connected) {
    items.push(banner({ kind: "bad", title: "Background processing is not connected", text: "Recordings will not be processed. Run the deploy again to connect it." }));
  }
  if (data.server_version && data.server_version !== config.appVersion) {
    items.push(banner({ kind: "warn", title: "The app and the server are on different versions", text: `App ${config.appVersion}, server ${data.server_version}. Run the update again so both match.` }));
  }
  if (usage) {
    items.push(
      h(
        "section",
        { class: "glass-card card usage-card", attrs: { "aria-label": "This month" } },
        h("div", { class: "usage-grid" }, [
          ["Recordings", usage.recordings],
          ["Minutes transcribed", usage.transcribed_minutes],
          ["Notes written", usage.notes],
          ["Templates drafted", usage.templates_drafted],
        ].map(([label, value]) => h("div", { class: "usage-item" }, h("span", { class: "usage-value tabular", text: String(value ?? 0) }), h("span", { class: "usage-label", text: label })))),
        h("p", { class: "field-hint", text: `This month · App version ${config.appVersion}` }),
      ),
    );
  }
  return items;
}

export async function renderAiSettings(container) {
  const body = h("div", { class: "stack" }, loading("Loading settings…"));
  replace(container, pageHead("AI settings"), body);

  async function load() {
    try {
      const [data, usage] = await Promise.all([getSettings(), usageSummary().catch(() => null)]);
      const s = data.settings;
      const transcription = transcriptionCard(s);
      replace(
        body,
        statusStrip(data, usage),
        keysCard(data.secrets ?? {}, { onChanged: load, elevenlabsModel: transcription.elevenlabsModel }),
        transcription.card,
        writingCard(s),
        templateHelperCard(s),
        recordingCard(s),
        sharedTemplatesCard(),
        h("p", { class: "field-hint privacy-note" }, icon("info"), h("span", { text: "Use paid plans for each AI service. Free plans may keep or use the data they receive." })),
      );
      refreshContext();
    } catch (error) {
      replace(body, banner({ kind: "bad", text: messageOf(error), action: { label: "Try again", onClick: load } }));
    }
  }
  await load();
}
