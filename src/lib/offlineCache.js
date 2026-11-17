/**
 * What the app keeps on the device so it can open and be used offline.
 *
 * Two kinds of thing, kept in two places:
 *
 *   - The big lists (tasks, notes, …) are in IndexedDB
 *     (lib/offlineListStore.js), which has room for them, with a copy in
 *     memory so they can still be read at once. hydrateOfflineCopy() fills
 *     that memory before the app first draws.
 *   - Everything else is in localStorage: the queues of changes made
 *     offline (a queued change has to be on the device before the app
 *     says it is kept, and only localStorage writes at once), and small
 *     settings.
 *
 * A browser with no usable IndexedDB keeps the lists in localStorage too,
 * as every browser did before; nothing else changes for it.
 */
import { appConfig, getStoredLocalSession } from "@/lib/app-config";
import { readAllLists, readList, writeLists } from "@/lib/offlineListStore";

const KEYS = {
  tasks: 'taskflow_offline_tasks',
  priorities: 'taskflow_offline_priorities',
  savedTags: 'taskflow_offline_savedTags',
  deletedTasks: 'taskflow_offline_deletedTasks',
  integrations: 'taskflow_offline_integrations',
  integrationCalendars: 'taskflow_offline_integration_calendars',
  notificationSettings: 'taskflow_offline_notification_settings',
  publicSettings: 'taskflow_public_settings',
  pendingMutations: 'taskflow_pending_mutations',
  pendingPriorityMutations: 'taskflow_pending_priority_mutations',
  pendingTagMutations: 'taskflow_pending_tag_mutations',
  pendingDeletedTaskMutations: 'taskflow_pending_deleted_task_mutations',
};

const SCOPED_KEYS = new Set([
  'tasks',
  'priorities',
  'savedTags',
  'deletedTasks',
  'integrations',
  'integrationCalendars',
  'notificationSettings',
  'publicSettings',
  'pendingMutations',
  'pendingPriorityMutations',
  'pendingTagMutations',
  'pendingDeletedTaskMutations',
]);

/** The big lists: the ones that live in IndexedDB. */
const LIST_KEYS = new Set(['tasks', 'priorities', 'savedTags', 'deletedTasks']);

/**
 * Register cache keys at runtime. Every entity's keys arrive this way,
 * from offlineEntityRegistry at module load — before the first load/save.
 * Keys registered here get the same per-user scope suffix as the built-ins.
 * @param {Record<string, string>} map  e.g. { notes: "taskflow_offline_notes" }
 * @param {{ lists?: string[] }} [how] which of them are lists of records
 *   (kept in IndexedDB) rather than queues or settings
 */
export function defineCacheKeys(map, how = {}) {
  for (const key of how.lists || []) LIST_KEYS.add(key);
  for (const [key, storageKey] of Object.entries(map)) {
    // Re-declaring a key with the SAME string is fine (a migrated legacy
    // entity re-declares the key this module already owns). A DIFFERENT
    // string would silently shadow existing queues, stranding whatever
    // users have pending — so that's a hard error.
    if (KEYS[key] && KEYS[key] !== storageKey) {
      throw new Error(
        `Offline cache key "${key}" is already mapped to "${KEYS[key]}"; refusing to remap to "${storageKey}".`
      );
    }
    KEYS[key] = storageKey;
    SCOPED_KEYS.add(key);
  }
}

function getScopeSuffix() {
  const session = getStoredLocalSession();
  const appId = String(appConfig.appId || localStorage.getItem("taskflow_app_id") || "default_app").trim();
  const userKey = String(session?.email || session?.id || "guest").trim().toLowerCase();
  return `${appId}::${userKey}`;
}

function resolveStorageKey(key) {
  const baseKey = KEYS[key];
  if (!baseKey) {
    throw new Error(`Unknown offline cache key: ${key}`);
  }

  if (!SCOPED_KEYS.has(key)) return baseKey;
  return `${baseKey}::${getScopeSuffix()}`;
}

function getLegacyStorageKey(key) {
  return KEYS[key];
}

/**
 * Write a value now. Queues of changes waiting to be sent use this: a
 * queued change has to be on disk before the app says it is kept.
 *
 * The browser gives a site a few megabytes here. When a write doesn't
 * fit, room is made by dropping the copies of the two Recently deleted
 * lists (the server has them; they are the cheapest thing to lose), and
 * if it still doesn't fit the app is told (STORAGE_FULL_EVENT) rather
 * than left believing the change was kept.
 *
 * @returns {boolean} whether it was written
 */
