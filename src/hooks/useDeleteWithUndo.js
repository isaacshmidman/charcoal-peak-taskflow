import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { useDeletedTasks } from "@/hooks/useDeletedTasks";

/**
 * Truncate a title for inclusion in toast copy (max 50 chars).
 * @param {string} title
 */
export function truncateToastTitle(title) {
  const t = title || "";
  return t.length > 50 ? `${t.slice(0, 49)}…` : t;
}

/**
 * Build a toast label for a delete/restore scenario.
 * @param {{ scenario: string, title?: string, count?: number }} opts
 */
export function formatDeleteLabel({ scenario, title = "", count = 0 }) {
  const t = truncateToastTitle(title);
  switch (scenario) {
    case "task_single": return `Task "${t}" was deleted`;
    case "task_bulk": return `${count} tasks deleted`;
    case "subtask_single": return `Subtask "${t}" was deleted`;
    case "recurring_instance": return `Recurring instance of "${t}" deleted`;
    case "recurring_series": return `Recurring series "${t}" deleted`;
    case "restore_single": return `"${t}" restored`;
    case "restore_bulk": return `${count} tasks restored`;
    case "permanent_single": return `"${t}" permanently deleted`;
    case "permanent_bulk": return `${count} tasks permanently deleted`;
    default: return t ? `"${t}" was deleted` : "Deleted";
  }
}

/**
 * @typedef {import("@/types/tasks").DeleteSnapshot} DeleteSnapshot
 * @typedef {import("@/types/tasks").TaskCreateInput} TaskCreateInput
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * @param {TaskRecord} task
 * @param {Partial<TaskCreateInput>} [overrides]
 * @returns {TaskCreateInput}
 */
export function buildTaskPayload(task, overrides = {}) {
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
}

/**
 * @param {DeleteSnapshot} deletion
 * @param {{
 *   createTask: (data: TaskCreateInput) => Promise<TaskRecord | undefined>,
 *   permanentlyDelete?: (id: string) => Promise<unknown>,
 * }} options
 */
export async function restoreDeletionSnapshot({ task, subtasks = [], deletedRecordId }, { createTask, permanentlyDelete }) {
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

  if (deletedRecordId && permanentlyDelete) {
    await permanentlyDelete(deletedRecordId);
  }
}

/**
 * @param {DeleteSnapshot[]} deletions
 * @param {{
 *   createTask: (data: TaskCreateInput) => Promise<TaskRecord | undefined>,
 *   permanentlyDelete?: (id: string) => Promise<unknown>,
 * }} options
 */
export async function restoreDeletionSnapshots(deletions, { createTask, permanentlyDelete }) {
  for (const deletion of deletions) {
    await restoreDeletionSnapshot(deletion, { createTask, permanentlyDelete });
  }
}

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
   * @param {TaskRecord & { id: string }} task
   * @param {{ isSubtask?: boolean } & Record<string, unknown>} [options]
   */
  const deleteWithUndo = async (task, { isSubtask = false, scenario, ...deleteOptions } = {}) => {
    const deletion = await deleteTask(task.id, deleteOptions);
    const effectiveScenario = scenario
      || (isSubtask ? "subtask_single"
        : task.task_type === "recurring" ? "recurring_series"
        : "task_single");
    const label = formatDeleteLabel({ scenario: effectiveScenario, title: task.title || "Untitled task" });

    showDeleteToast({
      label,
      onUndo: () => restoreDeletionSnapshots([deletion], { createTask, permanentlyDelete }),
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

    const defaultLabel = formatDeleteLabel({ scenario: "task_bulk", count: tasks.length });
    showDeleteToast({
      label: label || defaultLabel,
      onUndo: () => restoreDeletionSnapshots(deletions, { createTask, permanentlyDelete }),
    });

    return deletions;
  };

  return deleteWithUndo;
}
