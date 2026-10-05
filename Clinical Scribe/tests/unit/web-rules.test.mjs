// Unit tests for the web app's small rule modules. They run in Node without a
// browser or a server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, toCsv } from "../../web/src/lib/csv.js";
import { fromDatabase, messageOf, UserError } from "../../web/src/lib/errors.js";
import { clock, duration, initials, minutes, relative } from "../../web/src/lib/format.js";
import { limitAction, partIsDue } from "../../web/src/lib/recorder/timing.js";
import { finishWasRefused, partCannotBeSaved, partPath, retryDelayMs } from "../../web/src/lib/uploads/rules.js";
import { countOf, MODE_LIST, MODES, modeOf } from "../../web/src/lib/modes.js";
import { ROUTES } from "../../web/src/lib/router.js";
import { TABS, tabOf } from "../../web/src/app/tab-bar.js";
import { describe as describeAudit, GROUPS } from "../../web/src/views/admin/audit-text.js";
import { defaultTemplateId, templateOptions, templatesOfMode } from "../../web/src/views/scribe/template-options.js";

test("clock and duration read naturally", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(754), "12:34");
  assert.equal(clock(3723), "1:02:03");
  assert.equal(clock(-5), "0:00");
  assert.equal(duration(45), "45 s");
  assert.equal(duration(754), "12 min 34 s");
  assert.equal(duration(600), "10 min");
  assert.equal(duration(7260), "2 h 1 min");
  assert.equal(minutes(59), "0 minutes");
  assert.equal(minutes(60), "1 minute");
  assert.equal(minutes(7200), "120 minutes");
});

test("relative times and initials", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  assert.equal(relative(null, now), "never");
  assert.equal(relative("2026-10-02T11:59:40Z", now), "just now");
  assert.equal(relative("2026-10-02T11:55:00Z", now), "5 minutes ago");
  assert.equal(initials("Amelia Hart", ""), "AH");
  assert.equal(initials("", "sam.patel@clinic.test"), "SP");
  assert.equal(initials("", ""), "?");
});

