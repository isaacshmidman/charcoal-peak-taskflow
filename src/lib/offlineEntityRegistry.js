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
 *   storageKeys?: { cache?: string, queue?: string },
 *   remapFields?: Record<string, string>,
 *   selfRemapFields?: string[],
 *   applyIdSwap?: (ctx: {
 *     queryClient: import("@tanstack/react-query").QueryClient,
 *     cacheKey: string, offlineId: string, realId: string,
 *   }) => void,
 *   normalizeEntry?: (entry: Record<string, any>) => Record<string, any>,
 * }} OfflineEntityDef
 *
 * `storageKeys` pins the localStorage names instead of deriving them —
 * required by the legacy entities, whose queues users already hold under
 * historical key strings (e.g. `taskflow_pending_mutations` for tasks).
 *
 * `remapFields` maps a field to the ENTITY whose replay produced the real
 * id, e.g. `{ task_id: "Task" }`. Resolution uses that entity's in-run map,
 * so registration order is replay order — reference an entity registered
 * before this one.
 *
 * `selfRemapFields` remaps fields against this entity's OWN in-run map
 * (offline subtask → offline parent chains: `["parent_id"]`).
 *
 * `applyIdSwap` replaces the default single-field cache id-swap when an
 * entity needs more (Task also rewrites children's parent_id; DeletedTask
 * additionally write-throughs to the offline cache).
 *
 * `normalizeEntry` runs on every queue read, letting an entity accept a
 * historical entry shape (SavedTag's name-keyed `{type,name}` form).
 *
 * @typedef {{
 *   def: OfflineEntityDef,
 *   queueMutation: (mutation: Record<string, any>) => void,
 *   getPending: () => Array<Record<string, any>>,
 *   setPending: (mutations: Array<Record<string, any>>) => void,
 *   dequeueCreate: (offlineId: string) => void,
 *   dequeueCreateWhere: (predicate: (mutation: Record<string, any>) => boolean) => void,
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
    [def.cacheKey]: def.storageKeys?.cache || `taskflow_offline_${def.cacheKey}`,
    [def.queueKey]: def.storageKeys?.queue || `taskflow_pending_${def.cacheKey}_mutations`,
  });

  const normalize = def.normalizeEntry || ((entry) => entry);
  const getPending = () => (loadFromCache(def.queueKey) || []).map(normalize);
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
    dequeueCreateWhere(predicate) {
      setPending(getPending().filter((m) => !(m.type === "create" && predicate(m))));
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
 * Replay every registered entity's queued mutations, in registration order.
 * Per-mutation try/catch retains failures; created ids are swapped into the
 * query cache; update/delete resolve through the entity's own in-run map and
 * skip ids that are still unsynced. Each entity's map is kept so a LATER
 * entity can resolve cross-entity references via `remapFields`
 * (e.g. `{ task_id: "Task" }`).
 *
 * @param {import("@tanstack/react-query").QueryClient} queryClient
 * @param {Record<string, string>} [seedTaskRemap]  transitional: ids from a
 *   replay loop that still lives outside the registry, merged into the map
 *   named "Task" so `remapFields` resolves during the migration.
 */
export async function replayRegisteredEntities(queryClient, seedTaskRemap = {}) {
  /** entity name → { offlineId: realId } produced during THIS run */
  const remapsByEntity = { Task: { ...seedTaskRemap } };

  for (const handle of registry.values()) {
    const { def } = handle;
    const pending = handle.getPending();
    if (!pending.length) continue;

    const idRemap = remapsByEntity[def.name] || (remapsByEntity[def.name] = {});
    const remaining = [];

    for (const m of pending) {
      try {
        if (m.type === "create") {
          const dataToSend = { ...m.data };
          const offlineId = dataToSend._offlineId;
          delete dataToSend._offlineId;
          // Cross-entity references (field → source entity's map).
          for (const [field, sourceEntity] of Object.entries(def.remapFields || {})) {
            const sourceMap = remapsByEntity[sourceEntity] || {};
            if (dataToSend[field] && sourceMap[dataToSend[field]]) {
              dataToSend[field] = sourceMap[dataToSend[field]];
            }
          }
          // Self references (offline child → offline parent within this run).
          for (const field of def.selfRemapFields || []) {
            if (dataToSend[field] && idRemap[dataToSend[field]]) {
              dataToSend[field] = idRemap[dataToSend[field]];
            }
          }
          const result = await apiClient.entities[def.name].create(dataToSend);
          if (result?.id && offlineId) {
            idRemap[offlineId] = result.id;
            if (def.applyIdSwap) {
              def.applyIdSwap({ queryClient, cacheKey: def.cacheKey, offlineId, realId: result.id });
            } else {
              queryClient.setQueryData([def.cacheKey], (old = []) =>
                /** @type {Array<Record<string, any>>} */ (old).map((r) =>
                  r.id === offlineId ? { ...r, id: result.id } : r
                )
              );
            }
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

/* ── Registrations (module load — before any cache read) ───────────
 * ORDER IS REPLAY ORDER. Entities that others reference come first.
 * Migrated legacy entities pin their historical storage keys so queues
 * written by pre-migration builds keep replaying. */

export const PriorityOffline = registerOfflineEntity({
  name: "Priority",
  cacheKey: "priorities",
  queueKey: "pendingPriorityMutations",
  storageKeys: {
    cache: "taskflow_offline_priorities",
    queue: "taskflow_pending_priority_mutations",
  },
});

export const NoteOffline = registerOfflineEntity({
  name: "Note",
  cacheKey: "notes",
  queueKey: "pendingNoteMutations",
});

export const DeletedNoteOffline = registerOfflineEntity({
  name: "DeletedNote",
  cacheKey: "deletedNotes",
  queueKey: "pendingDeletedNoteMutations",
});
