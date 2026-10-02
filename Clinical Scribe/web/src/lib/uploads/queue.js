// Uploads finished audio parts in order, registers them with the server, and
// finishes a recording once all its parts are saved. Work is kept in IndexedDB,
// so it carries on after a reload or when the connection comes back.
import { finishScribe, registerSegment, uploadPart } from "../api/scribes.js";
import { idb } from "./idb.js";
import { finishWasRefused, partCannotBeSaved, partPath, retryDelayMs } from "./rules.js";

const listeners = new Set();
// Memory copy for browsers where IndexedDB is unavailable.
const memory = { parts: new Map(), recordings: new Map() };

let userId = null;
let running = false;
let wakeUp = null;
let attempt = 0;
let lastError = null;

function emit(event) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener must not stop uploads.
    }
  }
}

export function onQueueChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function safe(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

async function allParts() {
  const stored = await safe(idb.all("parts"), null);
  const rows = stored ?? [...memory.parts.values()];
  return rows.filter((row) => row.userId === userId).sort((a, b) => (a.createdAt - b.createdAt) || (a.seq - b.seq));
}

async function allRecordings() {
  const stored = await safe(idb.all("recordings"), null);
  return (stored ?? [...memory.recordings.values()]).filter((row) => row.userId === userId);
}

async function removePart(part) {
  memory.parts.delete(`${part.scribeId}:${part.seq}`);
  await safe(idb.delete("parts", [part.scribeId, part.seq]));
  await safe(idb.deleteWhere("chunks", (row) => row.scribeId === part.scribeId && row.seq === part.seq));
}

export async function saveRecordingEntry(entry) {
  memory.recordings.set(entry.scribeId, entry);
  await safe(idb.put("recordings", entry));
}

export async function getRecordingEntry(scribeId) {
  return (await safe(idb.get("recordings", scribeId), null)) ?? memory.recordings.get(scribeId) ?? null;
}

async function removeRecording(scribeId) {
  memory.recordings.delete(scribeId);
  await safe(idb.delete("recordings", scribeId));
}

// Adds a finished part. It is stored before its 5-second chunks are removed.
export async function addPart(part) {
  const row = { ...part, createdAt: Date.now() };
  memory.parts.set(`${part.scribeId}:${part.seq}`, row);
  const stored = await safe(idb.put("parts", row).then(() => true), false);
  if (stored) {
    memory.parts.delete(`${part.scribeId}:${part.seq}`);
    await safe(idb.deleteWhere("chunks", (chunk) => chunk.scribeId === part.scribeId && chunk.seq === part.seq));
  }
  emit({ type: "added", scribeId: part.scribeId });
  kick();
}

// Asks for the recording to be finished once every part is saved.
export async function requestFinish(scribeId, segmentCount) {
  const entry = (await getRecordingEntry(scribeId)) ?? { scribeId, userId };
  await saveRecordingEntry({ ...entry, userId: entry.userId ?? userId, finishRequested: true, segmentCount });
  kick();
}

// Removes everything waiting for a recording that was discarded.
export async function dropScribe(scribeId) {
  for (const key of [...memory.parts.keys()]) if (key.startsWith(`${scribeId}:`)) memory.parts.delete(key);
  await safe(idb.deleteWhere("parts", (row) => row.scribeId === scribeId));
  await safe(idb.deleteWhere("chunks", (row) => row.scribeId === scribeId));
  await removeRecording(scribeId);
  emit({ type: "dropped", scribeId });
}

export async function pendingFor(scribeId) {
  return (await allParts()).filter((part) => part.scribeId === scribeId).length;
}

export async function hasPending() {
  if ((await allParts()).length > 0) return true;
  return (await allRecordings()).some((entry) => entry.finishRequested);
}

export function status() {
  return { running, lastError };
}

export function start(forUserId) {
  userId = forUserId;
  attempt = 0;
  kick();
}

export function stop() {
  userId = null;
}

export function kick() {
  if (wakeUp) {
    const resolve = wakeUp;
    wakeUp = null;
    resolve();
  }
  if (!running && userId) run();
}

function waitBeforeRetry() {
  const delay = retryDelayMs(attempt);
  attempt += 1;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeUp = null;
      resolve();
    }, delay);
    wakeUp = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function uploadOne(part) {
  await uploadPart(partPath(part), part.blob, part.mime);
  await registerSegment({ scribeId: part.scribeId, seq: part.seq, durationSeconds: part.duration, mimeType: part.mime });
}

async function run() {
  running = true;
  emit({ type: "running" });
  try {
    while (userId) {
      const forUser = userId;
      const parts = await allParts();
      let progressed = false;

      for (const part of parts) {
        if (userId !== forUser) break;
        try {
          await uploadOne(part);
          await removePart(part);
          attempt = 0;
          lastError = null;
          progressed = true;
          emit({ type: "uploaded", scribeId: part.scribeId, seq: part.seq });
        } catch (error) {
          if (partCannotBeSaved(error)) {
            await removePart(part);
            emit({ type: "dropped", scribeId: part.scribeId, seq: part.seq, error });
            continue;
          }
          // Anything else, such as no connection or a file that has not appeared
          // yet, is tried again shortly.
          lastError = error;
          emit({ type: "error", scribeId: part.scribeId, error });
          break;
        }
      }

      const remaining = await allParts();
      if (remaining.length > 0) {
        if (!progressed) await waitBeforeRetry();
        continue;
      }

      // All parts are saved: finish the recordings that asked for it.
      let finishFailed = false;
      for (const entry of await allRecordings()) {
        if (!entry.finishRequested) continue;
        try {
          await finishScribe(entry.scribeId, entry.segmentCount ?? null);
          await removeRecording(entry.scribeId);
          attempt = 0;
          emit({ type: "finished", scribeId: entry.scribeId });
        } catch (error) {
          if (finishWasRefused(error)) {
            // The server refused for a reason a retry will not fix (for example,
            // not enough minutes). The recording stays in History to process later.
            await removeRecording(entry.scribeId);
            emit({ type: "finish_refused", scribeId: entry.scribeId, error });
          } else {
            finishFailed = true;
            lastError = error;
            emit({ type: "error", scribeId: entry.scribeId, error });
          }
        }
      }
      if (finishFailed) {
        await waitBeforeRetry();
        continue;
      }
      break;
    }
  } finally {
    running = false;
    emit({ type: "idle" });
  }
}

window.addEventListener("online", () => {
  attempt = 0;
  kick();
});
