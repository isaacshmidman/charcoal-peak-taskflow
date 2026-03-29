/**
 * Hook for managing the Recently Deleted store.
 * Handles creating, restoring, and permanently deleting records, with full offline support.
 */
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { isOnline, queueDeletedTaskMutation, updateDeletedTasksCache } from '@/lib/offlineCache';

/**
 * @typedef {import("@/types/tasks").DeletedTaskRecord} DeletedTaskRecord
 * @typedef {import("@/types/tasks").DeletedTaskSubtaskSnapshot} DeletedTaskSubtaskSnapshot
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

export function useDeletedTasks() {
  const queryClient = useQueryClient();

  /**
   * @param {(current: DeletedTaskRecord[]) => DeletedTaskRecord[]} fn
   */
  const applyToCache = (fn) => {
    /** @type {DeletedTaskRecord[]} */
    const current = queryClient.getQueryData(['deletedTasks']) || [];
    const updated = fn(current);
    queryClient.setQueryData(['deletedTasks'], updated);
    updateDeletedTasksCache(updated);
    return updated;
  };

  /**
   * Record a task deletion into the Recently Deleted store.
   * Call this BEFORE actually deleting the task from the tasks cache.
   *
   * @param {TaskRecord & { id: string }} task
   * @param {(TaskRecord & { id?: string })[]} [subtasks]
   */
  const recordDeletion = async (task, subtasks = []) => {
    const retentionDays = parseInt(localStorage.getItem('deletedTaskRetentionDays') || '7', 10);
    const deletedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

    /** @type {DeletedTaskRecord} */
    const record = {
      task_id: task.id,
      title: task.title,
      description: task.description || '',
      priority_id: task.priority_id || '',
      status: task.status || 'todo',
      task_type: task.task_type || 'one_time',
      recurrence: task.recurrence || 'none',
      recurrence_days: task.recurrence_days || [],
      recurrence_end_date: task.recurrence_end_date || '',
      due_date: task.due_date || '',
      task_time: task.task_time || '',
      tags: task.tags || [],
      completed_at: task.completed_at || '',
      deleted_at: deletedAt,
      expires_at: expiresAt,
      was_completed: task.status === 'done',
      subtasks: subtasks.map(
        /**
         * @returns {DeletedTaskSubtaskSnapshot}
         */
        (s) => ({
          id: s.id,
          title: s.title,
          status: s.status || 'todo',
          due_date: s.due_date || '',
          task_time: s.task_time || '',
          completed_at: s.completed_at || '',
        })
      ),
    };

    const optimisticId = `offline_${Date.now()}`;
    const optimisticRecord = { ...record, id: optimisticId };

    // Add to cache immediately
    applyToCache(current => [optimisticRecord, ...current]);

    if (isOnline()) {
      try {
        const result = await base44.entities.DeletedTask.create(record);
        applyToCache(current => current.map(r => r.id === optimisticId ? { ...r, id: result.id } : r));
        return result.id;
      } catch {
        // keep optimistic
      }
    } else {
      queueDeletedTaskMutation({ type: 'create', data: { ...record, _offlineId: optimisticId } });
    }

    return optimisticId;
  };

  /**
   * @param {string} id
   * @param {Partial<DeletedTaskRecord>} data
   */
  const updateDeletedTask = async (id, data) => {
    applyToCache(current => current.map(r => r.id === id ? { ...r, ...data } : r));

    if (isOnline() && !String(id).startsWith('offline_')) {
      try {
        await base44.entities.DeletedTask.update(id, data);
      } catch {
        queryClient.invalidateQueries({ queryKey: ['deletedTasks'] });
      }
    } else if (!String(id).startsWith('offline_')) {
      queueDeletedTaskMutation({ type: 'update', id, data });
    }
  };

  /**
   * Permanently remove a deleted task record from Recently Deleted.
   *
   * @param {string} id
   */
  const permanentlyDelete = async (id) => {
    // Remove from cache immediately — this also updates the query data key
    applyToCache(current => current.filter(r => r.id !== id));
    if (isOnline() && !String(id).startsWith('offline_')) {
      await base44.entities.DeletedTask.delete(id).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['deletedTasks'] });
    } else if (!String(id).startsWith('offline_')) {
      queueDeletedTaskMutation({ type: 'delete', id });
    }
  };

  /**
   * Purge expired records based on current retention setting.
   */
  const purgeExpired = async () => {
    const now = new Date();
    /** @type {DeletedTaskRecord[]} */
    const current = queryClient.getQueryData(['deletedTasks']) || [];
    const expired = current.filter(r => r.expires_at && new Date(r.expires_at) < now);
    for (const r of expired) {
      if (r.id) {
        await permanentlyDelete(r.id);
      }
    }
  };

  return { recordDeletion, updateDeletedTask, permanentlyDelete, purgeExpired };
}
