// The rules of the Vibration switch, kept apart from Capacitor so they can be
// tested: on at first, the choice kept on the phone, and nothing vibrates while it
// is off. touchFeedback(on) tells Android whether the pages may vibrate on long
// presses; vibrate(kind) makes one short vibration.
const KEY = "cs-vibration";

export function createVibration({ storage, vibrate, touchFeedback }) {
  let on = true;
  try {
    on = storage?.getItem(KEY) !== "off";
  } catch {
    on = true;
  }
  const quietly = (work) => {
    try {
      return Promise.resolve(work()).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };
  const apply = () => quietly(() => touchFeedback(on));

  return {
    isOn: () => on,
    apply,
    set(next) {
      on = Boolean(next);
      try {
        if (on) storage?.removeItem(KEY);
        else storage?.setItem(KEY, "off");
      } catch {
        // Kept until the app closes.
      }
      return apply();
    },
    haptic(kind = "light") {
      return on ? quietly(() => vibrate(kind)) : Promise.resolve();
    },
  };
}
