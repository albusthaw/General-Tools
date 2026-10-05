// Stand-in AI services for automated tests. It answers the same requests the
// Edge Functions send to Gemini, ElevenLabs, DeepSeek and the Supabase Management
// API, so the whole app can be tested without real keys or costs.
//
// Run: node tests/mock-ai/server.mjs [port]   (default 54399)
// Test helpers: GET /__log, POST /__reset, POST /__fail {"match": "...", "status": 503, "times": 1}
// (add "query": "..." to fail only requests whose query string holds that text)
// Management API state for the deploy tests: GET or POST /__auth_config, POST /__project
// {"status": "..."}, POST /__api_keys [...], GET /__secrets.

import http from "node:http";

const port = Number(process.argv[2] ?? process.env.MOCK_AI_PORT ?? 54399);
const host = process.env.MOCK_AI_HOST ?? "0.0.0.0";

const NEW_PROJECT_AUTH = {
  site_url: "http://localhost:3000",
  uri_allow_list: "",
  disable_signup: false,
  external_email_enabled: true,
  password_min_length: 6,
  password_required_characters: "",
  external_google_enabled: false,
  external_google_client_id: "",
};

let log = [];
let failures = [];
let interactions = new Map();
let files = new Map();
let authConfig = { ...NEW_PROJECT_AUTH };
let projectStatus = "ACTIVE_HEALTHY";
let apiKeys = [];
let functionSecrets = {};
let counter = 0;

const VALID_KEYS = new Set(["test-gemini-key-0001", "test-elevenlabs-key-0001", "test-deepseek-key-0001", "sbp_test_management_token_0001"]);

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function takeFailure(path, search) {
  const index = failures.findIndex((f) => path.includes(f.match) && (!f.query || search.includes(f.query)) && f.times > 0);
  if (index < 0) return null;
  failures[index].times -= 1;
  return failures[index];
}

function keyFrom(req) {
  const auth = req.headers["authorization"] ?? "";
  return req.headers["x-goog-api-key"] ?? req.headers["xi-api-key"] ?? (auth.startsWith("Bearer ") ? auth.slice(7) : "");
}

// A fixed conversation so tests can check the transcript.
const CONVERSATION = [
  ["speaker_0", "Good morning, what brings you in today?"],
  ["speaker_1", "I have had a cough for two weeks and a mild fever since Monday."],
  ["speaker_0", "Any shortness of breath or chest pain?"],
  ["speaker_1", "No chest pain, a little breathless on the stairs."],
  ["speaker_0", "Your temperature is 37.9 and your chest sounds clear. I think this is a viral infection. Take paracetamol 1 gram up to four times a day and come back if it gets worse."],
];

// A fixed dictation (one speaker, spoken punctuation) for Voice Notes.
const DICTATION = "Blood pressure review full stop Reading today 128 over 82 full stop Continue ramipril 5 milligrams once a day full stop New paragraph Review in three months";

// The marks that show which instructions a request carried.
const DICTATION_RULES = /dictation by one clinician speaking alone/;
const DICTATION_TRANSCRIBE = /transcribe a clinician's dictation/i;
const DICTATION_TEMPLATE = /fill in from the clinician's own dictation/;

function elevenWords(diarize = true) {
  const words = [];
  let t = 0;
  if (!diarize) {
    // Without speaker separation the words carry no speaker.
    for (const word of DICTATION.split(" ")) {
      words.push({ text: word, type: "word", start: t, end: t + 0.3, logprob: -0.1 });
      words.push({ text: " ", type: "spacing", start: t + 0.3, end: t + 0.35, logprob: 0 });
      t += 0.35;
    }
    return words;
  }
  for (const [speaker, sentence] of CONVERSATION) {
    const parts = sentence.split(" ");
    parts.forEach((word, i) => {
      words.push({ text: word, type: "word", start: t, end: t + 0.3, speaker_id: speaker, logprob: -0.1 });
      t += 0.35;
      if (i < parts.length - 1) words.push({ text: " ", type: "spacing", start: t, end: t, speaker_id: speaker, logprob: 0 });
    });
    words.push({ text: " ", type: "spacing", start: t, end: t + 0.5, speaker_id: speaker, logprob: 0 });
    t += 0.5;
  }
  return words;
}

function headingsFrom(text) {
  const match = text.match(/<template>([\s\S]*?)<\/template>/);
  const template = match ? match[1] : "";
  return template
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z][A-Za-z /&()-]{1,60}:$/.test(line))
    .map((line) => line.slice(0, -1));
}

