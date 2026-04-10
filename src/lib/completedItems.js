/**
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * @typedef {{
 *   kind: "task",
 *   id: string,
 *   title: string,
 *   tags: string[],
 *   dueDate: string,
 *   completedAt: string,
 *   priorityId: string,
 *   recurrence: string,
 *   task: TaskRecord & { id: string },
 * }} CompletedTaskItem
 */

/**
 * @typedef {CompletedTaskItem} CompletedItem
 */

/**
 * @param {TaskRecord & { id: string }} task
 * @returns {CompletedTaskItem}
 */
export function buildCompletedTaskItem(task) {
  return {
    kind: "task",
    id: `task:${task.id}`,
    title: task.title || "",
    tags: task.tags || [],
    dueDate: task.due_date || "",
    completedAt: task.completed_at || task.updated_date || "",
    priorityId: task.priority_id || "",
    recurrence: task.task_type === "recurring" ? task.recurrence || "" : "",
    task,
  };
}

/**
 * @param {CompletedItem} item
 */
const getPrimaryDate = (item) => item.dueDate ? new Date(`${item.dueDate}T00:00:00`) : new Date(item.completedAt || 0);

/**
 * @param {CompletedItem} item
 */
const getCompletedDate = (item) => new Date(item.completedAt || 0);

/**
 * @param {CompletedItem[]} items
 * @param {string[]} sorts
 * @param {Record<string, number>} priorityOrderMap
 * @returns {CompletedItem[]}
 */
export function sortCompletedItems(items, sorts, priorityOrderMap) {
  return [...items].sort((a, b) => {
    for (const sortValue of sorts) {
      switch (sortValue) {
        case "date_asc": {
          const result = getPrimaryDate(a).getTime() - getPrimaryDate(b).getTime();
          if (result !== 0) return result;
          break;
        }
        case "date_desc": {
          const result = getPrimaryDate(b).getTime() - getPrimaryDate(a).getTime();
          if (result !== 0) return result;
          break;
        }
        case "priority_asc": {
          const result = (priorityOrderMap[a.priorityId] ?? 99) - (priorityOrderMap[b.priorityId] ?? 99);
          if (result !== 0) return result;
          break;
        }
        case "priority_desc": {
          const result = (priorityOrderMap[b.priorityId] ?? 99) - (priorityOrderMap[a.priorityId] ?? 99);
          if (result !== 0) return result;
          break;
        }
        case "tag_az": {
          const firstTagA = a.tags[0] || "";
          const firstTagB = b.tags[0] || "";
          if (!firstTagA && firstTagB) return 1;
          if (firstTagA && !firstTagB) return -1;
          const result = firstTagA.localeCompare(firstTagB);
          if (result !== 0) return result;
          break;
        }
        case "recurrence": {
          if (!a.recurrence && b.recurrence) return 1;
          if (a.recurrence && !b.recurrence) return -1;
          const result = a.recurrence.localeCompare(b.recurrence);
          if (result !== 0) return result;
          break;
        }
        default:
          break;
      }
    }

    return getCompletedDate(b).getTime() - getCompletedDate(a).getTime();
  });
}

/**
 * @param {{
 *   tasks?: TaskRecord[],
 *   search?: string,
 *   sorts?: string[],
 *   priorityOrderMap?: Record<string, number>,
 * }} options
 * @returns {CompletedItem[]}
 */
export function buildCompletedItems({
  tasks = [],
  search = "",
  sorts = ["date_desc"],
  priorityOrderMap = {},
} = {}) {
  const normalizedSearch = search.trim().toLowerCase();

  /** @type {CompletedTaskItem[]} */
  const completedTasks = tasks
    .filter((task) => task.status === "done" && !task.parent_id && task.id)
    .map((task) => buildCompletedTaskItem(/** @type {TaskRecord & { id: string }} */ (task)));

  const filtered = completedTasks.filter((item) => {
    if (!normalizedSearch) return true;

    return item.title.toLowerCase().includes(normalizedSearch) || item.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch));
  });

  return sortCompletedItems(filtered, sorts, priorityOrderMap);
}
