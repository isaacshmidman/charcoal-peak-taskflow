// @ts-check
/**
 * @file Generic offline support for NEW entities (Note, SavedView, …).
 *
 * The four legacy entities (Task, Priority, SavedTag, DeletedTask) keep
 * their bespoke queues + replay loops in offlineCache.js/useOfflineData.js
 * — each has semantics (parent_id remap, cache write-through, name-keyed
 * tag queues) that a generic loop must not silently approximate. New
 * entities fit one standard shape, implemented once here.
 *
 * Contract:
 * - Register entities at THIS module's top level (bottom of file) so
 *   cache keys exist before anything reads them.
 * - replayRegisteredEntities is called ONLY from useOfflineData's
 *   handleOnline (inside its re-entrancy guards). Do not add online/focus
 *   listeners here — double replay is a data-corruption risk.
 *
 * Standard shape per entity:
 * - create: optimistic record carries _offlineId ("offline_…"); replay
 *   strips it, POSTs, then id-swaps the query cache.
 * - update/delete: ids remapped through the entity's own replay map;
 *   still-offline ids are skipped (their queued create carries the data).
 * - Failed replays are retained in the queue for the next pass.
 */

import { defineCacheKeys, loadFromCache, saveToCache } from "@/lib/offlineCache";
import { apiClient } from "@/api/apiClient";

/**
 * @typedef {{
 *   name: string,        // apiClient.entities key, e.g. "Note"
 *   cacheKey: string,    // react-query key + offline cache key, e.g. "notes"
 *   queueKey: string,    // offline queue cache key, e.g. "pendingNoteMutations"
 *   remapFields?: string[], // fields that may hold offline TASK ids to remap on replay
 * }} OfflineEntityDef
 *
 * @typedef {{
 *   def: OfflineEntityDef,
 *   queueMutation: (mutation: Record<string, any>) => void,
 *   getPending: () => Array<Record<string, any>>,
 *   setPending: (mutations: Array<Record<string, any>>) => void,
 *   dequeueCreate: (offlineId: string) => void,
 *   updateQueuedCreate: (offlineId: string, newData: Record<string, any>) => void,
 * }} OfflineEntityHandle
 */

/** @type {Map<string, OfflineEntityHandle>} */
const registry = new Map();

/**
 * @param {OfflineEntityDef} def
 * @returns {OfflineEntityHandle}
 */
export function registerOfflineEntity(def) {
  defineCacheKeys({
    [def.cacheKey]: `taskflow_offline_${def.cacheKey}`,
    [def.queueKey]: `taskflow_pending_${def.cacheKey}_mutations`,
  });

  const getPending = () => loadFromCache(def.queueKey) || [];
  const setPending = (mutations) => saveToCache(def.queueKey, mutations);

  /** @type {OfflineEntityHandle} */
  const handle = {
    def,
    getPending,
    setPending,
    queueMutation(mutation) {
      setPending([...getPending(), { ...mutation, queuedAt: Date.now() }]);
    },
    dequeueCreate(offlineId) {
      setPending(getPending().filter(
        (m) => !(m.type === "create" && m.data?._offlineId === offlineId)
      ));
    },
    updateQueuedCreate(offlineId, newData) {
      setPending(getPending().map((m) =>
        m.type === "create" && m.data?._offlineId === offlineId
          ? { ...m, data: { ...m.data, ...newData, _offlineId: offlineId } }
          : m
      ));
    },
  };

  registry.set(def.name, handle);
  return handle;
}

/** @param {string} name */
export function getOfflineEntityHandle(name) {
  const handle = registry.get(name);
  if (!handle) throw new Error(`Entity not registered for offline support: ${name}`);
  return handle;
}

/** Cache keys of all registered entities — for useOfflineData's persistence subscription. */
export function registeredCacheKeys() {
  return [...registry.values()].map((h) => h.def.cacheKey);
}

/**
 * Replay all registered entities' queued mutations. Standard loop modeled
 * on the Priority replay in useOfflineData: per-mutation try/catch retains
 * failures; created ids are swapped into the query cache; cross-entity
 * task-id references (remapFields) resolve through sharedIdRemap built by
 * the Task replay that runs before this.
 *
 * @param {import("@tanstack/react-query").QueryClient} queryClient
 * @param {Record<string, string>} [sharedIdRemap]  offline task id → real id
 */
export async function replayRegisteredEntities(queryClient, sharedIdRemap = {}) {
  for (const handle of registry.values()) {
    const { def } = handle;
    const pending = handle.getPending();
    if (!pending.length) continue;

    /** @type {Record<string, string>} */
    const idRemap = {};
    const remaining = [];

    for (const m of pending) {
      try {
        if (m.type === "create") {
          const dataToSend = { ...m.data };
          const offlineId = dataToSend._offlineId;
          delete dataToSend._offlineId;
          for (const field of def.remapFields || []) {
            if (dataToSend[field] && sharedIdRemap[dataToSend[field]]) {
              dataToSend[field] = sharedIdRemap[dataToSend[field]];
            }
          }
          const result = await apiClient.entities[def.name].create(dataToSend);
          if (result?.id && offlineId) {
            idRemap[offlineId] = result.id;
            queryClient.setQueryData([def.cacheKey], (old = []) =>
              /** @type {Array<Record<string, any>>} */ (old).map((r) =>
                r.id === offlineId ? { ...r, id: result.id } : r
              )
            );
          }
        } else if (m.type === "update") {
          const resolvedId = idRemap[m.id] || m.id;
          if (!String(resolvedId).startsWith("offline_")) {
            await apiClient.entities[def.name].update(resolvedId, m.data);
          }
        } else if (m.type === "delete") {
          const resolvedId = idRemap[m.id] || m.id;
          if (!String(resolvedId).startsWith("offline_")) {
            await apiClient.entities[def.name].delete(resolvedId);
          }
        }
      } catch {
        remaining.push(m);
      }
    }

    handle.setPending(remaining);
    queryClient.invalidateQueries({ queryKey: [def.cacheKey] });
  }
}

/* ── Registrations (module load — before any cache read) ─────────── */

export const NoteOffline = registerOfflineEntity({
  name: "Note",
  cacheKey: "notes",
  queueKey: "pendingNoteMutations",
});

export const SavedViewOffline = registerOfflineEntity({
  name: "SavedView",
  cacheKey: "savedViews",
  queueKey: "pendingSavedViewMutations",
});
