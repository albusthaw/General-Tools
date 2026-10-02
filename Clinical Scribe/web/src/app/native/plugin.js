// The app's own Android code (android/app/src/main/java/…/ScribeNativePlugin.java):
//   recorderStart({ scribeId, segmentSeconds, maxSeconds }), recorderPause(), recorderResume(),
//   recorderStop(), recorderDiscard(), recorderStatus(), recorderDone({ scribeId }) → the state
//   { phase, scribeId, reason, activeMs, limitReached }
//   pendingParts({ scribeId }) → { parts: [{ seq, bytes, durationMs }] }, recordingsOnPhone()
//   readPart({ scribeId, seq, offset, length }) → { data (base64), size }, deletePart({ scribeId, seq }),
//   deleteParts({ scribeId }), and the events "recorderState", "recorderPart" ({ scribeId, seq,
//   durationMs }) and "recorderLevel" ({ level })
//   permissionStatus(), requestMicrophone(), requestNotifications(), openSettings()
//   secureGet({ key }), secureSet({ key, value }), secureRemove({ key })
//   saveFileStart({ name, mimeType }) → { saved, token }, then saveFileWrite({ token, data }) for
//   each base64 part, then saveFileFinish({ token }), or saveFileCancel({ token }) on a problem
import { registerPlugin } from "@capacitor/core";

export const ScribeNative = registerPlugin("ScribeNative");
