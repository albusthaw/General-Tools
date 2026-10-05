// Turns audit entries into plain sentences. Entries about templates and records
// name their type (Clinical Scribe or Voice Note) when the entry carries it.
import { dateTime } from "../../lib/format.js";
import { modeOf } from "../../lib/modes.js";

const SERVICE = { elevenlabs: "ElevenLabs", gemini: "Gemini", deepseek: "DeepSeek" };
const SECRET = {
  gemini_api_key: "Gemini key",
  elevenlabs_api_key: "ElevenLabs key",
  deepseek_api_key: "DeepSeek key",
  smtp_password: "email password",
  management_token: "Supabase access token",
};
const ROLE = { admin: "Admin", user: "User" };
const SETTING_LABELS = {
  transcription_provider: "Transcription service",
  elevenlabs_model: "ElevenLabs model",
  gemini_transcription_model: "Gemini transcription model",
  transcription_language: "Main language",
  elevenlabs_zero_retention: "ElevenLabs zero retention",
  note_provider: "Note service",
  gemini_note_model: "Gemini note model",
  deepseek_note_model: "DeepSeek note model",
  note_reasoning: "Careful reasoning",
  note_spelling: "Spelling in notes",
  template_provider: "Template service",
  gemini_template_model: "Gemini template model",
  deepseek_template_model: "DeepSeek template model",
  audio_retention_days: "Keep audio",
  max_recording_minutes: "Longest recording",
  idle_signout_minutes: "Sign out after",
};

export const GROUPS = [
  { value: "", label: "All activity" },
  { value: "review", label: "Record reviews" },
  { value: "recording", label: "Recording audio" },
  { value: "user", label: "People" },
  { value: "credit", label: "Transcription minutes" },
  { value: "settings", label: "AI settings" },
  { value: "secret", label: "Service keys" },
  { value: "template", label: "Shared templates" },
  { value: "signin", label: "Google sign-in" },
  { value: "email", label: "Email settings" },
  { value: "scribe", label: "Deleted recordings" },
  { value: "account", label: "New accounts" },
  { value: "server", label: "Updates" },
];

function person(name, email) {
  return name || email || "someone";
}

// "the shared Voice Note template", or "the shared template" for older entries.
function templateWords(d, kind = "") {
  return ["the", kind, d.mode ? modeOf(d.mode).name : "", "template"].filter(Boolean).join(" ");
}

function addType(details, d) {
  if (d.mode) details.push(["Type", modeOf(d.mode).name]);
}

function settingValue(key, value) {
  if (value === null || value === undefined || value === "") return key === "transcription_language" ? "Detect automatically" : "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (SERVICE[value]) return SERVICE[value];
  if (key === "audio_retention_days") return value === 0 ? "Delete once transcribed" : value === -1 ? "Keep" : `${value} days`;
  if (key === "idle_signout_minutes") return value === 0 ? "Never" : `${value} minutes`;
  if (key === "max_recording_minutes") return `${value} minutes`;
  if (key === "note_spelling") return value === "en-US" ? "American English" : "British English";
  return String(value);
}

