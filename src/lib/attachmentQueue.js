// @ts-nocheck
/**
 * @file Offline upload queue for task attachments (Pri 6).
 *
 * The existing offline system (lib/offlineCache.js) stores queued
 * mutations as JSON in localStorage — which can't hold binary blobs.
 * Attachments need the actual file bytes preserved across a reload, so
 * this uses IndexedDB, which stores Blob/File objects natively.
 *
 * Object store `pending`, keyed by a generated id, indexed by taskId:
 *   { id, taskId, filename, type, size, bytes (ArrayBuffer), queuedAt }
 *
 * We store the raw ArrayBuffer rather than the File/Blob object:
 * ArrayBuffers structured-clone reliably across every browser (and the
 * test environment), whereas Blob-in-IndexedDB support has historically
 * been spotty. `toFile(record)` reconstructs a real File for upload /
 * preview.
 *
 * Scope: only EXISTING (server-synced) tasks. A task created while
 * offline has a temporary `offline_…` id that won't exist on the server,
 * so callers must not enqueue against those — the replay driver also
 * skips them defensively.
 *
 * Every function fails soft: if IndexedDB is unavailable (private mode,
 * ancient browser, SSR), reads return [] and writes reject — callers
 * treat a rejected enqueue as "couldn't queue, surface an error".
 */
const DB_NAME = "zephyrly-attachments";
const STORE = "pending";
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("taskId", "taskId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * Reconstruct a real File from a stored queue record, for upload or
 * image preview. Falls back to a Blob if the File constructor is
 * unavailable (very old browsers).
 * @param {{ bytes: ArrayBuffer, filename: string, type: string }} record
 * @returns {File | Blob}
 */
export function toFile(record) {
  const type = record.type || "application/octet-stream";
  try {
    return new File([record.bytes], record.filename, { type });
  } catch {
    return new Blob([record.bytes], { type });
  }
}

/**
 * Queue a file for upload against an existing task.
 * @param {{ taskId: string, file: File }} args
 * @returns {Promise<{ id: string, taskId: string, filename: string, type: string, size: number, queuedAt: number }>}
 */
export async function enqueue({ taskId, file }) {
  const db = await openDb();
  const bytes = await file.arrayBuffer();
  const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const record = {
    id,
    taskId,
    filename: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    bytes,             // ArrayBuffer — clones reliably everywhere
    queuedAt: Date.now(),
  };
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(record);
    t.oncomplete = () => resolve(undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  // Don't hand the raw bytes back to callers — they only need metadata.
  const { bytes: _bytes, ...meta } = record;
  return meta;
}

/**
 * List queued items for one task (newest last). Returns metadata + the
 * blob (callers reconstruct a File for upload). Fails soft to [].
 * @param {string} taskId
 */
export async function listForTask(taskId) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const idx = t.objectStore(STORE).index("taskId");
      const req = idx.getAll(taskId);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.queuedAt - b.queuedAt));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Every queued item across all tasks. Fails soft to []. */
export async function listAll() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.queuedAt - b.queuedAt));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Remove a queued item by id. Fails soft. */
export async function remove(id) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).delete(id);
      t.oncomplete = () => resolve(undefined);
      t.onerror = () => reject(t.error);
    });
  } catch {
    // ignore
  }
}

/** Total queued count across all tasks. Fails soft to 0. */
export async function count() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).count();
      req.onsuccess = () => resolve(Number(req.result || 0));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

/** Test helper — wipe everything. Not used in production paths. */
export async function _clearAll() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).clear();
    t.oncomplete = () => resolve(undefined);
    t.onerror = () => reject(t.error);
  });
}
