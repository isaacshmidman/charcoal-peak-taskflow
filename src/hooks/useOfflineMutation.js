import { useQueryClient } from '@tanstack/react-query';
import { isOnline, queueMutation, dequeueOfflineCreate, updateQueuedCreate } from '@/lib/offlineCache';
import { apiClient } from '@/api/apiClient';
import { useDeletedTasks } from '@/hooks/useDeletedTasks';
import { isRecoverableConnectionError } from '@/lib/network';
import { format } from 'date-fns';
import { getNextRecurringDueDate } from '@/lib/recurrence';

const createOptimisticId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
    const optimisticId = createOptimisticId('offline');
    const optimistic = { ...data, id: optimisticId, created_date: new Date().toISOString(), updated_date: new Date().toISOString() };
    applyToCache((current) => [optimistic, ...current]);
    if (isOnline()) {
      try {
        const result = await apiClient.entities.Task.create(data);
        applyToCache((current) => current.map(t => t.id === optimisticId ? { ...t, id: result.id } : t));
        return result;
      } catch (error) {
        if (isRecoverableConnectionError(error)) {
          queueMutation({ type: 'create', data: { ...data, _offlineId: optimisticId } });
          return optimistic;
        }

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
        await apiClient.entities.Task.update(id, data);
      } catch (error) {
        if (isRecoverableConnectionError(error)) {
          queueMutation({ type: 'update', id, data });
          return;
        }
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
    const [deletion] = await deleteTasks([id], { skipDeletedRecord });
    return deletion || { task: undefined, subtasks: [], deletedRecordId: null };
  };

  /**
   * @param {string[]} ids
   * @param {{ skipDeletedRecord?: boolean }} [options]
   * @returns {Promise<DeleteSnapshot[]>}
   */
  const deleteTasks = async (ids, { skipDeletedRecord = false } = {}) => {
    const normalizedIds = [...new Set(ids.filter(Boolean).map(String))];
    if (normalizedIds.length === 0) return [];

    /** @type {TaskRecord[]} */
    const current = queryClient.getQueryData(['tasks']) || [];
    const targetIdSet = new Set(normalizedIds);
    const deletions = normalizedIds.map((id) => {
      const task = current.find((item) => String(item.id) === id);
      const subtasks = current.filter((item) => String(item.parent_id) === id);

      return {
        task,
        subtasks,
        deletedRecordId: null,
        subtaskIds: subtasks.filter((item) => !String(item.id).startsWith('offline_')).map((item) => String(item.id)),
        offlineSubtaskIds: subtasks.filter((item) => String(item.id).startsWith('offline_')).map((item) => String(item.id)),
      };
    });

    const removedIds = new Set([
      ...normalizedIds,
      ...deletions.flatMap((deletion) => deletion.subtasks.map((subtask) => String(subtask.id))),
    ]);

    const deletedRecordPromises = deletions.map(async (deletion) => {
      if (deletion.task?.id && !deletion.task.parent_id && !skipDeletedRecord) {
        deletion.deletedRecordId = await recordDeletion(
          /** @type {TaskRecord & { id: string }} */ (deletion.task),
          deletion.subtasks
        );
      }
    });

    applyToCache((cache) =>
      cache.filter(
        (task) => !removedIds.has(String(task.id)) && !targetIdSet.has(String(task.parent_id))
      )
    );

    const onlineDeleteIds = new Set();
    const queuedDeleteIds = [];

    deletions.forEach((deletion, index) => {
      const taskId = normalizedIds[index];

      if (taskId.startsWith('offline_')) {
        dequeueOfflineCreate(taskId);
        deletion.offlineSubtaskIds.forEach((subtaskId) => dequeueOfflineCreate(subtaskId));
        return;
      }

      if (isOnline()) {
        onlineDeleteIds.add(taskId);
        deletion.subtaskIds.forEach((subtaskId) => onlineDeleteIds.add(subtaskId));
        return;
      }

      deletion.subtaskIds.forEach((subtaskId) => queuedDeleteIds.push(subtaskId));
      queuedDeleteIds.push(taskId);
    });

    if (onlineDeleteIds.size > 0) {
      let didFail = false;
      await Promise.all(
        [...onlineDeleteIds].map((taskId) =>
          apiClient.entities.Task.delete(taskId).catch((error) => {
            if (isRecoverableConnectionError(error)) {
              queueMutation({ type: 'delete', id: taskId });
              return;
            }
            didFail = true;
          })
        )
      );
      if (didFail) {
        invalidate();
      }
    } else {
      queuedDeleteIds.forEach((taskId) => queueMutation({ type: 'delete', id: taskId }));
    }

    await Promise.all(deletedRecordPromises);

    return deletions.map(({ task, subtasks, deletedRecordId }) => ({ task, subtasks, deletedRecordId }));
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

  return { createTask, updateTask, deleteTask, deleteTasks, completeRecurringTask, skipRecurringTask };
}
