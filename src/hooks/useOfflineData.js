// @ts-nocheck
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveToCache, getPendingMutations, clearPendingMutations, getPendingPriorityMutations, clearPendingPriorityMutations, getPendingTagMutations, clearPendingTagMutations, getPendingDeletedTaskMutations, clearPendingDeletedTaskMutations, updateDeletedTasksCache } from '@/lib/offlineCache';
import { base44 } from '@/api/base44Client';

const CACHE_KEYS = ['tasks', 'priorities', 'savedTags', 'deletedTasks'];

/**
 * Hook that:
 * 1. Persists query cache data to localStorage on every data update (catches API fetches + optimistic setQueryData).
 * 2. Replays pending mutations when coming back online.
 */
export function useOfflineData() {
  const queryClient = useQueryClient();

  // Persist to localStorage whenever query data actually changes (API fetches + optimistic setQueryData).
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (!event?.query) return;
      const key = event.query.queryKey[0];
      if (!CACHE_KEYS.includes(key)) return;
      const data = event.query.state.data;
      if (data !== undefined) saveToCache(key, data);
    });

    return unsubscribe;
  }, [queryClient]);

  // Replay pending mutations when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      // --- Task mutations ---
      const pending = getPendingMutations();
      const idRemap = {};
      for (const m of pending) {
        try {
          if (m.type === 'create') {
            const dataToSend = { ...m.data };
            delete dataToSend._offlineId;
            if (dataToSend.parent_id && idRemap[dataToSend.parent_id]) {
              dataToSend.parent_id = idRemap[dataToSend.parent_id];
            }
            const result = await base44.entities.Task.create(dataToSend);
            if (result?.id && m.data._offlineId) {
              idRemap[m.data._offlineId] = result.id;
              queryClient.setQueryData(['tasks'], (old = []) =>
                old.map(t => {
                  if (t.id === m.data._offlineId) return { ...t, id: result.id };
                  if (t.parent_id === m.data._offlineId) return { ...t, parent_id: result.id };
                  return t;
                })
              );
            }
          } else if (m.type === 'update') {
            const resolvedId = idRemap[m.id] || m.id;
            if (!String(resolvedId).startsWith('offline_')) {
              await base44.entities.Task.update(resolvedId, m.data);
            }
          } else if (m.type === 'delete') {
            if (!String(m.id).startsWith('offline_')) {
              await base44.entities.Task.delete(m.id).catch(() => {});
            }
          }
        } catch {}
      }
      if (pending.length) {
        clearPendingMutations();
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }

      // --- Priority mutations ---
      const pendingPriorities = getPendingPriorityMutations();
      const priorityIdRemap = {};
      for (const m of pendingPriorities) {
        try {
          if (m.type === 'create') {
            const dataToSend = { ...m.data };
            delete dataToSend._offlineId;
            const result = await base44.entities.Priority.create(dataToSend);
            if (result?.id && m.data?._offlineId) {
              priorityIdRemap[m.data._offlineId] = result.id;
              queryClient.setQueryData(['priorities'], (old = []) =>
                old.map(p => p.id === m.data._offlineId ? { ...p, id: result.id } : p)
              );
            }
          } else if (m.type === 'update') {
            const resolvedId = priorityIdRemap[m.id] || m.id;
            if (!String(resolvedId).startsWith('offline_')) {
              await base44.entities.Priority.update(resolvedId, m.data);
            }
          } else if (m.type === 'delete') {
            const resolvedId = priorityIdRemap[m.id] || m.id;
            if (!String(resolvedId).startsWith('offline_')) {
              await base44.entities.Priority.delete(resolvedId).catch(() => {});
            }
          }
        } catch {}
      }
      if (pendingPriorities.length) {
        clearPendingPriorityMutations();
        queryClient.invalidateQueries({ queryKey: ['priorities'] });
      }

      // --- Tag mutations ---
      const pendingTags = getPendingTagMutations();
      for (const m of pendingTags) {
        try {
          if (m.type === 'create') await base44.entities.SavedTag.create({ name: m.name });
          else if (m.type === 'delete') await base44.entities.SavedTag.delete(m.id).catch(() => {});
        } catch {}
      }
      if (pendingTags.length) {
        clearPendingTagMutations();
        queryClient.invalidateQueries({ queryKey: ['savedTags'] });
      }

      // --- DeletedTask mutations ---
      const pendingDeleted = getPendingDeletedTaskMutations();
      const deletedIdRemap = {};
      for (const m of pendingDeleted) {
        try {
          if (m.type === 'create') {
            const dataToSend = { ...m.data };
            const offlineId = dataToSend._offlineId;
            delete dataToSend._offlineId;
            const result = await base44.entities.DeletedTask.create(dataToSend);
            if (result?.id && offlineId) {
              deletedIdRemap[offlineId] = result.id;
              // Update local cache with real id
              const cached = queryClient.getQueryData(['deletedTasks']) || [];
              const updated = cached.map(r => r.id === offlineId ? { ...r, id: result.id } : r);
              queryClient.setQueryData(['deletedTasks'], updated);
              updateDeletedTasksCache(updated);
            }
          } else if (m.type === 'update') {
            const resolvedId = deletedIdRemap[m.id] || m.id;
            if (!String(resolvedId).startsWith('offline_')) {
              await base44.entities.DeletedTask.update(resolvedId, m.data);
            }
          } else if (m.type === 'delete') {
            const resolvedId = deletedIdRemap[m.id] || m.id;
            if (!String(resolvedId).startsWith('offline_')) {
              await base44.entities.DeletedTask.delete(resolvedId).catch(() => {});
            }
          }
        } catch {}
      }
      if (pendingDeleted.length) {
        clearPendingDeletedTaskMutations();
        queryClient.invalidateQueries({ queryKey: ['deletedTasks'] });
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [queryClient]);
}
