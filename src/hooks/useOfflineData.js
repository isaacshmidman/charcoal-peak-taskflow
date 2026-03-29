// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  saveToCache,
  getPendingMutations,
  setPendingMutations,
  getPendingPriorityMutations,
  setPendingPriorityMutations,
  getPendingTagMutations,
  setPendingTagMutations,
  getPendingDeletedTaskMutations,
  setPendingDeletedTaskMutations,
  updateDeletedTasksCache,
} from '@/lib/offlineCache';
import { apiClient } from '@/api/apiClient';

const CACHE_KEYS = ['tasks', 'priorities', 'savedTags', 'deletedTasks'];

/**
 * Hook that:
 * 1. Persists query cache data to localStorage on every data update (catches API fetches + optimistic setQueryData).
 * 2. Replays pending mutations when coming back online.
 */
export function useOfflineData() {
  const queryClient = useQueryClient();
  const replayInFlightRef = useRef(false);
  const replayRequestedRef = useRef(false);

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
      if (replayInFlightRef.current) {
        replayRequestedRef.current = true;
        return;
      }

      replayInFlightRef.current = true;

      try {
        // --- Task mutations ---
        const pending = getPendingMutations();
        const idRemap = {};
        const remainingTaskMutations = [];
        for (const m of pending) {
          try {
            if (m.type === 'create') {
              const dataToSend = { ...m.data };
              delete dataToSend._offlineId;
              if (dataToSend.parent_id && idRemap[dataToSend.parent_id]) {
                dataToSend.parent_id = idRemap[dataToSend.parent_id];
              }
              const result = await apiClient.entities.Task.create(dataToSend);
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
                await apiClient.entities.Task.update(resolvedId, m.data);
              }
            } else if (m.type === 'delete') {
              if (!String(m.id).startsWith('offline_')) {
                await apiClient.entities.Task.delete(m.id);
              }
            }
          } catch {
            remainingTaskMutations.push(m);
          }
        }
        if (pending.length) {
          setPendingMutations(remainingTaskMutations);
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
        }

        // --- Priority mutations ---
        const pendingPriorities = getPendingPriorityMutations();
        const priorityIdRemap = {};
        const remainingPriorityMutations = [];
        for (const m of pendingPriorities) {
          try {
            if (m.type === 'create') {
              const dataToSend = { ...m.data };
              delete dataToSend._offlineId;
              const result = await apiClient.entities.Priority.create(dataToSend);
              if (result?.id && m.data?._offlineId) {
                priorityIdRemap[m.data._offlineId] = result.id;
                queryClient.setQueryData(['priorities'], (old = []) =>
                  old.map(p => p.id === m.data._offlineId ? { ...p, id: result.id } : p)
                );
              }
            } else if (m.type === 'update') {
              const resolvedId = priorityIdRemap[m.id] || m.id;
              if (!String(resolvedId).startsWith('offline_')) {
                await apiClient.entities.Priority.update(resolvedId, m.data);
              }
            } else if (m.type === 'delete') {
              const resolvedId = priorityIdRemap[m.id] || m.id;
              if (!String(resolvedId).startsWith('offline_')) {
                await apiClient.entities.Priority.delete(resolvedId);
              }
            }
          } catch {
            remainingPriorityMutations.push(m);
          }
        }
        if (pendingPriorities.length) {
          setPendingPriorityMutations(remainingPriorityMutations);
          queryClient.invalidateQueries({ queryKey: ['priorities'] });
        }

        // --- Tag mutations ---
        const pendingTags = getPendingTagMutations();
        const remainingTagMutations = [];
        for (const m of pendingTags) {
          try {
            if (m.type === 'create') await apiClient.entities.SavedTag.create({ name: m.name });
            else if (m.type === 'delete') await apiClient.entities.SavedTag.delete(m.id);
          } catch {
            remainingTagMutations.push(m);
          }
        }
        if (pendingTags.length) {
          setPendingTagMutations(remainingTagMutations);
          queryClient.invalidateQueries({ queryKey: ['savedTags'] });
        }

        // --- DeletedTask mutations ---
        const pendingDeleted = getPendingDeletedTaskMutations();
        const deletedIdRemap = {};
        const remainingDeletedTaskMutations = [];
        for (const m of pendingDeleted) {
          try {
            if (m.type === 'create') {
              const dataToSend = { ...m.data };
              const offlineId = dataToSend._offlineId;
              delete dataToSend._offlineId;
              const result = await apiClient.entities.DeletedTask.create(dataToSend);
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
                await apiClient.entities.DeletedTask.update(resolvedId, m.data);
              }
            } else if (m.type === 'delete') {
              const resolvedId = deletedIdRemap[m.id] || m.id;
              if (!String(resolvedId).startsWith('offline_')) {
                await apiClient.entities.DeletedTask.delete(resolvedId);
              }
            }
          } catch {
            remainingDeletedTaskMutations.push(m);
          }
        }
        if (pendingDeleted.length) {
          setPendingDeletedTaskMutations(remainingDeletedTaskMutations);
          queryClient.invalidateQueries({ queryKey: ['deletedTasks'] });
        }
      } finally {
        replayInFlightRef.current = false;
        if (replayRequestedRef.current) {
          replayRequestedRef.current = false;
          void handleOnline();
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void handleOnline();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    if (navigator.onLine) {
      void handleOnline();
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [queryClient]);
}
