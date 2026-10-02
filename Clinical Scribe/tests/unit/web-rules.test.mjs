// Unit tests for the web app's small rule modules. They run in Node without a
// browser or a server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, toCsv } from "../../web/src/lib/csv.js";
import { fromDatabase, messageOf, UserError } from "../../web/src/lib/errors.js";
import { clock, duration, initials, minutes, relative } from "../../web/src/lib/format.js";
import { limitAction, partIsDue } from "../../web/src/lib/recorder/timing.js";
import { finishWasRefused, partCannotBeSaved, partPath, retryDelayMs } from "../../web/src/lib/uploads/rules.js";
import { describe as describeAudit, GROUPS } from "../../web/src/views/admin/audit-text.js";

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
