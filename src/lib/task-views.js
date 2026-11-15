// @ts-check
/**
 * @file Which tasks belong where: the few questions every page, the
 * sidebar's counts and the Home blocks all ask, answered in one place so
 * a count beside a link is always the number of rows behind it.
 */
import { calendarKeyForTask } from "@/lib/calendar-order";

/** @typedef {{ id?: string, parent_id?: string | null, status?: string, due_date?: string | null, task_time?: string | null, tags?: string[] | null }} TaskLike */

/**
 * A task of its own (not a subtask) that isn't finished.
 * @param {TaskLike} task
 */
export function isOpenTopLevel(task) {
  return !task.parent_id && task.status !== "done";
}

/**
 * Open top-level tasks, less the ones on calendars the person has hidden
 * from the task pages (Settings → Calendars).
 * @template {TaskLike} T
 * @param {T[]} tasks
 * @param {Set<string>} [hiddenCalendars]
 * @returns {T[]}
 */
export function openTasks(tasks, hiddenCalendars) {
  return tasks.filter(
    (task) => isOpenTopLevel(task) && !(hiddenCalendars && hiddenCalendars.has(calendarKeyForTask(/** @type {any} */ (task)))),
  );
}

/**
 * The start of the day a task is due, or null when it has no date.
 * @param {TaskLike} task
 */
export function dueDay(task) {
  if (!task.due_date) return null;
  const day = new Date(`${task.due_date}T00:00:00`);
  return Number.isNaN(day.getTime()) ? null : day;
}

/**
 * Due today or earlier: what the Today page lists.
 * @param {TaskLike} task
 * @param {Date} todayStart  midnight this morning
 */
export function isDueByToday(task, todayStart) {
  const day = dueDay(task);
  return !!day && day.getTime() <= todayStart.getTime();
}

/**
 * Due before today.
 * @param {TaskLike} task
 * @param {Date} todayStart
 */
export function isOverdue(task, todayStart) {
  const day = dueDay(task);
  return !!day && day.getTime() < todayStart.getTime();
}

/**
 * @param {TaskLike} task
 * @param {string} tag
 */
export function hasTag(task, tag) {
  return Array.isArray(task.tags) && task.tags.includes(tag);
}

/**
 * Every tag with how many of `tasks` carry it: saved tags first appear
 * even at zero, and a tag used on a task but never saved still counts.
 * Sorted by name.
 *
 * @param {TaskLike[]} tasks        already narrowed to the ones to count
 * @param {{ name: string }[]} [savedTags]
 * @returns {{ tag: string, count: number }[]}
 */
export function tagCounts(tasks, savedTags = []) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const saved of savedTags) {
    if (saved?.name) counts.set(saved.name, 0);
  }
  for (const task of tasks) {
    for (const tag of task.tags || []) {
      if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
