// The Vibration switch of the Android app: on at first, kept on the phone, and
// while it is off nothing vibrates, Android's own long-press vibration included.
import assert from "node:assert/strict";
import test from "node:test";
import { createVibration } from "../../web/src/app/native/vibration-core.js";

function memory() {
  const saved = new Map();
  return {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: (key) => saved.delete(key),
  };
}

function phone(storage) {
  const buzzes = [];
  const feedback = [];
  const vibration = createVibration({ storage, vibrate: (kind) => buzzes.push(kind), touchFeedback: (on) => feedback.push(on) });
  return { vibration, buzzes, feedback };
}

test("vibration is on at first, and switching it off stops every vibration", async () => {
  const storage = memory();
  const { vibration, buzzes, feedback } = phone(storage);
  assert.equal(vibration.isOn(), true);
  await vibration.haptic("medium");
  assert.deepEqual(buzzes, ["medium"]);

  await vibration.set(false);
  assert.deepEqual(feedback, [false], "Android's long-press vibration is switched off too");
  await vibration.haptic("success");
  await vibration.haptic();
  assert.deepEqual(buzzes, ["medium"], "nothing vibrates while it is off");
});

test("the choice is kept when the app opens again", async () => {
  const storage = memory();
  await phone(storage).vibration.set(false);

  const again = phone(storage);
  assert.equal(again.vibration.isOn(), false);
  await again.vibration.apply();
  assert.deepEqual(again.feedback, [false], "applied to Android when the app starts");
  await again.vibration.set(true);
  await again.vibration.haptic("light");
  assert.deepEqual(again.buzzes, ["light"]);
  assert.equal(phone(storage).vibration.isOn(), true);
});

test("a phone that cannot keep the choice still follows it until the app closes", async () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  const buzzes = [];
  const vibration = createVibration({
    storage: blocked,
    vibrate: (kind) => buzzes.push(kind),
    touchFeedback: () => Promise.reject(new Error("no plugin")),
  });
  assert.equal(vibration.isOn(), true);
  await vibration.set(false);
  await vibration.haptic("light");
  assert.deepEqual(buzzes, []);
  // A vibration that fails is not a problem for the page.
  const failing = createVibration({ storage: null, vibrate: () => { throw new Error("no motor"); }, touchFeedback: () => {} });
  await failing.haptic("light");
});
