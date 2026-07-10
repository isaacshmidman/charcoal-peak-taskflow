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
 * Register additional cache keys at runtime (used by offlineEntityRegistry
 * for new entities like Note/SavedView). Keys registered here get the same
 * per-user scope suffix as the built-ins. Must run before the first
 * load/save of the key — the registry does this at module load.
 * @param {Record<string, string>} map  e.g. { notes: "taskflow_offline_notes" }
 */
export function defineCacheKeys(map) {
  for (const [key, storageKey] of Object.entries(map)) {
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

// Queue a mutation to be replayed when back online
export function queueMutation(mutation) {
  try {
    const pending = loadFromCache('pendingMutations') || [];
    pending.push({ ...mutation, queuedAt: Date.now() });
    localStorage.setItem(resolveStorageKey('pendingMutations'), JSON.stringify(pending));
  } catch {}
}

export function getPendingMutations() {
  return loadFromCache('pendingMutations') || [];
}

export function clearPendingMutations() {
  localStorage.removeItem(resolveStorageKey('pendingMutations'));
}

export function setPendingMutations(mutations) {
  try {
    localStorage.setItem(resolveStorageKey('pendingMutations'), JSON.stringify(mutations));
  } catch {}
}

// Remove a queued offline create by its _offlineId (used when user deletes an unsaved task)
export function dequeueOfflineCreate(offlineId) {
  try {
    const pending = loadFromCache('pendingMutations') || [];
    const updated = pending.filter(m => !(m.type === 'create' && m.data?._offlineId === offlineId));
    localStorage.setItem(resolveStorageKey('pendingMutations'), JSON.stringify(updated));
  } catch {}
}

// Merge new data into a queued create mutation (used when user edits an unsaved task offline)
export function updateQueuedCreate(offlineId, newData) {
  try {
    const pending = loadFromCache('pendingMutations') || [];
    const updated = pending.map(m => {
      if (m.type === 'create' && m.data?._offlineId === offlineId) {
        return { ...m, data: { ...m.data, ...newData, _offlineId: offlineId } };
      }
      return m;
    });
    localStorage.setItem(resolveStorageKey('pendingMutations'), JSON.stringify(updated));
  } catch {}
}



// Remove a queued offline priority create by its _offlineId
export function dequeuePriorityCreate(offlineId) {
  try {
    const pending = loadFromCache('pendingPriorityMutations') || [];
    const updated = pending.filter(m => !(m.type === 'create' && m.data?._offlineId === offlineId));
    localStorage.setItem(resolveStorageKey('pendingPriorityMutations'), JSON.stringify(updated));
  } catch {}
}

// Remove a queued offline tag create by its name (tags queue by name, not _offlineId)
export function dequeueTagCreate(name) {
  try {
    const pending = loadFromCache('pendingTagMutations') || [];
    const updated = pending.filter(m => !(m.type === 'create' && m.name === name));
    localStorage.setItem(resolveStorageKey('pendingTagMutations'), JSON.stringify(updated));
  } catch {}
}

// Remove a queued offline deleted-task create by its _offlineId
export function dequeueDeletedTaskCreate(offlineId) {
  try {
    const pending = loadFromCache('pendingDeletedTaskMutations') || [];
    const updated = pending.filter(m => !(m.type === 'create' && m.data?._offlineId === offlineId));
    localStorage.setItem(resolveStorageKey('pendingDeletedTaskMutations'), JSON.stringify(updated));
  } catch {}
}

// Queue priority mutations for replay when back online
export function queuePriorityMutation(mutation) {
  try {
    const pending = loadFromCache('pendingPriorityMutations') || [];
    pending.push({ ...mutation, queuedAt: Date.now() });
    localStorage.setItem(resolveStorageKey('pendingPriorityMutations'), JSON.stringify(pending));
  } catch {}
}

export function getPendingPriorityMutations() {
  return loadFromCache('pendingPriorityMutations') || [];
}

export function clearPendingPriorityMutations() {
  localStorage.removeItem(resolveStorageKey('pendingPriorityMutations'));
}

export function setPendingPriorityMutations(mutations) {
  try {
    localStorage.setItem(resolveStorageKey('pendingPriorityMutations'), JSON.stringify(mutations));
  } catch {}
}



// Queue tag mutations for replay when back online
export function queueTagMutation(mutation) {
  try {
    const pending = loadFromCache('pendingTagMutations') || [];
    pending.push({ ...mutation, queuedAt: Date.now() });
    localStorage.setItem(resolveStorageKey('pendingTagMutations'), JSON.stringify(pending));
  } catch {}
}

export function getPendingTagMutations() {
  return loadFromCache('pendingTagMutations') || [];
}

export function clearPendingTagMutations() {
  localStorage.removeItem(resolveStorageKey('pendingTagMutations'));
}

export function setPendingTagMutations(mutations) {
  try {
    localStorage.setItem(resolveStorageKey('pendingTagMutations'), JSON.stringify(mutations));
  } catch {}
}

// Queue deleted task mutations for replay when back online
export function queueDeletedTaskMutation(mutation) {
  try {
    const pending = loadFromCache('pendingDeletedTaskMutations') || [];
    pending.push({ ...mutation, queuedAt: Date.now() });
    localStorage.setItem(resolveStorageKey('pendingDeletedTaskMutations'), JSON.stringify(pending));
  } catch {}
}

export function getPendingDeletedTaskMutations() {
  return loadFromCache('pendingDeletedTaskMutations') || [];
}

export function clearPendingDeletedTaskMutations() {
  localStorage.removeItem(resolveStorageKey('pendingDeletedTaskMutations'));
}

export function setPendingDeletedTaskMutations(mutations) {
  try {
    localStorage.setItem(resolveStorageKey('pendingDeletedTaskMutations'), JSON.stringify(mutations));
  } catch {}
}

// Recently deleted: save a deleted task record to the local cache
export function saveDeletedTaskToCache(record) {
  try {
    const existing = loadFromCache('deletedTasks') || [];
    existing.unshift(record);
    localStorage.setItem(resolveStorageKey('deletedTasks'), JSON.stringify(existing));
  } catch {}
}

export function loadDeletedTasksFromCache() {
  return loadFromCache('deletedTasks') || [];
}

export function removeDeletedTaskFromCache(id) {
  try {
    const existing = loadFromCache('deletedTasks') || [];
    const updated = existing.filter(r => r.id !== id);
    localStorage.setItem(resolveStorageKey('deletedTasks'), JSON.stringify(updated));
  } catch {}
}

export function updateDeletedTasksCache(records) {
  try {
    localStorage.setItem(resolveStorageKey('deletedTasks'), JSON.stringify(records));
  } catch {}
}