export function saveToCache(key, data) {
  let storageKey;
  let text;
  try {
    storageKey = resolveStorageKey(key);
    text = JSON.stringify(data);
  } catch {
    return false;
  }
  waiting.delete(storageKey);
  if (listsInIdb && LIST_KEYS.has(key)) {
    mirror.set(storageKey, data);
    storeLists([{ storageKey, key, data, text }]);
    return true;
  }
  if (write(storageKey, text)) {
    lastWritten.set(storageKey, data);
    return true;
  }
  for (const spare of SPARE_KEYS) {
    if (spare === key || !KEYS[spare]) continue;
    try {
      localStorage.removeItem(resolveStorageKey(spare));
    } catch {}
    if (write(storageKey, text)) {
      lastWritten.set(storageKey, data);
      reportStorage({ key, kept: true, madeRoom: true });
      return true;
    }
  }
  reportStorage({ key, kept: false });
  return false;
}

/** What is given up first when the device's storage is full. */
const SPARE_KEYS = ["deletedNotes", "deletedTasks"];

/**
 * Fired on `window` when a write didn't fit, with
 * `detail: { key, kept, madeRoom? }` — `kept: false` means it is not on
 * this device.
 */
export const STORAGE_FULL_EVENT = "zephyrly:storage-full";

function write(storageKey, text) {
  try {
    localStorage.setItem(storageKey, text);
    return true;
  } catch {
    return false;
  }
}

function reportStorage(detail) {
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail }));
  } catch {}
}

/* ── The offline copy of each list ─────────────────────────────────
 *
 * Every list the app shows is also kept here so it can be read with no
 * connection. Keeping it used to mean writing the whole list out again
 * on every twitch of the app's data — several times per page opened,
 * three times per task ticked — and for a few thousand tasks each write
 * is megabytes of text, written while the person is waiting for the
 * click to land.
 *
 * So a list is written:
 *   - only if it is not the very list that was written last;
 *   - a moment later, once, however many times it changed in between;
 *   - straight away when there is no connection (every change made
 *     offline exists nowhere else), and when the page is being hidden or
 *     closed.
 * Anything that reads the copy first writes out whatever is waiting, so a
 * reader never sees an older list than the app has.
 */
const SNAPSHOT_DELAY_MS = 400;
/** storage key → the value last written there (the same object, not a copy) */
const lastWritten = new Map();
/** storage key → { key, data } still to be written */
const waiting = new Map();
/** storage keys whose latest list didn't fit */
const outOfDate = new Set();
let snapshotTimer = null;

/**
 * Keep `data` as the offline copy of `key`, soon. The place it is written
 * is settled now, not when the write happens: signing out in between must
 * not put one person's list under another's name.
 */
export function saveSnapshot(key, data) {
  let storageKey;
  try {
    storageKey = resolveStorageKey(key);
  } catch {
    return;
  }
  if (!waiting.has(storageKey) && lastWritten.get(storageKey) === data) return;
  // Readers get the newest list from now on, whenever it reaches the disk.
  if (listsInIdb && LIST_KEYS.has(key)) mirror.set(storageKey, data);
  waiting.set(storageKey, { key, data });
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    flushSnapshots();
    return;
  }
  if (snapshotTimer === null) snapshotTimer = setTimeout(flushSnapshots, SNAPSHOT_DELAY_MS);
}

/** Write out every list that is waiting. */
export function flushSnapshots() {
  if (snapshotTimer !== null) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  if (!waiting.size) return;
  const batch = [...waiting];
  waiting.clear();
  const lists = [];
  for (const [storageKey, { key, data }] of batch) {
    let text;
    try {
      text = JSON.stringify(data);
    } catch {
      continue;
    }
    if (listsInIdb && LIST_KEYS.has(key)) {
      lists.push({ storageKey, key, data, text });
      continue;
    }
    if (write(storageKey, text)) {
      lastWritten.set(storageKey, data);
      if (outOfDate.delete(storageKey)) reportStorage({ key, kept: true });
    } else {
      // The older copy stays: an out-of-date list still beats none. But
      // it is no longer what the app shows, and the app is told so.
      lastWritten.delete(storageKey);
      if (!outOfDate.has(storageKey)) {
        outOfDate.add(storageKey);
        reportStorage({ key, kept: false });
      }
    }
  }
  storeLists(lists);
}

/* ── The big lists, in IndexedDB ───────────────────────────────────
 *
 * IndexedDB answers later, and the app reads its lists at once (to draw
 * the first screen, to answer a read with no connection). So what
 * IndexedDB holds is also held here in memory: filled once before the
 * app draws (hydrateOfflineCopy), and from then on changed first, with
 * the disk following.
 */
/** storage key → the list as the app last had it */
const mirror = new Map();
/** Whether the lists live in IndexedDB on this visit (else localStorage, as before). */
let listsInIdb = false;
/** @type {Promise<boolean> | null} */
let hydration = null;
/** Tells this device's other tabs which lists were just written. */
let otherTabs = null;
const TABS_CHANNEL = "zephyrly-offline-copy";

/** Whether a localStorage key holds one of the big lists (for any person). */
function isListStorageKey(storageKey) {
  for (const key of LIST_KEYS) {
    const base = KEYS[key];
    if (base && (storageKey === base || storageKey.startsWith(`${base}::`))) return true;
  }
  return false;
}