function noteFor(prompt, dictation = false) {
  const headings = headingsFrom(prompt);
  const list = headings.length ? headings : ["Summary"];
  const lines = dictation
    ? ["- Blood pressure review.", "- Reading today 128/82. Continue ramipril 5 mg once a day.", "- Review in three months."]
    : ["- Cough for two weeks with mild fever since Monday.", "- Temperature 37.9. Chest clear.", "- Viral infection likely. Paracetamol 1 g up to four times a day; return if worse."];
  return list.map((heading, i) => `${heading}:\n${lines[Math.min(i, 2)]}`).join("\n\n");
}

function templateFor(prompt, dictation = false) {
  const wantsChanges = prompt.includes("<changes>");
  if (dictation) {
    return JSON.stringify({
      name: wantsChanges ? "Clinic letter (revised)" : "Clinic letter",
      description: "A letter to the family doctor after a clinic visit.",
      body: [
        "Reason for the letter:",
        "[Why the patient was seen and by whom.]",
        "",
        "Findings:",
        "[What the clinician dictated about the history, examination and results.]",
        "",
        "Plan:",
        "[Treatment, changes to medicines, tests and follow-up.]",
        wantsChanges ? "\nRequests for the family doctor:\n[Anything the family doctor is asked to do.]" : "",
      ].join("\n"),
    });
  }
  return JSON.stringify({
    name: wantsChanges ? "Medical clerking note (revised)" : "Medical clerking note",
    description: "Full admission clerking for a new patient.",
    body: [
      "Presenting complaint:",
      "[Main problem in the patient's words and how long it has been present.]",
      "",
      "History of presenting complaint:",
      "[Onset, duration, character, severity, aggravating and relieving factors, associated symptoms.]",
      "",
      "Past medical history:",
      "[Previous illnesses, operations and admissions.]",
      "",
      "Drug history and allergies:",
      "[Current medicines with doses; allergies and reactions.]",
      "",
      "Impression:",
      "[Working diagnosis and differentials.]",
      "",
      "Plan:",
      "[Investigations, treatment, referrals and follow-up.]",
      wantsChanges ? "\nSocial history:\n[Smoking, alcohol, occupation, home situation.]" : "",
    ].join("\n"),
  });
}

function textOf(input) {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n");
  return "";
}

