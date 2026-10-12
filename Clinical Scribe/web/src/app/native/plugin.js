// The app's own Android code (android/app/src/main/java/…/ScribeNativePlugin.java):
//   recorderStart({ scribeId, segmentSeconds, maxSeconds }), recorderPause(), recorderResume(),
//   recorderStop(), recorderDiscard(), recorderStatus(), recorderDone({ scribeId }) → the state
//   { phase, scribeId, reason, activeMs, limitReached, waiting, gaps: [{ atMs, gapMs, reason }] }
//   (waiting: paused by a call or other sound, until it starts again by itself)
//   pendingParts({ scribeId }) → { parts: [{ seq, bytes, durationMs, gapMs?, gapReason? }] }, recordingsOnPhone()
//   readPart({ scribeId, seq, offset, length }) → { data (base64), size }, deletePart({ scribeId, seq }),
//   deleteParts({ scribeId }), and the events "recorderState", "recorderPart" ({ scribeId, seq,
//   durationMs, gapMs?, gapReason? }: the gap a part starts after) and "recorderLevel" ({ level })
//   permissionStatus(), requestMicrophone(), requestNotifications(), openSettings()
//   secureGet({ key }), secureSet({ key, value }), secureRemove({ key })
//   saveFileStart({ name, mimeType }) → { saved, token }, then saveFileWrite({ token, data }) for
//   each base64 part, then saveFileFinish({ token }), or saveFileCancel({ token }) on a problem
//   setTouchFeedback({ on }) lets the app's pages vibrate on long presses, or not
import { registerPlugin } from "@capacitor/core";

export const ScribeNative = registerPlugin("ScribeNative");
