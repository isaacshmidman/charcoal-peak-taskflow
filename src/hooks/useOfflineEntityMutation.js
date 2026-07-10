// @ts-check
/**
 * @file Generic offline-aware create/update/delete for registry-backed
 * entities (Note, SavedView, …) — the standard-shape mirror of the
 * Task-specific useOfflineMutation:
 * - Online: API call; recoverable connection errors fall back to the queue.
 * - Offline: optimistic cache apply + queue for replay (useOfflineData
 *   drains the queue via replayRegisteredEntities on reconnect).
 * - Edits/deletes of a not-yet-synced record ("offline_…" id) fold into
 *   its queued create instead of queueing dead mutations.
 */
import { useQueryClient } from "@tanstack/react-query";
import { isOnline } from "@/lib/offlineCache";
import { isRecoverableConnectionError } from "@/lib/network";
import { apiClient } from "@/api/apiClient";
import { getOfflineEntityHandle } from "@/lib/offlineEntityRegistry";

const createOptimisticId = () => `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * @param {string} entityName  a name registered in offlineEntityRegistry, e.g. "Note"
 */
export function useOfflineEntityMutation(entityName) {
  const queryClient = useQueryClient();
  const handle = getOfflineEntityHandle(entityName);
  const { cacheKey } = handle.def;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [cacheKey] });

  /** @param {(current: Array<Record<string, any>>) => Array<Record<string, any>>} fn */
  const applyToCache = (fn) => {
    const current = /** @type {Array<Record<string, any>>} */ (queryClient.getQueryData([cacheKey]) || []);
    const updated = fn(current);
    queryClient.setQueryData([cacheKey], updated);
    return updated;
  };

  /** @param {Record<string, any>} data */
  const create = async (data) => {
    const optimisticId = createOptimisticId();
    const now = new Date().toISOString();
    const optimistic = { ...data, id: optimisticId, created_date: now, updated_date: now };
    applyToCache((current) => [optimistic, ...current]);
    if (isOnline()) {
      try {
        const result = await apiClient.entities[entityName].create(data);
        applyToCache((current) => current.map((r) => (r.id === optimisticId ? { ...r, ...result } : r)));
        return result;
      } catch (error) {
        if (isRecoverableConnectionError(error)) {
          handle.queueMutation({ type: "create", data: { ...data, _offlineId: optimisticId } });
          return optimistic;
        }
        applyToCache((current) => current.filter((r) => r.id !== optimisticId));
        throw error;
      }
    }
    handle.queueMutation({ type: "create", data: { ...data, _offlineId: optimisticId } });
    return optimistic;
  };

  /**
   * @param {string} id
   * @param {Record<string, any>} data
   */
  const update = async (id, data) => {
    applyToCache((current) =>
      current.map((r) => (r.id === id ? { ...r, ...data, updated_date: new Date().toISOString() } : r))
    );
    if (String(id).startsWith("offline_")) {
      handle.updateQueuedCreate(id, data);
      return;
    }
    if (isOnline()) {
      try {
        await apiClient.entities[entityName].update(id, data);
      } catch (error) {
        if (isRecoverableConnectionError(error)) {
          handle.queueMutation({ type: "update", id, data });
          return;
        }
        invalidate();
        throw error;
      }
    } else {
      handle.queueMutation({ type: "update", id, data });
    }
  };

  /** @param {string} id */
  const remove = async (id) => {
    applyToCache((current) => current.filter((r) => r.id !== id));
    if (String(id).startsWith("offline_")) {
      handle.dequeueCreate(id);
      return;
    }
    if (isOnline()) {
      try {
        await apiClient.entities[entityName].delete(id);
      } catch (error) {
        if (isRecoverableConnectionError(error)) {
          handle.queueMutation({ type: "delete", id });
          return;
        }
        invalidate();
        throw error;
      }
    } else {
      handle.queueMutation({ type: "delete", id });
    }
  };

  return { create, update, remove };
}