/**
 * Read the lists kept on this device into memory. Call once, before the
 * app first draws; it always settles, and quickly.
 *
 * Lists found in localStorage are moved across: they are from before the
 * lists lived in IndexedDB, or from a visit when IndexedDB wouldn't open,
 * and either way they are newer than what IndexedDB has. A list is taken
 * out of localStorage only once it is safely in IndexedDB.
 *
 * @returns {Promise<boolean>} whether the lists are in IndexedDB on this visit
 */
export function hydrateOfflineCopy() {
  if (!hydration) hydration = hydrate().catch(() => false);
  return hydration;
}

async function hydrate() {
  const stored = await readAllLists();
  if (!stored) return false;
  for (const [storageKey, text] of stored) {
    try {
      mirror.set(storageKey, JSON.parse(text));
    } catch {
      /* unreadable: as good as absent */
    }
  }
  /** @type {Array<[string, string]>} */
  const toMove = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index);
      if (!storageKey || !isListStorageKey(storageKey)) continue;
      const text = localStorage.getItem(storageKey);
      if (text == null) continue;
      try {
        mirror.set(storageKey, JSON.parse(text));
        toMove.push([storageKey, text]);
      } catch {
        /* unreadable where it is: left alone */
      }
    }
  } catch {
    /* localStorage refused: nothing to move */
  }
  listsInIdb = true;
  listenToOtherTabs();
  if (toMove.length) {
    // Not waited for: the lists are in memory already, and a move that
    // doesn't finish is simply made again next time.
    writeLists(toMove).then((moved) => {
      if (!moved) return;
      for (const [storageKey] of toMove) {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* stays; moved again next time, harmlessly */
        }
      }
    });
  }
  return true;
}

/**
 * Put lists on the disk. The app goes on at once; when the disk has no
 * room it is told, exactly as it is for localStorage.
 * @param {Array<{ storageKey: string, key: string, data: any, text: string }>} lists
 */
function storeLists(lists) {
  if (!lists.length) return;
  // Said to be written from now, so the same list isn't sent twice while
  // this is on its way, and a list that goes back to an earlier one is.
  for (const { storageKey, data } of lists) lastWritten.set(storageKey, data);
  writeLists(lists.map(({ storageKey, text }) => [storageKey, text])).then((stored) => {
    for (const { storageKey, key, data } of lists) {
      if (stored) {
        if (outOfDate.delete(storageKey)) reportStorage({ key, kept: true });
        continue;
      }
      // The older copy stays on the disk; the app is told once.
      if (lastWritten.get(storageKey) === data) lastWritten.delete(storageKey);
      if (!outOfDate.has(storageKey)) {
        outOfDate.add(storageKey);
        reportStorage({ key, kept: false });
      }
    }
    if (stored) {
      try {
        otherTabs?.postMessage({ keys: lists.map(({ storageKey }) => storageKey) });
      } catch {
        /* the other tabs find out when they next start */
      }
    }
  });
}

/**
 * Another tab wrote a list: take it into this tab's memory, as reading
 * localStorage used to give every tab the newest copy. A list this tab is
 * itself about to write is left alone.
 */
function listenToOtherTabs() {
  if (otherTabs || typeof BroadcastChannel === "undefined") return;
  try {
    otherTabs = new BroadcastChannel(TABS_CHANNEL);
    otherTabs.onmessage = async (event) => {
      const keys = Array.isArray(event?.data?.keys) ? event.data.keys : [];
      for (const storageKey of keys) {
        if (typeof storageKey !== "string" || waiting.has(storageKey)) continue;
        const text = await readList(storageKey);
        if (text == null || waiting.has(storageKey)) continue;
        try {
          mirror.set(storageKey, JSON.parse(text));
        } catch {
          /* unreadable: keep what this tab has */
        }
      }
    };
    // Never the reason a page can't be put away.
    /** @type {any} */ (otherTabs).unref?.();
  } catch {
    otherTabs = null;
  }
}

/** For tests: as if the page had just been opened. */
export function forgetOfflineCopyInMemory() {
  mirror.clear();
  lastWritten.clear();
  waiting.clear();
  outOfDate.clear();
  listsInIdb = false;
  hydration = null;
  try {
    otherTabs?.close();
  } catch {
    /* closed */
  }
  otherTabs = null;
}

/** Whether any list's offline copy is behind what the app shows. */
export function offlineCopyIsBehind() {
  return outOfDate.size > 0;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSnapshots);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSnapshots();
  });
}

export function loadFromCache(key) {
  if (listsInIdb && LIST_KEYS.has(key)) {
    try {
      const own = mirror.get(resolveStorageKey(key));
      return own ?? mirror.get(getLegacyStorageKey(key)) ?? null;
    } catch {
      return null;
    }
  }
  if (waiting.size) flushSnapshots();
  try {
    const raw = localStorage.getItem(resolveStorageKey(key)) ?? localStorage.getItem(getLegacyStorageKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isOnline() {
  return navigator.onLine;
}





export function updateDeletedTasksCache(records) {
  saveToCache("deletedTasks", records);
}
