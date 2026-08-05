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

export function saveToCache(key, data) {
  try {
    localStorage.setItem(resolveStorageKey(key), JSON.stringify(data));
  } catch {}
}

export function loadFromCache(key) {
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
  try {
    localStorage.setItem(resolveStorageKey('deletedTasks'), JSON.stringify(records));
  } catch {}
}
