// AI settings: service keys, which service and model does each job, recording
// limits, and shared templates.
import { button, withBusy } from "../../components/button.js";
import { banner, chip, loading, pageHead, toast } from "../../components/feedback.js";
import { fieldGroup, segmented, selectField, switchRow } from "../../components/fields.js";
import { config } from "../../config.js";
import { checkZeroRetention, getSettings, modelCatalog, refreshModels, testModels, updateSettings, usageSummary } from "../../lib/api/admin.js";
import { h, replace } from "../../lib/dom.js";
import { messageOf } from "../../lib/errors.js";
import { relative } from "../../lib/format.js";
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

function transcriptionCard(s, models) {
  let provider = s.transcription_provider;
  const providerControl = segmented("Transcription service", [{ value: "elevenlabs", label: "ElevenLabs" }, { value: "gemini", label: "Gemini" }], {
    value: provider,
    onChange: (v) => {
      provider = v;
      elevenBox.hidden = v !== "elevenlabs";
      geminiBox.hidden = v !== "gemini";
    },
  });
  const eleven = models.picker("ElevenLabs model", "elevenlabs", "transcription", s.elevenlabs_model);
  const gemini = models.picker("Gemini model", "gemini", "transcription", s.gemini_transcription_model);
  const zero = switchRow("Ask ElevenLabs not to keep recordings", {
    description: "Zero retention: ElevenLabs keeps no copy of the audio or the transcript. ElevenLabs allows it only for Enterprise accounts, so it is checked with ElevenLabs when you switch it on.",
    checked: s.elevenlabs_zero_retention,
  });
  // Switching it on asks ElevenLabs first; an account that refuses it keeps it off.
  const zeroNote = h("p", { class: "field-hint", attrs: { role: "status" } });
  let checking = false;
  zero.input.addEventListener("change", async () => {
    zeroNote.textContent = "";
    zeroNote.classList.remove("field-error");
    if (!zero.input.checked) return;
    checking = true;
    zero.input.disabled = true;
    zeroNote.textContent = "Checking with ElevenLabs…";
    try {
      const result = await checkZeroRetention(eleven.value());
      zero.input.checked = Boolean(result?.ok);
      zeroNote.textContent = result?.message ?? "";
      zeroNote.classList.toggle("field-error", !result?.ok);
    } catch (error) {
      zero.input.checked = false;
      zeroNote.textContent = messageOf(error);
      zeroNote.classList.add("field-error");
    } finally {
      checking = false;
      zero.input.disabled = false;
    }
  });
  const elevenBox = h("div", { class: "stack" }, eleven.el, zero.el, zeroNote);
  const geminiBox = h("div", { class: "stack" }, gemini.el);
  elevenBox.hidden = provider !== "elevenlabs";
  geminiBox.hidden = provider !== "gemini";
  const language = selectField("Main language of consultations", LANGUAGES, { value: s.transcription_language });

  const card = settingsCard({
    id: "transcription-title",
    iconName: "waveform",
    title: "Transcription",
    children: [fieldGroup("Service", providerControl.el, "Credit is counted separately for each service."), elevenBox, geminiBox, language.el],
    onSave: () => {
      if (!eleven.validate() || !gemini.validate()) return null;
      if (checking) {
        toast("Wait until ElevenLabs has answered, then save.", "bad");
        return null;
      }
      return {
        transcription_provider: provider,
        elevenlabs_model: eleven.value(),
        gemini_transcription_model: gemini.value(),
        elevenlabs_zero_retention: zero.value(),
        transcription_language: language.value(),
      };
    },
  });
  return {
    card,
    elevenlabsModel: () => eleven.value(),
    current: () => ({ provider, model: provider === "elevenlabs" ? eleven.value() : gemini.value() }),
  };
}

