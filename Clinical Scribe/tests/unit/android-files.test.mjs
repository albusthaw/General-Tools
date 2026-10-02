// Unit tests for saving files in the Android app: the file reaches Android in
// parts that add up to the same bytes, the file type is plain, a cancelled save
// writes nothing, and a failed save removes the half-written file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSaver, PART, plainType } from "../../web/src/app/native/save-in-parts.js";

// A stand-in for the Android side that keeps what it is sent.
function fakeAndroid({ cancel = false, failOnPart = 0 } = {}) {
  const calls = [];
  const parts = [];
  return {
    calls,
    bytes: () => Buffer.concat(parts.map((part) => Buffer.from(part, "base64"))),
    async saveFileStart(options) {
      calls.push(["start", options]);
      return cancel ? { saved: false } : { saved: true, token: "token-1" };
    },
    async saveFileWrite({ token, data }) {
      calls.push(["write", token, data.length]);
      if (failOnPart && parts.length + 1 === failOnPart) throw new Error("disk full");
      parts.push(data);
    },
    async saveFileFinish({ token }) {
      calls.push(["finish", token]);
    },
    async saveFileCancel({ token }) {
      calls.push(["cancel", token]);
    },
  };
}

test("a large file arrives in parts that add up to the same bytes", async () => {
  const android = fakeAndroid();
  const original = Buffer.alloc(PART * 2 + 12345);
  for (let i = 0; i < original.length; i++) original[i] = (i * 31) % 256;
  const result = await makeSaver(android)(new Blob([original], { type: "audio/webm;codecs=opus" }), "visit.webm");
  assert.equal(result, "saved");
  assert.deepEqual(android.calls[0], ["start", { name: "visit.webm", mimeType: "audio/webm" }]);
  assert.equal(android.calls.filter((call) => call[0] === "write").length, 3);
  assert.ok(android.calls.filter((call) => call[0] === "write").every((call) => call[2] <= (PART / 3) * 4), "no part is larger than one part of base64");
  assert.deepEqual(android.calls.at(-1), ["finish", "token-1"]);
  assert.ok(android.bytes().equals(original));
});

test("an empty file is saved, and a cancelled save writes nothing", async () => {
  const empty = fakeAndroid();
  assert.equal(await makeSaver(empty)(new Blob([]), "empty.csv"), "saved");
  assert.deepEqual(empty.calls.map((call) => call[0]), ["start", "finish"]);

  const cancelled = fakeAndroid({ cancel: true });
  assert.equal(await makeSaver(cancelled)(new Blob(["a,b"]), "list.csv"), false);
  assert.deepEqual(cancelled.calls.map((call) => call[0]), ["start"]);
});

test("a save that fails half way removes the file and says so", async () => {
  const android = fakeAndroid({ failOnPart: 2 });
  let told = 0;
  const result = await makeSaver(android, { failed: () => told++ })(new Blob([Buffer.alloc(PART * 3)]), "big.webm");
  assert.equal(result, false);
  assert.equal(told, 1);
  assert.deepEqual(android.calls.at(-1), ["cancel", "token-1"]);
  assert.equal(android.calls.some((call) => call[0] === "finish"), false);
});

test("file types are sent plain", () => {
  assert.equal(plainType("text/csv;charset=utf-8"), "text/csv");
  assert.equal(plainType("Audio/MP4"), "audio/mp4");
  assert.equal(plainType(""), "application/octet-stream");
  assert.equal(plainType("not a type"), "application/octet-stream");
  assert.equal(plainType("text/<script>"), "application/octet-stream");
});
