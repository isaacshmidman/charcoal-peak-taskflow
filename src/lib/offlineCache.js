/**
 * Simple offline cache using localStorage.
 * Stores app data so Zephyrly can render and queue supported edits offline.
 */
import { appConfig, getStoredLocalSession } from "@/lib/app-config";

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

/**
 * Register cache keys at runtime. Every entity's keys arrive this way,
 * from offlineEntityRegistry at module load — before the first load/save.
 * Keys registered here get the same per-user scope suffix as the built-ins.
 * @param {Record<string, string>} map  e.g. { notes: "taskflow_offline_notes" }
 */
export function defineCacheKeys(map) {
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
 * fit, room is made by dropping the copies of the two Recently Deleted
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
  for (const [storageKey, { key, data }] of batch) {
    let text;
    try {
      text = JSON.stringify(data);
    } catch {
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
