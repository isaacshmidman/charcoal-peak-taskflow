/**
 * Simple offline cache using localStorage.
 * Stores tasks and priorities so the app can render when offline.
 */

const KEYS = {
  tasks: 'taskflow_offline_tasks',
  priorities: 'taskflow_offline_priorities',
  savedTags: 'taskflow_offline_savedTags',
  deletedTasks: 'taskflow_offline_deletedTasks',
  pendingMutations: 'taskflow_pending_mutations',
  pendingPriorityMutations: 'taskflow_pending_priority_mutations',
  pendingTagMutations: 'taskflow_pending_tag_mutations',
  pendingDeletedTaskMutations: 'taskflow_pending_deleted_task_mutations',
};

export function saveToCache(key, data) {
  try {
    localStorage.setItem(KEYS[key], JSON.stringify(data));
  } catch {}
}

export function loadFromCache(key) {
  try {
    const raw = localStorage.getItem(KEYS[key]);
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
    localStorage.setItem(KEYS.pendingMutations, JSON.stringify(pending));
  } catch {}
}

export function getPendingMutations() {
  return loadFromCache('pendingMutations') || [];
}

export function clearPendingMutations() {
  localStorage.removeItem(KEYS.pendingMutations);
}

// Remove a queued offline create by its _offlineId (used when user deletes an unsaved task)
export function dequeueOfflineCreate(offlineId) {
  try {
    const pending = loadFromCache('pendingMutations') || [];
    const updated = pending.filter(m => !(m.type === 'create' && m.data?._offlineId === offlineId));
    localStorage.setItem(KEYS.pendingMutations, JSON.stringify(updated));
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
    localStorage.setItem(KEYS.pendingMutations, JSON.stringify(updated));
  } catch {}
}



// Queue priority mutations for replay when back online
export function queuePriorityMutation(mutation) {
  try {
    const pending = loadFromCache('pendingPriorityMutations') || [];
    pending.push({ ...mutation, queuedAt: Date.now() });
    localStorage.setItem(KEYS.pendingPriorityMutations, JSON.stringify(pending));
  } catch {}
}

export function getPendingPriorityMutations() {
  return loadFromCache('pendingPriorityMutations') || [];
}

export function clearPendingPriorityMutations() {
  localStorage.removeItem(KEYS.pendingPriorityMutations);
}



// Queue tag mutations for replay when back online
export function queueTagMutation(mutation) {
  try {
    const pending = loadFromCache('pendingTagMutations') || [];
    pending.push({ ...mutation, queuedAt: Date.now() });
    localStorage.setItem(KEYS.pendingTagMutations, JSON.stringify(pending));
  } catch {}
}

export function getPendingTagMutations() {
  return loadFromCache('pendingTagMutations') || [];
}

export function clearPendingTagMutations() {
  localStorage.removeItem(KEYS.pendingTagMutations);
}

// Queue deleted task mutations for replay when back online
export function queueDeletedTaskMutation(mutation) {
  try {
    const pending = loadFromCache('pendingDeletedTaskMutations') || [];
    pending.push({ ...mutation, queuedAt: Date.now() });
    localStorage.setItem(KEYS.pendingDeletedTaskMutations, JSON.stringify(pending));
  } catch {}
}

export function getPendingDeletedTaskMutations() {
  return loadFromCache('pendingDeletedTaskMutations') || [];
}

export function clearPendingDeletedTaskMutations() {
  localStorage.removeItem(KEYS.pendingDeletedTaskMutations);
}

// Recently deleted: save a deleted task record to the local cache
export function saveDeletedTaskToCache(record) {
  try {
    const existing = loadFromCache('deletedTasks') || [];
    existing.unshift(record);
    localStorage.setItem(KEYS.deletedTasks, JSON.stringify(existing));
  } catch {}
}

export function loadDeletedTasksFromCache() {
  return loadFromCache('deletedTasks') || [];
}

export function removeDeletedTaskFromCache(id) {
  try {
    const existing = loadFromCache('deletedTasks') || [];
    const updated = existing.filter(r => r.id !== id);
    localStorage.setItem(KEYS.deletedTasks, JSON.stringify(updated));
  } catch {}
}

export function updateDeletedTasksCache(records) {
  try {
    localStorage.setItem(KEYS.deletedTasks, JSON.stringify(records));
  } catch {}
}
