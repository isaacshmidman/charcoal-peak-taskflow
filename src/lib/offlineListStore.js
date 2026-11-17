/**
 * @file Where the offline copy of the big lists is kept on the device:
 * IndexedDB, one record per list, each the list as JSON text.
 *
 * The lists used to be in localStorage, which a browser caps at about
 * 5 MB for a whole site. A few thousand tasks filled it, after which the
 * copy stopped updating and, worse, there was no room left for the queue
 * of changes made offline. IndexedDB's share is a slice of the disk.
 *
 * It answers later, not at once, so lib/offlineCache.js keeps what it
 * read here in memory and hands that out; this file only fetches and
 * stores. Every function settles: a browser with no IndexedDB, or one
 * that never answers, gives null/false rather than an error or a wait
 * without end, and the caller falls back to localStorage.
 */
const DB_NAME = "zephyrly-offline-copy";
const STORE = "lists";
const DB_VERSION = 1;
/** A browser that hasn't answered by now isn't going to (old Safari). */
const OPEN_WAIT_MS = 1500;

/** @type {Promise<IDBDatabase | null> | null} */
let opening = null;

/** @returns {Promise<IDBDatabase | null>} */
function open() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let settled = false;
    const settle = (db) => {
      if (settled) {
        // Answered after we stopped waiting: not used this visit.
        try { db?.close(); } catch { /* nothing to close */ }
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => settle(null), OPEN_WAIT_MS);
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab with a newer build wants to change the store's
        // shape: step aside rather than hold it up.
        db.onversionchange = () => {
          try { db.close(); } catch { /* closed already */ }
          opening = null;
        };
        settle(db);
      };
      request.onerror = () => settle(null);
      request.onblocked = () => settle(null);
    } catch {
      settle(null);
    }
  });
  return opening;
}

/**
 * Every list kept on this device, as text.
 * @returns {Promise<Map<string, string> | null>} null: IndexedDB can't be used
 */
export async function readAllLists() {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      /** @type {Map<string, string>} */
      const found = new Map();
      const tx = db.transaction(STORE, "readonly");
      const cursor = tx.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return;
        if (typeof at.value === "string") found.set(String(at.key), at.value);
        at.continue();
      };
      tx.oncomplete = () => resolve(found);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * One list, as text.
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function readList(key) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Keep these lists: all of them or none.
 * @param {Array<[string, string]>} entries key and text
 * @returns {Promise<boolean>} whether they are on the device now
 */
export async function writeLists(entries) {
  if (entries.length === 0) return true;
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const [key, text] of entries) store.put(text, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** For tests: forget the open connection. */
export function closeListStore() {
  const was = opening;
  opening = null;
  return was ? was.then((db) => { try { db?.close(); } catch { /* closed */ } }) : Promise.resolve();
}
