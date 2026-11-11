// @ts-check
/**
 * @file The record that goes into Recently Deleted when a task is deleted:
 * the task and its subtasks, enough to put them back. The app builds the
 * same thing in src/hooks/useDeletedTasks.js (recordDeletion); the server
 * needs it wherever it deletes a task on someone's behalf and the delete
 * must be undoable (an AI app's delete, a delete that came from a calendar).
 */

/**
 * @param {any} task        a hydrated top-level task
 * @param {any[]} subtasks  its hydrated subtasks
 * @param {string} [priorityColor]
 */
export function recentlyDeletedRecord(task, subtasks, priorityColor = "") {
  return {
    task_id: task.id,
    title: task.title,
    description: task.description || "",
    description_json: task.description_json || "",
    priority_id: task.priority_id || "",
    priority_color: priorityColor || "",
    status: task.status || "todo",
    task_type: task.task_type || "one_time",
    recurrence: task.recurrence || "none",
    recurrence_days: task.recurrence_days || [],
    recurrence_end_date: task.recurrence_end_date || "",
    due_date: task.due_date || "",
    task_time: task.task_time || "",
    task_end_time: task.task_end_time || "",
    reminder: task.reminder || "",
    tags: task.tags || [],
    completed_at: task.completed_at || "",
    deleted_at: new Date().toISOString(),
    was_completed: task.status === "done",
    subtasks: subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status || "todo",
      due_date: s.due_date || "",
      task_time: s.task_time || "",
      completed_at: s.completed_at || "",
    })),
  };
}
