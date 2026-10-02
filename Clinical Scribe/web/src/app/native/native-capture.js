// Recording in the Android app: the phone's own recorder (see native-capture-core.js),
// connected to the app's Android code.
import { createNativeCapture, findPhoneRecording, recoverPhoneParts } from "./native-capture-core.js";
import { ScribeNative } from "./plugin.js";

export const createCapture = () => createNativeCapture({ bridge: ScribeNative });
export const findRecording = () => findPhoneRecording(ScribeNative);
export const recoverParts = (options) => recoverPhoneParts(ScribeNative, options);
