// Finds recordings that were interrupted on this device (closed tab, crash, flat
// battery) and saves the audio that was kept locally.
import { idb } from "../uploads/idb.js";
import { addPart } from "../uploads/queue.js";

const LOCK_PREFIX = "clinical-scribe-recording-";

// Holds a browser lock while a recording is live, so another tab never treats it
// as interrupted. Returns a function that releases the lock.
export function holdRecordingLock(scribeId) {
  if (!navigator.locks?.request) return () => {};
  let release;
  const held = new Promise((resolve) => (release = resolve));
  navigator.locks.request(`${LOCK_PREFIX}${scribeId}`, () => held).catch(() => {});
  return () => release?.();
}

async function liveRecordings() {
  try {
    const snapshot = await navigator.locks?.query?.();
    return new Set((snapshot?.held ?? []).map((lock) => lock.name).filter((name) => name.startsWith(LOCK_PREFIX)).map((name) => name.slice(LOCK_PREFIX.length)));
  } catch {
    return new Set();
  }
}

// Returns recordings that were never finished, after queueing their saved audio.
export async function recoverInterrupted(userId) {
  let recordings = [];
  let chunks = [];
  try {
    recordings = (await idb.all("recordings")).filter((row) => row.userId === userId);
    chunks = (await idb.all("chunks")).filter((row) => row.userId === userId);
  } catch {
    return [];
  }
  const live = await liveRecordings();
  const interrupted = [];

  for (const recording of recordings) {
    if (live.has(recording.scribeId)) continue;
    const mine = chunks.filter((chunk) => chunk.scribeId === recording.scribeId);
    const bySeq = new Map();
    for (const chunk of mine) {
      if (!bySeq.has(chunk.seq)) bySeq.set(chunk.seq, []);
      bySeq.get(chunk.seq).push(chunk);
    }
    for (const [seq, list] of [...bySeq.entries()].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => a.index - b.index);
      await addPart({
        scribeId: recording.scribeId,
        seq,
        blob: new Blob(list.map((chunk) => chunk.blob), { type: recording.mime }),
        // Each chunk holds up to five seconds of audio.
        duration: list.length * 5,
        mime: recording.mime,
        ext: recording.ext,
        prefix: recording.prefix,
        userId,
      });
    }
    if (!recording.finishRequested) {
      interrupted.push({ scribeId: recording.scribeId, title: recording.title ?? "", startedAt: recording.startedAt });
    }
  }
  return interrupted;
}