test("CSV cells can never become spreadsheet formulas", () => {
  assert.equal(csvCell("plain"), '"plain"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  for (const start of ["+", "-", "@", "\t", "\r"]) assert.ok(csvCell(`${start}1`).startsWith(`"'`));
  assert.equal(csvCell(null), '""');
  const csv = toCsv([{ a: 1, b: "x" }], [{ label: "A", value: (r) => r.a }, { label: "B", value: (r) => r.b }]);
  assert.equal(csv, '"A","B"\r\n"1","x"');
});

test("server answers become plain messages", () => {
  const known = fromDatabase({ message: "Not enough minutes left.", hint: "cs:not_enough_credit" });
  assert.ok(known instanceof UserError);
  assert.equal(known.code, "not_enough_credit");
  assert.equal(known.message, "Not enough minutes left.");
  assert.equal(fromDatabase({ message: "TypeError: Failed to fetch" }).code, "offline");
  assert.equal(fromDatabase({ message: "JWT expired", code: "PGRST301" }).code, "not_signed_in");
  assert.equal(messageOf(new Error("relation does not exist")), "Something went wrong. Please try again.");
});

test("audio parts are stored in order, in the person's own folder", () => {
  assert.equal(partPath({ prefix: "u1/s1", seq: 3, ext: "webm" }), "u1/s1/0003.webm");
  assert.equal(partPath({ prefix: "u1/s1", seq: 12, ext: "m4a" }), "u1/s1/0012.m4a");
});

test("uploads wait longer after each failure, up to a minute", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(retryDelayMs), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(retryDelayMs(-1), 2000);
});

test("only answers that can never change stop the retries", () => {
  assert.equal(partCannotBeSaved(new UserError("x", "not_recording")), true);
  assert.equal(partCannotBeSaved(new UserError("x", "upload_missing")), false);
  assert.equal(partCannotBeSaved(new UserError("x", "offline")), false);
  assert.equal(partCannotBeSaved(new Error("network")), false);
  assert.equal(finishWasRefused(new UserError("x", "not_enough_credit")), true);
  assert.equal(finishWasRefused(new UserError("x", "offline")), false);
  assert.equal(finishWasRefused(new Error("network")), false);
});

test("the recorder starts a new part at the part length", () => {
  assert.equal(partIsDue(599.9, 600), false);
  assert.equal(partIsDue(600, 600), true);
  assert.equal(partIsDue(5.2, 5), true);
});

test("the recorder warns two minutes before the limit and stops at it", () => {
  assert.equal(limitAction(100, 3600, false), null);
  assert.equal(limitAction(3480, 3600, false), "warn");
  assert.equal(limitAction(3500, 3600, true), null);
  assert.equal(limitAction(3600, 3600, true), "stop");
  assert.equal(limitAction(3700, 3600, false), "stop");
  // Short limits stop without a warning.
  assert.equal(limitAction(10, 90, false), null);
  assert.equal(limitAction(90, 90, false), "stop");
});

test("audit entries read as plain sentences", () => {
  const update = describeAudit({ action: "server.updated", details: { from: "1.0.0", to: "1.1.0" } });
  assert.equal(update.text, "The server was updated from version 1.0.0 to 1.1.0");
  const review = describeAudit({
    action: "review.record_opened",
    actor_name: "Dr Amelia Hart",
    target_name: "Dr Sam Patel",
    details: { title: "Clinic visit" },
  });
  assert.equal(review.text, "Dr Amelia Hart opened Dr Sam Patel's record \"Clinic visit\"");
  assert.ok(GROUPS.some((group) => group.value === "server"));
});

test("audit entries name the type of templates and records", () => {
  const voiceDefault = describeAudit({ action: "template.default_changed", actor_name: "Dr Amelia Hart", details: { name: "Dictated note", mode: "voice" } });
  assert.equal(voiceDefault.text, 'Dr Amelia Hart made "Dictated note" the default Voice Note template');
  const older = describeAudit({ action: "template.default_changed", actor_name: "Dr Amelia Hart", details: { name: "SOAP note" } });
  assert.equal(older.text, 'Dr Amelia Hart made "SOAP note" the default template', "older entries carry no type");
  const created = describeAudit({ action: "template.shared_created", actor_name: "Dr Amelia Hart", details: { name: "Clinic letter", mode: "voice" } });
  assert.equal(created.text, 'Dr Amelia Hart created the shared Voice Note template "Clinic letter"');
  const deleted = describeAudit({ action: "scribe.deleted", actor_name: "Dr Sam Patel", details: { mode: "voice", notes: 1 } });
  assert.equal(deleted.text, "Dr Sam Patel deleted one of their voice notes");
  assert.deepEqual(deleted.details[0], ["Type", "Voice Note"]);
  const opened = describeAudit({ action: "recording.opened", actor_name: "Dr Amelia Hart", target_name: "Dr Sam Patel", details: { mode: "scribe", parts: 2 } });
  assert.ok(opened.details.some(([label, value]) => label === "Type" && value === "Clinical Scribe"));
  // Something new still reads as words, never as a code.
  assert.equal(describeAudit({ action: "something.new_here", actor_name: "Dr Amelia Hart" }).text, "Dr Amelia Hart made a change: something new here");
});

test("the two ways to record have their own names, tabs and History tabs", () => {
  assert.deepEqual(MODE_LIST.map((mode) => mode.name), ["Clinical Scribe", "Voice Note"]);
  assert.equal(modeOf("voice"), MODES.voice);
  assert.equal(modeOf("scribe"), MODES.scribe);
  assert.equal(modeOf(undefined), MODES.scribe, "older records are Clinical Scribe");
  assert.equal(modeOf("anything"), MODES.scribe);
  assert.equal(countOf("voice", 1), "1 voice note");
  assert.equal(countOf("scribe", 3), "3 recordings");
  for (const mode of MODE_LIST) {
    const tab = ROUTES.find((route) => route.pattern.test(mode.path));
    assert.equal(tab.name, mode.route);
    assert.equal(tab.mode, mode.id);
    assert.equal(tab.title, mode.name);
    const history = ROUTES.find((route) => route.pattern.test(mode.historyPath));
    assert.equal(history.name, mode.historyRoute);
    assert.equal(history.mode, mode.id);
  }
  // No developer words on screen.
  for (const mode of MODE_LIST) {
    for (const [key, value] of Object.entries(mode)) {
      if (["id", "icon", "path", "historyPath", "route", "historyRoute"].includes(key)) continue;
      assert.doesNotMatch(value, /\bmode\b|diari[sz]|speaker|this is for/i, `${mode.id}.${key}`);
    }
  }
});

test("the app tab bar has both recording tabs, and History pages belong to History", () => {
  assert.deepEqual(TABS.map((tab) => tab.label), ["Clinical Scribe", "Voice Note", "Templates", "History", "More"]);
  assert.equal(tabOf({ name: "voice" }), "voice");
  assert.equal(tabOf({ name: "history-voice" }), "history");
  assert.equal(tabOf({ name: "history-detail" }), "history");
  assert.equal(tabOf({ name: "admin-ai", admin: true }), "more");
});

test("each recording type offers only its own templates and its own default", () => {
  const templates = [
    { id: "soap", scope: "shared", name: "SOAP note", is_default: true },
    { id: "clerk", scope: "shared", mode: "scribe", name: "Clerking", is_default: false },
    { id: "dictated", scope: "shared", mode: "voice", name: "Dictated note", is_default: true },
    { id: "letter", scope: "personal", mode: "voice", name: "Clinic letter", is_default: false },
  ];
  const scribe = templatesOfMode(templates, "scribe");
  const voice = templatesOfMode(templates, "voice");
  assert.deepEqual(scribe.map((t) => t.id), ["soap", "clerk"], "templates without a type are Clinical Scribe templates");
  assert.deepEqual(voice.map((t) => t.id), ["dictated", "letter"]);
  assert.equal(defaultTemplateId(voice), "dictated");
  assert.equal(defaultTemplateId(voice, "letter"), "letter", "the last template used comes first");
  assert.equal(defaultTemplateId(voice, "soap"), "dictated", "a template of the other type is never chosen");
  assert.deepEqual(templateOptions(voice).map((group) => group.group), ["Shared templates", "Your templates"]);
});
