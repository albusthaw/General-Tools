// A small promise wrapper around IndexedDB. Audio waiting to be saved is kept
// here so a closed tab or crash never loses more than a few seconds.
//
// Stores:
//   chunks      [scribeId, seq, index] -> 5-second pieces of the part being recorded
//   parts       [scribeId, seq]        -> finished parts waiting to be uploaded
//   recordings  scribeId               -> one entry per recording still open on this device

const DB_NAME = "clinical-scribe";
const VERSION = 1;
let opening = null;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["scribeId", "seq", "index"] });
      if (!db.objectStoreNames.contains("parts")) db.createObjectStore("parts", { keyPath: ["scribeId", "seq"] });
      if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings", { keyPath: "scribeId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

function run(storeName, mode, action) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const request = action(store);
    if (request) request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const idb = {
  put: (store, value) => run(store, "readwrite", (s) => s.put(value)),
  get: (store, key) => run(store, "readonly", (s) => s.get(key)),
  delete: (store, key) => run(store, "readwrite", (s) => s.delete(key)),
  all: (store) => run(store, "readonly", (s) => s.getAll()),
  async deleteWhere(store, test) {
    const rows = await idb.all(store);
    const keys = rows.filter(test).map((row) =>
      store === "chunks" ? [row.scribeId, row.seq, row.index] : store === "parts" ? [row.scribeId, row.seq] : row.scribeId
    );
    if (keys.length === 0) return 0;
    await run(store, "readwrite", (s) => {
      for (const key of keys) s.delete(key);
      return null;
    });
    return keys.length;
  },
};

// Everything stored for one person, removed on sign-out from a shared device.
export async function forgetUser(userId) {
  for (const store of ["chunks", "parts", "recordings"]) {
    await idb.deleteWhere(store, (row) => row.userId === userId).catch(() => 0);
  }
}
