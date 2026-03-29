import { useQueryClient } from '@tanstack/react-query';
import { isOnline, queueMutation, dequeueOfflineCreate, updateQueuedCreate } from '@/lib/offlineCache';
import { base44 } from '@/api/base44Client';
import { useDeletedTasks } from '@/hooks/useDeletedTasks';
import { format } from 'date-fns';
import { getNextRecurringDueDate } from '@/lib/recurrence';

/**
 * @typedef {import("@/types/tasks").DeleteSnapshot} DeleteSnapshot
 * @typedef {import("@/types/tasks").TaskCreateInput} TaskCreateInput
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * Returns offline-aware create/update/delete functions for Task.
 * - Online: calls the API normally, invalidates the cache.
 * - Offline: applies optimistically to the live query cache, queues for replay.
 */
export function useOfflineMutation() {
  const queryClient = useQueryClient();
  const { recordDeletion } = useDeletedTasks();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  /**
   * @param {(current: TaskRecord[]) => TaskRecord[]} fn
   */
  const applyToCache = (fn) => {
    /** @type {TaskRecord[]} */
    const current = queryClient.getQueryData(['tasks']) || [];
    const updated = fn(current);
    queryClient.setQueryData(['tasks'], updated);
    return updated;
  };

  /**
   * @param {TaskCreateInput} data
   * @returns {Promise<TaskRecord>}
   */
  const createTask = async (data) => {
    const optimisticId = `offline_${Date.now()}`;
    const optimistic = { ...data, id: optimisticId, created_date: new Date().toISOString(), updated_date: new Date().toISOString() };
    applyToCache((current) => [optimistic, ...current]);
    if (isOnline()) {
      try {
        const result = await base44.entities.Task.create(data);
        applyToCache((current) => current.map(t => t.id === optimisticId ? { ...t, id: result.id } : t));
        return result;
      } catch {
        applyToCache((current) => current.filter(t => t.id !== optimisticId));
        return optimistic;
      }
    } else {
      queueMutation({ type: 'create', data: { ...data, _offlineId: optimisticId } });
      return optimistic;
    }
  };

  /**
   * @param {string} id
   * @param {Partial<TaskRecord>} data
   */
  const updateTask = async (id, data) => {
    applyToCache((current) =>
      current.map(t => t.id === id ? { ...t, ...data, updated_date: new Date().toISOString() } : t)
    );
    if (isOnline() && !String(id).startsWith('offline_')) {
      try {
        await base44.entities.Task.update(id, data);
      } catch {
        invalidate();
      }
    } else if (String(id).startsWith('offline_')) {
      updateQueuedCreate(id, data);
    } else {
      queueMutation({ type: 'update', id, data });
    }
  };

  /**
   * @param {string} id
   * @param {{ skipDeletedRecord?: boolean }} [options]
   * @returns {Promise<DeleteSnapshot>}
   */
  const deleteTask = async (id, { skipDeletedRecord = false } = {}) => {
    /** @type {TaskRecord[]} */
    const current = queryClient.getQueryData(['tasks']) || [];
    const task = current.find(t => t.id === id);
    const subtasks = current.filter(t => t.parent_id === id);
    const subtaskIds = subtasks.filter(t => !String(t.id).startsWith('offline_')).map(t => t.id);
    const offlineSubtaskIds = subtasks.filter(t => String(t.id).startsWith('offline_')).map(t => t.id);
    let deletedRecordId = null;

    // Record deletion into Recently Deleted (only for top-level tasks, not subtasks)
    if (task?.id && !task.parent_id && !skipDeletedRecord) {
      deletedRecordId = await recordDeletion(/** @type {TaskRecord & { id: string }} */ (task), subtasks);
    }

    // Remove task and all its subtasks from cache immediately
    applyToCache((c) => c.filter(t => t.id !== id && t.parent_id !== id));

    if (String(id).startsWith('offline_')) {
      dequeueOfflineCreate(id);
      offlineSubtaskIds.forEach(sid => dequeueOfflineCreate(sid));
    } else if (isOnline()) {
      await Promise.all(subtaskIds.map(sid => base44.entities.Task.delete(sid).catch(() => {})));
      await base44.entities.Task.delete(id).catch(() => {});
      invalidate();
    } else {
      subtaskIds.forEach(sid => queueMutation({ type: 'delete', id: sid }));
      queueMutation({ type: 'delete', id });
    }

    return { task, subtasks, deletedRecordId };
  };

  /**
   * Complete a recurring task: mark current instance as done (move to Recently Deleted as completed)
   * and create a new instance at the next recurrence date.
   *
   * @param {TaskRecord & { id: string }} task
   */
  const completeRecurringTask = async (task) => {
    const nextDate = getNextRecurringDueDate(task);
    const now = new Date().toISOString();

    // Record the completed instance into Recently Deleted
    /** @type {TaskRecord[]} */
    const current = queryClient.getQueryData(['tasks']) || [];
    const subtasks = current.filter(t => t.parent_id === task.id);
    const completedSnapshot = { ...task, status: 'done', completed_at: now };
    await recordDeletion(completedSnapshot, subtasks);

    if (nextDate) {
      const nextDateStr = format(nextDate, 'yyyy-MM-dd');
      await updateTask(task.id, { due_date: nextDateStr, status: 'todo', completed_at: '' });
      return;
    }

    // No next date or past end date — just mark done normally
    await updateTask(task.id, { status: 'done', completed_at: now });
  };

  /**
   * @param {TaskRecord & { id: string }} task
   */
  const skipRecurringTask = async (task) => {
    const nextDate = getNextRecurringDueDate(task);

    if (nextDate) {
      await updateTask(task.id, {
        due_date: format(nextDate, 'yyyy-MM-dd'),
        status: 'todo',
        completed_at: '',
      });
      return { skipped: true };
    }

    return deleteTask(task.id);
  };

  return { createTask, updateTask, deleteTask, completeRecurringTask, skipRecurringTask };
}
