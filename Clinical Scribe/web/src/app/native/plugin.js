// The app's own Android code (android/app/src/main/java/…/ScribeNativePlugin.java):
//   keepAwake({ on })
//   startRecording({ startedAt }), updateRecording({ paused, elapsedMs }), stopRecording()
//   and the "recordingAction" event ({ action: "pause" | "resume" }) from the notification
//   permissionStatus(), requestMicrophone(), requestNotifications(), openSettings()
//   secureGet({ key }), secureSet({ key, value }), secureRemove({ key })
//   saveFileStart({ name, mimeType }) → { saved, token }, then saveFileWrite({ token, data }) for
//   each base64 part, then saveFileFinish({ token }), or saveFileCancel({ token }) on a problem
import { registerPlugin } from "@capacitor/core";

export const ScribeNative = registerPlugin("ScribeNative");
