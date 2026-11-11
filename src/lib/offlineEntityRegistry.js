// @ts-check
/**
 * @file THE offline path for every entity. Each one declares its queue,
 * its cache key and any special replay behavior in a single registration
 * block below; producers call the returned handle instead of hand-rolling
 * localStorage access, and one generic loop replays them all.
 *
 * Adding an entity is one registration. Do NOT reintroduce a bespoke
 * replay loop — the four original ones (Task, Priority, SavedTag,
 * DeletedTask) were folded in here precisely because four near-copies of
 * failure-sensitive code is how silent data loss happens. Their quirks
 * survive as declarative options (selfRemapFields, applyIdSwap,
 * normalizeEntry), covered by
 * src/hooks/useOfflineData.characterization.test.jsx — that suite pins the
 * pre-migration behavior and must keep passing untouched.
 *
 * Contract:
 * - Register at THIS module's top level (bottom of file) so cache keys
 *   exist before anything reads them. Registration order IS replay order:
 *   an entity that others reference (Task) goes first.
 * - Entities that predate the registry pin `storageKeys` to their historic
 *   localStorage names — users can hold queued-but-unsynced mutations
 *   there, and renaming a key would strand them.
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

import { defineCacheKeys, loadFromCache, saveToCache, updateDeletedTasksCache } from "@/lib/offlineCache";
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
 * A queued change the server has refused in a way that asking again
 * can't fix. Kept in the queue it would be sent, and refused, every time
 * the app wakes up, for ever.
 *
 * - 404 on an edit or a delete: the record is gone (deleted on another
 *   device). There is nothing left to change, and nothing lost.
 * - 400 / 413 / 422: the server won't take this data, now or later.
 *
 * Everything else stays queued: no answer at all, a server fault (5xx),
 * being signed out (401), and 403 / 409 / 429, which can all be true
 * now and false in a minute.
 *
 * @param {any} error
 * @param {Record<string, any>} mutation
 * @returns {"gone" | "refused" | null}
 */
export function permanentReplayFailure(error, mutation) {
  const status = error?.status;
  if (status === 404 && mutation.type !== "create") return "gone";
  if (status === 400 || status === 413 || status === 422) return "refused";
  return null;
}

/**
 * Replay every registered entity's queued mutations, in registration order.
 * Per-mutation try/catch retains failures; created ids are swapped into the
 * query cache; update/delete resolve through the entity's own in-run map and
 * skip ids that are still unsynced. Each entity's map is kept so a LATER
 * entity can resolve cross-entity references via `remapFields`
 * (e.g. `{ task_id: "Task" }`).
 *
 * Three things keep a shaky reconnection from losing or doubling work:
 * - every create goes out under its offline id (`createKey`), so one whose
 *   answer was lost and is sent again comes back as the same record;
 * - the queue is not overwritten when the pass ends — only what this pass
 *   settled is taken out, so a change queued while it ran is still there;
 * - a change the server will never accept is dropped and reported
 *   (`refused` in the result) instead of being retried for ever.
 *
 * @param {import("@tanstack/react-query").QueryClient} queryClient
 * @param {Record<string, string>} [seedTaskRemap]  transitional: ids from a
 *   replay loop that still lives outside the registry, merged into the map
 *   named "Task" so `remapFields` resolves during the migration.
 * @returns {Promise<{ refused: Array<{ entity: string, type: string, title: string, message: string }> }>}
 */