function writingCard(s, models) {
  let provider = s.note_provider;
  const providerControl = segmented("Note service", [{ value: "gemini", label: "Gemini" }, { value: "deepseek", label: "DeepSeek" }], {
    value: provider,
    onChange: (v) => {
      provider = v;
      geminiBox.hidden = v !== "gemini";
      deepseekBox.hidden = v !== "deepseek";
    },
  });
  const gemini = models.picker("Gemini model", "gemini", "text", s.gemini_note_model);
  const deepseek = models.picker("DeepSeek model", "deepseek", "text", s.deepseek_note_model);
  const geminiBox = h("div", {}, gemini.el);
  const deepseekBox = h("div", {}, deepseek.el);
  geminiBox.hidden = provider !== "gemini";
  deepseekBox.hidden = provider !== "deepseek";
  const reasoning = switchRow("Careful reasoning", { description: "Slower, and may cost more, but can help with complex consultations.", checked: s.note_reasoning });
  const spelling = segmented("Spelling", [{ value: "en-GB", label: "British English" }, { value: "en-US", label: "American English" }], { value: s.note_spelling });

  const card = settingsCard({
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
  return { card, current: () => ({ provider, model: provider === "gemini" ? gemini.value() : deepseek.value() }) };
}

function templateHelperCard(s, models) {
  let provider = s.template_provider;
  const providerControl = segmented("Template service", [{ value: "gemini", label: "Gemini" }, { value: "deepseek", label: "DeepSeek" }], {
    value: provider,
    onChange: (v) => {
      provider = v;
      geminiBox.hidden = v !== "gemini";
      deepseekBox.hidden = v !== "deepseek";
    },
  });
  const gemini = models.picker("Gemini model", "gemini", "text", s.gemini_template_model);
  const deepseek = models.picker("DeepSeek model", "deepseek", "text", s.deepseek_template_model);
  const geminiBox = h("div", {}, gemini.el);
  const deepseekBox = h("div", {}, deepseek.el);
  geminiBox.hidden = provider !== "gemini";
  deepseekBox.hidden = provider !== "deepseek";

  const card = settingsCard({
    id: "template-helper-title",
    iconName: "template",
    title: "Template helper",
    children: [fieldGroup("Service", providerControl.el), geminiBox, deepseekBox],
    onSave: () => {
      if (!gemini.validate() || !deepseek.validate()) return null;
      return { template_provider: provider, gemini_template_model: gemini.value(), deepseek_template_model: deepseek.value() };
    },
  });
  return { card, current: () => ({ provider, model: provider === "gemini" ? gemini.value() : deepseek.value() }) };
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

// The saved model lists, and every model choice on the page, so one update can
// refresh them all.
function modelLists(lists) {
  let current = lists;
  const pickers = [];
  const find = (provider, purpose) => current.find((list) => list.provider === provider && list.purpose === purpose);
  return {
    picker(label, provider, purpose, value) {
      const picker = modelPicker(label, { value, models: find(provider, purpose)?.models ?? [] });
      pickers.push({ picker, provider, purpose });
      return picker;
    },
    update(next) {
      current = next;
      for (const { picker, provider, purpose } of pickers) picker.setModels(find(provider, purpose)?.models ?? []);
    },
    updatedAt() {
      const times = current.filter((list) => list.source === "service" && list.updated_at).map((list) => list.updated_at);
      return times.length ? times.sort().pop() : null;
    },
  };
}

const JOBS = { transcription: "Transcription", notes: "Notes", templates: "Template helper" };
const SERVICES = { elevenlabs: "ElevenLabs", gemini: "Gemini", deepseek: "DeepSeek" };

function modelsCard(models, chosen) {
  const updated = h("p", { class: "field-hint" });
  const results = h("div", { class: "stack model-results", attrs: { "aria-live": "polite" } });
  const showUpdated = () => {
    const at = models.updatedAt();
    updated.textContent = at ? `Lists updated ${relative(at)}.` : "The lists have not been updated from the services yet. Until then, the models known to work are shown.";
  };
  showUpdated();

  const refreshBtn = button("Update model lists", { icon: "refresh" });
  refreshBtn.addEventListener("click", () =>
    withBusy(refreshBtn, async () => {
      try {
        const fresh = await refreshModels();
        models.update(fresh.lists ?? []);
        showUpdated();
        replace(results, (fresh.problems ?? []).map((problem) => banner({ kind: "warn", text: `${SERVICES[problem.provider] ?? problem.provider}: ${problem.message}` })));
        toast("Model lists updated.");
      } catch (error) {
        replace(results, banner({ kind: "bad", text: messageOf(error) }));
      }
    })
  );

  const testBtn = button("Test chosen models", { icon: "checkCircle" });
  testBtn.addEventListener("click", () =>
    withBusy(testBtn, async () => {
      replace(results, loading("Sending each chosen model a tiny request…"));
      try {
        const outcome = await testModels(chosen());
        replace(
          results,
          h(
            "ul",
            { class: "test-results" },
            (outcome.results ?? []).map((result) =>
              h(
                "li",
                { class: ["test-result", result.ok ? "ok" : "bad"] },
                icon(result.ok ? "checkCircle" : "xCircle"),
                h("div", {}, h("strong", { text: `${JOBS[result.job] ?? result.job}: ${SERVICES[result.provider] ?? result.provider}, ${result.model}` }), h("p", { text: result.message })),
              )
            ),
          ),
        );
      } catch (error) {
        replace(results, banner({ kind: "bad", text: messageOf(error) }));
      }
    })
  );

  return h(
    "section",
    { class: "glass-card card", attrs: { "aria-labelledby": "models-title" } },
    h("div", { class: "card-head" }, h("h2", { attrs: { id: "models-title" } }, icon("refresh"), h("span", { text: "AI models" })), chip("Lists from each service", "")),
    h(
      "div",
      { class: "stack settings-body" },
      h("p", { text: "Update the lists to see the models each service offers now. Models marked as recommended are known to work well for each job. Testing sends each model chosen below a tiny request, saved or not, and costs almost nothing." }),
      updated,
      h("div", { class: "button-row" }, refreshBtn, testBtn),
      results,
    ),
  );
}

export async function renderAiSettings(container) {
  const body = h("div", { class: "stack" }, loading("Loading settings…"));
  replace(container, pageHead("AI settings"), body);

  async function load() {
    try {
      const [data, usage, catalog] = await Promise.all([getSettings(), usageSummary().catch(() => null), modelCatalog().catch(() => null)]);
      const s = data.settings;
      const models = modelLists(catalog?.lists ?? []);
      const transcription = transcriptionCard(s, models);
      const notes = writingCard(s, models);
      const templates = templateHelperCard(s, models);
      const chosen = () => ({ transcription: transcription.current(), notes: notes.current(), templates: templates.current() });
      replace(
        body,
        statusStrip(data, usage),
        keysCard(data.secrets ?? {}, { onChanged: load, elevenlabsModel: transcription.elevenlabsModel }),
        modelsCard(models, chosen),
        transcription.card,
        notes.card,
        templates.card,
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