function completedInteraction(id, body) {
  const model = String(body.model ?? "");
  const prompt = textOf(body.input);
  const system = String(body.system_instruction ?? "");
  const usage = { total_input_tokens: 1200, total_output_tokens: 300, input_tokens_by_modality: [] };
  if (/transcribe/.test(model)) {
    usage.input_tokens_by_modality = [{ modality: "AUDIO", tokens: 32 * 20 }];
    // Without the speaker setting the model hears one person: the dictation.
    if (!body.generation_config?.transcription_config?.mode?.diarization_mode) {
      const annotations = DICTATION.split(" ").map((word) => ({ type: "word_info", text: word }));
      return { id, status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: DICTATION, annotations }] }], usage };
    }
    const annotations = [];
    for (const [speaker, sentence] of CONVERSATION) {
      for (const word of sentence.split(" ")) annotations.push({ type: "word_info", text: word, speaker: speaker === "speaker_0" ? "spk_1" : "spk_2" });
    }
    return {
      id,
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: CONVERSATION.map((c) => c[1]).join(" "), annotations }] }],
      usage,
    };
  }
  let text;
  if (body.response_format) text = templateFor(prompt, DICTATION_TEMPLATE.test(system));
  else if (Array.isArray(body.input) && body.input.some((part) => part.type === "audio")) {
    text = DICTATION_TRANSCRIBE.test(system)
      ? DICTATION
      : CONVERSATION.map(([speaker, sentence]) => `${speaker === "speaker_0" ? "Clinician" : "Patient"}: ${sentence}`).join("\n");
    usage.input_tokens_by_modality = [{ modality: "AUDIO", tokens: 32 * 20 }];
  } else text = noteFor(prompt, DICTATION_RULES.test(system));
  return {
    id,
    status: "completed",
    output_text: text,
    steps: [{ type: "user_input", content: [{ type: "text", text: "(input)" }] }, { type: "model_output", content: [{ type: "text", text }] }],
    usage,
  };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const raw = await readBody(req);
  const entry = { method: req.method, path, query: url.search, at: Date.now(), size: raw.length };
  if (!path.startsWith("/__")) log.push(entry);

  // Test controls
  if (path === "/__log") return send(res, 200, log);
  if (path === "/__reset") {
    log = [];
    failures = [];
    interactions = new Map();
    files = new Map();
    authConfig = { ...NEW_PROJECT_AUTH };
    projectStatus = "ACTIVE_HEALTHY";
    functionSecrets = {};
    return send(res, 200, { ok: true });
  }
  if (path === "/__fail") {
    failures.push(JSON.parse(raw.toString() || "{}"));
    return send(res, 200, { ok: true });
  }
  if (path === "/__auth_config") {
    if (req.method === "POST") authConfig = { ...NEW_PROJECT_AUTH, ...JSON.parse(raw.toString() || "{}") };
    return send(res, 200, authConfig);
  }
  if (path === "/__project") {
    projectStatus = JSON.parse(raw.toString() || "{}").status ?? "ACTIVE_HEALTHY";
    return send(res, 200, { ok: true });
  }
  if (path === "/__api_keys") {
    apiKeys = JSON.parse(raw.toString() || "[]");
    return send(res, 200, { ok: true });
  }
  if (path === "/__secrets") return send(res, 200, functionSecrets);

  const injected = takeFailure(path, url.search);
  if (injected) return send(res, injected.status ?? 503, { error: { message: injected.message ?? "Injected failure" } });

  const key = keyFrom(req);
  const needsKey = !url.searchParams.has("upload_id");
  if (needsKey && !VALID_KEYS.has(key)) {
    return send(res, path.startsWith("/v1/projects") ? 401 : 401, { error: { message: "API key not valid. Please pass a valid API key." } });
  }

  // ---- Gemini Files API
  if (path === "/upload/v1beta/files" && req.method === "POST" && !url.searchParams.has("upload_id")) {
    if (req.headers["x-goog-upload-command"] !== "start") return send(res, 400, { error: { message: "bad upload command" } });
    const id = `f${++counter}`;
    files.set(id, { name: `files/${id}`, mime: req.headers["x-goog-upload-header-content-type"], state: "PROCESSING" });
    res.setHeader("x-goog-upload-url", `http://${req.headers.host}/upload/v1beta/files?upload_id=${id}`);
    return send(res, 200, {});
  }
  if (path === "/upload/v1beta/files" && url.searchParams.has("upload_id")) {
    const id = url.searchParams.get("upload_id");
    const file = files.get(id);
    if (!file || raw.length === 0) return send(res, 400, { error: { message: "no upload" } });
    file.size = raw.length;
    return send(res, 200, { file: { name: file.name, uri: `http://${req.headers.host}/v1beta/${file.name}`, mimeType: file.mime, state: "PROCESSING" } });
  }
  const fileMatch = path.match(/^\/v1beta\/files\/(f\d+)$/);
  if (fileMatch) {
    const file = files.get(fileMatch[1]);
    if (req.method === "DELETE") {
      files.delete(fileMatch[1]);
      return send(res, 200, {});
    }
    if (!file) return send(res, 404, { error: { message: "file not found" } });
    file.state = "ACTIVE";
    return send(res, 200, { name: file.name, state: file.state });
  }

  // ---- Gemini models
  if (path === "/v1beta/models" && req.method === "GET") {
    return send(res, 200, {
      models: [
        { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash" },
        { name: "models/gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
        { name: "models/gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview" },
        { name: "models/gemini-3.5-transcribe", displayName: "Gemini 3.5 Transcribe" },
        { name: "models/gemini-3.5-transcribe-live", displayName: "Gemini 3.5 Transcribe Live" },
        { name: "models/gemini-3.8-flash-tts", displayName: "Gemini 3.8 Flash TTS" },
        { name: "models/gemini-embedding-001", displayName: "Embedding" },
      ],
    });
  }

  // ---- Gemini Interactions API
  if (path === "/v1beta/interactions" && req.method === "POST") {
    const body = JSON.parse(raw.toString() || "{}");
    // Which instructions the request carried, for the tests to check.
    const system = String(body.system_instruction ?? "");
    entry.dictation = DICTATION_RULES.test(system) || DICTATION_TRANSCRIBE.test(system) || DICTATION_TEMPLATE.test(system);
    const transcription = body.generation_config?.transcription_config;
    if (transcription) entry.diarization = transcription.mode?.diarization_mode ?? "none";
    const audio = Array.isArray(body.input) ? body.input.find((part) => part.type === "audio") : null;
    if (audio && typeof audio.data === "string") {
      // Audio sent inline (the model test): it must be base64 WAV.
      if (audio.mime_type !== "audio/wav" || !Buffer.from(audio.data, "base64").subarray(0, 4).equals(Buffer.from("RIFF"))) {
        return send(res, 400, { error: { message: "Inline audio could not be read." } });
      }
    } else if (audio) {
      const fileId = String(audio.uri ?? "").split("/").pop();
      if (!files.has(fileId)) return send(res, 400, { error: { message: "The audio file was not found." } });
    }
    if (String(body.model).includes("missing")) return send(res, 404, { error: { message: "models/missing is not found for API version v1beta" } });
    const id = `interactions/i${++counter}`;
    if (!body.background) return send(res, 200, completedInteraction(id, body));
    interactions.set(id, { body, polls: 0 });
    return send(res, 200, { id, status: "in_progress" });
  }
  const interactionMatch = path.match(/^\/v1beta\/(interactions\/i\d+)$/);
  if (interactionMatch) {
    const id = interactionMatch[1];
    if (req.method === "DELETE") {
      interactions.delete(id);
      return send(res, 200, {});
    }
    const item = interactions.get(id);
    if (!item) return send(res, 404, { error: { message: "not found" } });
    item.polls += 1;
    if (item.polls < 2) return send(res, 200, { id, status: "in_progress" });
    return send(res, 200, completedInteraction(id, item.body));
  }

  // ---- ElevenLabs speech to text
  if (path === "/v1/speech-to-text" && req.method === "POST") {
    const type = req.headers["content-type"] ?? "";
    if (!type.startsWith("multipart/form-data")) return send(res, 400, { detail: { message: "multipart required" } });
    const bodyText = raw.toString("latin1");
    const model = (bodyText.match(/name="model_id"\r\n\r\n([^\r]+)/) ?? [])[1] ?? "";
    const diarize = (bodyText.match(/name="diarize"\r\n\r\n([^\r]+)/) ?? [])[1] ?? "";
    entry.diarize = diarize;
    if (!/^scribe_/.test(model)) return send(res, 400, { detail: { status: "invalid_model", message: `Model ${model} is not found or not supported` } });
    if (bodyText.includes('filename="check.wav"')) {
      return send(res, 200, { language_code: "en", language_probability: 0.5, text: "", words: [], audio_duration_secs: 1 });
    }
    // Without speaker separation ElevenLabs hears one person: the dictation.
    const oneVoice = diarize === "false";
    const words = elevenWords(!oneVoice);
    return send(res, 200, {
      language_code: "en",
      language_probability: 0.99,
      text: oneVoice ? DICTATION : CONVERSATION.map((c) => c[1]).join(" "),
      words,
      transcription_id: `t${++counter}`,
      audio_duration_secs: 20.5,
    });
  }

  // ---- DeepSeek
  if (path === "/models" && req.method === "GET") {
    return send(res, 200, { object: "list", data: [{ id: "deepseek-flash", object: "model" }, { id: "deepseek-v4-pro", object: "model" }] });
  }
  if (path === "/chat/completions" && req.method === "POST") {
    const body = JSON.parse(raw.toString() || "{}");
    const user = String(body.messages?.find((m) => m.role === "user")?.content ?? "");
    const system = String(body.messages?.find((m) => m.role === "system")?.content ?? "");
    entry.dictation = DICTATION_RULES.test(system) || DICTATION_TEMPLATE.test(system);
    const text = body.response_format ? templateFor(user, DICTATION_TEMPLATE.test(system)) : noteFor(user, DICTATION_RULES.test(system));
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const pieces = text.match(/.{1,40}/gs) ?? [];
    for (const piece of pieces) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 250 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  // ---- Supabase Management API: project, API keys, function secrets, auth config
  const projectMatch = path.match(/^\/v1\/projects\/([a-z]{20})(\/[a-z/-]+)?$/);
  if (projectMatch) {
    const [, ref, rest = ""] = projectMatch;
    if (rest === "" && req.method === "GET") {
      return send(res, 200, { id: ref, ref, name: "Clinical Scribe test", status: projectStatus });
    }
    if (rest === "/api-keys" && req.method === "GET") {
      const reveal = url.searchParams.get("reveal") === "true";
      return send(res, 200, apiKeys.map((key) => (key.type === "secret" && !reveal ? { ...key, api_key: `${key.api_key.slice(0, 14)}••••••••` } : key)));
    }
    if (rest === "/secrets" && req.method === "POST") {
      const list = JSON.parse(raw.toString() || "[]");
      if (!Array.isArray(list) || list.some((item) => typeof item?.name !== "string" || typeof item?.value !== "string" || item.name.startsWith("SUPABASE_"))) {
        return send(res, 400, { message: "Invalid secrets" });
      }
      for (const item of list) functionSecrets[item.name] = item.value;
      return send(res, 201, "");
    }
    if (rest === "/config/auth" && req.method === "GET") return send(res, 200, authConfig);
    if (rest === "/config/auth" && req.method === "PATCH") {
      authConfig = { ...authConfig, ...JSON.parse(raw.toString() || "{}") };
      return send(res, 200, authConfig);
    }
  }

  return send(res, 404, { error: { message: `No mock for ${req.method} ${path}` } });
}

http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, 500, { error: { message: String(error) } }));
}).listen(port, host, () => {
  console.log(`Mock AI services listening on http://${host}:${port}`);
});