export async function replayRegisteredEntities(queryClient, seedTaskRemap = {}) {
  /** entity name → { offlineId: realId } produced during THIS run */
  const remapsByEntity = { Task: { ...seedTaskRemap } };
  /** @type {Array<{ entity: string, type: string, title: string, message: string }>} */
  const refused = [];

  for (const handle of registry.values()) {
    const { def } = handle;
    const pending = handle.getPending();
    if (!pending.length) continue;

    const idRemap = remapsByEntity[def.name] || (remapsByEntity[def.name] = {});
    /** Entries this pass is finished with, as they were read. */
    const settled = [];

    const remapped = (/** @type {Record<string, any>} */ data) => {
      const out = { ...data };
      delete out._offlineId;
      // Cross-entity references (field → source entity's map).
      for (const [field, sourceEntity] of Object.entries(def.remapFields || {})) {
        const sourceMap = remapsByEntity[sourceEntity] || {};
        if (out[field] && sourceMap[out[field]]) out[field] = sourceMap[out[field]];
      }
      // Self references (offline child → offline parent within this run).
      for (const field of def.selfRemapFields || []) {
        if (out[field] && idRemap[out[field]]) out[field] = idRemap[out[field]];
      }
      return out;
    };

    for (const m of pending) {
      try {
        if (m.type === "create") {
          const offlineId = m.data?._offlineId;
          const dataToSend = remapped(m.data);
          const result = offlineId
            ? await apiClient.entities[def.name].create(dataToSend, { createKey: offlineId })
            : await apiClient.entities[def.name].create(dataToSend);
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
        settled.push(m);
      } catch (error) {
        const why = permanentReplayFailure(error, m);
        if (!why) continue; // stays queued for the next pass
        settled.push(m);
        if (why === "refused") {
          refused.push({
            entity: def.name,
            type: m.type,
            title: String(m.data?.title || m.data?.name || ""),
            message: String(/** @type {any} */ (error)?.message || ""),
          });
        }
      }
    }

    // Take out what this pass settled — and only that. The queue is read
    // again because it may have changed while requests were in flight.
    const settledCounts = new Map();
    for (const m of settled) {
      const key = JSON.stringify(m);
      settledCounts.set(key, (settledCounts.get(key) || 0) + 1);
    }
    const remaining = [];
    for (const entry of handle.getPending()) {
      const key = JSON.stringify(entry);
      const count = settledCounts.get(key) || 0;
      if (count > 0) {
        settledCounts.set(key, count - 1);
        continue;
      }
      const realId = entry.type === "create" ? idRemap[entry.data?._offlineId] : undefined;
      if (!realId) {
        remaining.push(entry);
        continue;
      }
      // A create that went out in this pass and was edited before its
      // answer came back: the record exists, so the edit is an update.
      const update = { type: "update", id: realId, data: remapped(entry.data), queuedAt: entry.queuedAt };
      try {
        await apiClient.entities[def.name].update(realId, update.data);
      } catch (error) {
        if (!permanentReplayFailure(error, update)) remaining.push(update);
      }
    }

    handle.setPending(remaining);
    queryClient.invalidateQueries({ queryKey: [def.cacheKey] });
  }

  return { refused };
}

/* ── Registrations (module load — before any cache read) ───────────
 * ORDER IS REPLAY ORDER. Entities that others reference come first.
 * Migrated legacy entities pin their historical storage keys so queues
 * written by pre-migration builds keep replaying. */

// Task FIRST: later entities (Note's task_id, DeletedTask records) resolve
// their references against the map this replay produces.
export const TaskOffline = registerOfflineEntity({
  name: "Task",
  cacheKey: "tasks",
  queueKey: "pendingMutations",
  storageKeys: {
    cache: "taskflow_offline_tasks",
    queue: "taskflow_pending_mutations",
  },
  // A subtask created offline points at a parent that may also still be
  // offline; the parent is created first, so its real id is available.
  selfRemapFields: ["parent_id"],
  // Two-field swap: the created row's own id AND any child rows still
  // pointing at the old offline parent id.
  applyIdSwap({ queryClient, cacheKey, offlineId, realId }) {
    queryClient.setQueryData([cacheKey], (old = []) =>
      /** @type {Array<Record<string, any>>} */ (old).map((t) => {
        if (t.id === offlineId) return { ...t, id: realId };
        if (t.parent_id === offlineId) return { ...t, parent_id: realId };
        return t;
      })
    );
  },
});

export const PriorityOffline = registerOfflineEntity({
  name: "Priority",
  cacheKey: "priorities",
  queueKey: "pendingPriorityMutations",
  storageKeys: {
    cache: "taskflow_offline_priorities",
    queue: "taskflow_pending_priority_mutations",
  },
});

export const DeletedTaskOffline = registerOfflineEntity({
  name: "DeletedTask",
  cacheKey: "deletedTasks",
  queueKey: "pendingDeletedTaskMutations",
  storageKeys: {
    cache: "taskflow_offline_deletedTasks",
    queue: "taskflow_pending_deleted_task_mutations",
  },
  // Beyond the query-cache swap, the trash's offline cache is written
  // through so a reload before the next fetch still shows real ids.
  applyIdSwap({ queryClient, cacheKey, offlineId, realId }) {
    const cached = /** @type {Array<Record<string, any>>} */ (queryClient.getQueryData([cacheKey]) || []);
    const updated = cached.map((r) => (r.id === offlineId ? { ...r, id: realId } : r));
    queryClient.setQueryData([cacheKey], updated);
    updateDeletedTasksCache(updated);
  },
});

export const SavedTagOffline = registerOfflineEntity({
  name: "SavedTag",
  cacheKey: "savedTags",
  queueKey: "pendingTagMutations",
  storageKeys: {
    cache: "taskflow_offline_savedTags",
    queue: "taskflow_pending_tag_mutations",
  },
  // Tags are the one legacy entity with a non-standard entry: creates are
  // name-keyed (`{type:'create', name}`) with no data wrapper and no
  // _offlineId, because a tag is identified by its name and nothing ever
  // references a tag's id. Producers still WRITE that shape, so the at-rest
  // format is unchanged; this lifts it to the standard `data` form on read.
  // Anything rewritten (a retained failure) stays a superset that keeps
  // `name`, so an older build could still read it.
  normalizeEntry: (m) =>
    m.type === "create" && !m.data && m.name ? { ...m, data: { name: m.name } } : m,
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