/** Returns { text, details: [[label, value]] } for one audit entry. */
export function describe(entry) {
  const actor = person(entry.actor_name, entry.actor_email);
  const target = person(entry.target_name, entry.target_email);
  const d = entry.details ?? {};
  const details = [];
  let text;

  switch (entry.action) {
    case "account.first_admin":
      text = `${actor} became the first administrator`;
      break;
    case "user.created":
      text = `${actor} added ${target} as ${ROLE[d.role] ?? d.role}`;
      if (d.unlimited) details.push(["Minutes", "Unlimited"]);
      else details.push(["Starting minutes", `ElevenLabs ${d.elevenlabs_minutes ?? 0}, Gemini ${d.gemini_minutes ?? 0}`]);
      break;
    case "user.role_changed":
      text = `${actor} changed ${target}'s role from ${ROLE[d.from] ?? d.from} to ${ROLE[d.to] ?? d.to}`;
      break;
    case "user.password_changed":
      text = `${actor} changed ${target}'s password`;
      break;
    case "user.suspended":
      text = `${actor} suspended ${target}`;
      break;
    case "user.restored":
      text = `${actor} restored ${target}`;
      break;
    case "user.approved":
      text = `${actor} approved ${target}`;
      break;
    case "user.removed":
      text = `${actor} removed ${target}`;
      if (d.recordings !== undefined) details.push(["Recordings deleted", String(d.recordings)]);
      break;
    case "credit.changed": {
      const service = SERVICE[d.service] ?? d.service;
      if (d.mode === "set") text = `${actor} set ${target}'s ${service} minutes to ${d.minutes}`;
      else if (Number(d.minutes) < 0) text = `${actor} took ${Math.abs(d.minutes)} ${service} minutes from ${target}`;
      else text = `${actor} added ${d.minutes} ${service} minutes for ${target}`;
      if (d.balance_minutes !== undefined) details.push(["New balance", `${d.balance_minutes} minutes`]);
      if (d.note) details.push(["Note", d.note]);
      break;
    }
    case "credit.unlimited_changed":
      text = `${actor} switched unlimited minutes ${d.unlimited ? "on" : "off"} for ${target}`;
      break;
    case "secret.saved":
      text = `${actor} saved the ${SECRET[d.secret] ?? "key"}`;
      break;
    case "secret.removed":
      text = `${actor} removed the ${SECRET[d.secret] ?? "key"}`;
      break;
    case "secret.checked":
      text = `${actor} checked the ${SECRET[d.secret] ?? "key"}: ${d.ok ? "it works" : "it did not work"}`;
      break;
    case "recording.opened":
      text = `${actor} opened the audio of ${target}'s recording${d.title ? ` "${d.title}"` : ""}`;
      addType(details, d);
      if (d.recorded_at) details.push(["Recorded", dateTime(d.recorded_at)]);
      if (d.parts !== undefined) details.push(["Parts", String(d.parts)]);
      break;
    case "recording.downloaded":
      text = `${actor} downloaded part ${d.part ?? ""} of the audio of ${target}'s recording${d.title ? ` "${d.title}"` : ""}`;
      addType(details, d);
      if (d.recorded_at) details.push(["Recorded", dateTime(d.recorded_at)]);
      break;
    case "settings.models_refreshed":
      text = `${actor} updated the AI model lists`;
      break;
    case "settings.clinic_name_changed":
      text = d.to ? `${actor} set the clinic name shown in the apps to "${d.to}"` : `${actor} removed the clinic name shown in the apps`;
      if (d.from) details.push(["Before", d.from]);
      break;
    case "settings.ai_updated":
      text = `${actor} changed AI settings`;
      for (const [key, change] of Object.entries(d)) {
        details.push([SETTING_LABELS[key] ?? key, `${settingValue(key, change?.from)} → ${settingValue(key, change?.to)}`]);
      }
      break;
    case "signin.google_updated":
      text = `${actor} switched Google sign-in ${d.enabled ? "on" : "off"}`;
      if (d.client_id) details.push(["Client ID", d.client_id]);
      break;
    case "email.settings_saved":
      text = `${actor} saved the email settings`;
      if (d.host) details.push(["Server", `${d.host}:${d.port}`]);
      break;
    case "template.shared_created":
      text = `${actor} created ${templateWords(d, "shared")} "${d.name}"`;
      break;
    case "template.shared_updated":
      text = `${actor} changed ${templateWords(d, "shared")} "${d.name}"`;
      break;
    case "template.shared_archived":
      text = `${actor} archived ${templateWords(d, "shared")} "${d.name}"`;
      break;
    case "template.shared_restored":
      text = `${actor} restored ${templateWords(d, "shared")} "${d.name}"`;
      break;
    case "template.default_changed":
      text = `${actor} made "${d.name}" ${templateWords(d, "default")}`;
      break;
    case "scribe.deleted":
      text = `${actor} deleted one of their ${d.mode === "voice" ? "voice notes" : "recordings"}`;
      addType(details, d);
      if (d.title) details.push(["Label", d.title]);
      if (d.recorded_at) details.push(["Recorded", dateTime(d.recorded_at)]);
      if (d.notes !== undefined) details.push(["Notes deleted", String(d.notes)]);
      break;
    case "review.started":
      text = `${actor} started a review of ${target}'s records`;
      break;
    case "review.list_viewed":
      text = `${actor} viewed the list of ${target}'s records`;
      break;
    case "review.record_opened":
      text = `${actor} opened ${target}'s record${d.title ? ` "${d.title}"` : ""}`;
      addType(details, d);
      if (d.recorded_at) details.push(["Recorded", dateTime(d.recorded_at)]);
      break;
    case "review.copied":
      text = `${actor} copied the ${d.item === "note" ? "note" : "transcript"} from ${target}'s record`;
      break;
    case "review.ended":
      text = `${actor} ended the review of ${target}'s records`;
      if (d.minutes !== undefined) details.push(["Length", `${d.minutes} minutes`]);
      break;
    case "review.expired":
      text = `The review of ${target}'s records by ${actor} ended after 30 minutes without activity`;
      break;
    case "server.updated":
      text = d.from ? `The server was updated from version ${d.from} to ${d.to}` : `The server was set up at version ${d.to}`;
      break;
    default:
      // An activity this page does not know yet still reads as words.
      text = `${actor} made a change: ${String(entry.action ?? "").replace(/[._]+/g, " ").trim() || "unknown"}`;
  }
  if (entry.scribe_id) details.push(["Record number", entry.scribe_id]);
  if (entry.user_agent) details.push(["Device", entry.user_agent]);
  return { text, details };
}
