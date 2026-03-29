import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { useDeletedTasks } from "@/hooks/useDeletedTasks";

/**
 * @typedef {import("@/types/tasks").DeleteSnapshot} DeleteSnapshot
 * @typedef {import("@/types/tasks").TaskCreateInput} TaskCreateInput
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * Returns a deleteWithUndo(task, { isSubtask }) function.
 * - Shows a toast with the task/subtask name and an Undo button
 * - Undo re-creates the deleted record(s), so the restore survives refetches
 *
 * @param {(id: string, options?: Record<string, unknown>) => Promise<DeleteSnapshot>} deleteTask
 * @param {(data: TaskCreateInput) => Promise<TaskRecord | undefined>} createTask
 */
export function useDeleteWithUndo(deleteTask, createTask) {
  const { permanentlyDelete } = useDeletedTasks();

  /**
   * @param {TaskRecord} task
   * @param {Partial<TaskCreateInput>} [overrides]
   * @returns {TaskCreateInput}
   */
  const buildTaskPayload = (task, overrides = {}) => {
    /** @type {TaskCreateInput} */
    const payload = {
      title: task.title || "",
      description: task.description || "",
      priority_id: task.priority_id || "",
      status: task.status || "todo",
      task_type: task.task_type || "one_time",
      recurrence: task.recurrence || "none",
      recurrence_days: task.recurrence_days || [],
      recurrence_end_date: task.recurrence_end_date || "",
      due_date: task.due_date || "",
      task_time: task.task_time || "",
      tags: task.tags || [],
      completed_at: task.completed_at || "",
      ...overrides,
    };

    if (payload.parent_id === undefined && task.parent_id) {
      payload.parent_id = task.parent_id;
    }

    if (task.order != null && payload.order === undefined) {
      payload.order = task.order;
    }

    return payload;
  };

  /**
   * @param {DeleteSnapshot} deletion
   */
  const restoreDeletion = async ({ task, subtasks = [], deletedRecordId }) => {
    if (!task || !createTask) return;

    if (task.parent_id) {
      await createTask(buildTaskPayload(task));
      return;
    }

    const restoredTask = await createTask(buildTaskPayload(task));
    const restoredParentId = restoredTask?.id;

    if (restoredParentId) {
      for (const subtask of [...subtasks].sort((a, b) => (a.order ?? 999) - (b.order ?? 999))) {
        await createTask(buildTaskPayload(subtask, { parent_id: restoredParentId }));
      }
    }

    if (deletedRecordId) {
      await permanentlyDelete(deletedRecordId);
    }
  };

  /**
   * @param {DeleteSnapshot[]} deletions
   */
  const restoreMany = async (deletions) => {
    for (const deletion of deletions) {
      await restoreDeletion(deletion);
    }
  };

  /**
   * @param {TaskRecord & { id: string }} task
   * @param {{ isSubtask?: boolean } & Record<string, unknown>} [options]
   */
  const deleteWithUndo = async (task, { isSubtask = false, ...deleteOptions } = {}) => {
    const deletion = await deleteTask(task.id, deleteOptions);
    const taskTitle = task.title || "Untitled task";
    const label = isSubtask
      ? `Subtask "${taskTitle}" was deleted`
      : `Task "${taskTitle}" was deleted`;

    showDeleteToast({
      label,
      onUndo: () => restoreMany([deletion]),
    });

    return deletion;
  };

  /**
   * @param {(TaskRecord & { id: string })[]} tasks
   * @param {{ label?: string }} [options]
   */
  deleteWithUndo.many = async (tasks, { label } = {}) => {
    /** @type {DeleteSnapshot[]} */
    const deletions = [];

    for (const task of tasks) {
      deletions.push(await deleteTask(task.id));
    }

    const defaultLabel = `${tasks.length} task${tasks.length === 1 ? "" : "s"} deleted`;
    showDeleteToast({
      label: label || defaultLabel,
      onUndo: () => restoreMany(deletions),
    });

    return deletions;
  };

  return deleteWithUndo;
}
