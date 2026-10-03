// Short vibrations for touch feedback in the Android app. The Vibration switch in
// More turns them off, together with Android's own vibration for long presses in
// the app (see vibration-core.js).
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { ScribeNative } from "./plugin.js";
import { createVibration } from "./vibration-core.js";

function vibrate(kind) {
  if (kind === "success") return Haptics.notification({ type: NotificationType.Success });
  if (kind === "error") return Haptics.notification({ type: NotificationType.Error });
  if (kind === "medium") return Haptics.impact({ style: ImpactStyle.Medium });
  return Haptics.impact({ style: ImpactStyle.Light });
}

function phoneStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const vibration = createVibration({
  storage: phoneStorage(),
  vibrate,
  touchFeedback: (on) => ScribeNative.setTouchFeedback({ on }),
});

export const haptic = vibration.haptic;
export const vibrationOn = vibration.isOn;
export const setVibration = vibration.set;
export const applyVibration = vibration.apply;
