// @ts-check
/**
 * @file Home: which blocks there are, how a layout is changed, and what
 * each block shows. Everything here is a plain function of the tasks and
 * notes already loaded, so a number on Home is worked out the same way
 * as the list it links to (lib/task-views.js) and all of it can be
 * tested without drawing anything.
 *
 * A layout is a list of `{ id, size }` in reading order. Nothing is
 * arranged for the person: what they set is what stays.
 */
import { addDays } from "date-fns/addDays";
import { endOfWeek } from "date-fns/endOfWeek";
import { format } from "date-fns/format";
import { startOfMonth } from "date-fns/startOfMonth";
import { startOfWeek } from "date-fns/startOfWeek";
import { calendarKeyForTask } from "@/lib/calendar-order";
import { toDateStr } from "@/lib/dates";
import { compareTaskTime, parseTaskTime } from "@/lib/sort-helpers";
import { isExternalEvent } from "@/lib/task-filters";

/** @typedef {{ id: string, size: string }} HomeBlock  size is one of HOME_SIZES */
/** @typedef {Record<string, any>} Task */

export const HOME_SIZES = ["third", "half", "full"];

/** What each width is called beside its button. */
export const HOME_SIZE_LABELS = { third: "Narrow", half: "Medium", full: "Wide" };

/** Every block, in the order the "add a block" tray lists them. */
export const HOME_BLOCKS = [
  { id: "quick", name: "Quick add" },
  { id: "today", name: "Today" },
  { id: "schedule", name: "Schedule" },
  { id: "overdue", name: "Overdue" },
  { id: "deadlines", name: "Deadlines" },
  { id: "notes", name: "Pinned notes" },
  { id: "week", name: "Next 7 days" },
  { id: "tags", name: "By tag" },
  { id: "done", name: "Done this week" },
  { id: "month", name: "Month" },
];

const KNOWN = new Set(HOME_BLOCKS.map((block) => block.id));

/**
 * Where Home starts for someone who has never arranged it. Each row adds
 * up to the full width, and blocks of a similar height share a row, so
 * the page has no half-empty boxes before anyone has touched it.
 */
export const DEFAULT_HOME_LAYOUT = /** @type {HomeBlock[]} */ ([
  { id: "quick", size: "full" },
  { id: "today", size: "half" },
  { id: "schedule", size: "half" },
  { id: "overdue", size: "third" },
  { id: "done", size: "third" },
  { id: "notes", size: "third" },
  { id: "week", size: "half" },
  { id: "tags", size: "half" },
  { id: "deadlines", size: "half" },
  { id: "month", size: "half" },
]);

/** @param {string} id */
export function blockName(id) {
  return HOME_BLOCKS.find((block) => block.id === id)?.name || id;
}

/**
 * The layout to draw: the saved one with anything this build doesn't know
 * dropped, or the starting layout when nothing was ever saved. An empty
 * saved layout stays empty: removing every block is allowed.
 * @param {unknown} saved
 * @returns {HomeBlock[]}
 */
export function resolveHomeLayout(saved) {
  if (!Array.isArray(saved)) return DEFAULT_HOME_LAYOUT;
  /** @type {HomeBlock[]} */
  const blocks = [];
  const seen = new Set();
  for (const entry of saved) {
    const id = entry?.id;
    if (!KNOWN.has(id) || seen.has(id)) continue;
    seen.add(id);
    blocks.push({ id, size: HOME_SIZES.includes(entry.size) ? entry.size : "third" });
  }
  return blocks;
}

/**
 * The blocks not on the page, for the tray.
 * @param {HomeBlock[]} layout
 */
export function hiddenBlocks(layout) {
  const shown = new Set(layout.map((block) => block.id));
  return HOME_BLOCKS.filter((block) => !shown.has(block.id));
}

/**
 * @param {HomeBlock[]} layout
 * @param {string} id
 * @param {-1 | 1} step  earlier or later
 * @returns {HomeBlock[]}
 */
export function moveBlock(layout, id, step) {
  const from = layout.findIndex((block) => block.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= layout.length) return layout;
  const next = [...layout];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * @param {HomeBlock[]} layout
 * @param {string} id
 * @param {string} size
 * @returns {HomeBlock[]}
 */
export function resizeBlock(layout, id, size) {
  if (!HOME_SIZES.includes(size)) return layout;
  return layout.map((block) => (block.id === id ? { ...block, size } : block));
}

/**
 * @param {HomeBlock[]} layout
 * @param {string} id
 * @returns {HomeBlock[]}
 */
export function removeBlock(layout, id) {
  return layout.filter((block) => block.id !== id);
}

/**
 * A block from the tray goes to the end, at the width it starts with.
 * @param {HomeBlock[]} layout
 * @param {string} id
 * @returns {HomeBlock[]}
 */
export function addBlock(layout, id) {
  if (!KNOWN.has(id) || layout.some((block) => block.id === id)) return layout;
  const size = DEFAULT_HOME_LAYOUT.find((block) => block.id === id)?.size || "third";
  return [...layout, { id, size }];
}

// ── What the blocks show ────────────────────────────────────────────

/** @param {Task} task */
const titleOf = (task) => String(task.title || "");

/**
 * Timed first and in order, then by priority, then by name: the order a
 * day's tasks are read in.
 * @param {Record<string, number>} priorityOrder  priority id → its place
 */
function byTimeThenPriority(priorityOrder) {
  /** @param {Task} a @param {Task} b */
  return (a, b) =>
    compareTaskTime(a.task_time, b.task_time) ||
    (priorityOrder[a.priority_id] ?? 99) - (priorityOrder[b.priority_id] ?? 99) ||
    titleOf(a).localeCompare(titleOf(b));
}

/** @param {Task} a @param {Task} b */
function byDateThenTime(a, b) {
  return String(a.due_date).localeCompare(String(b.due_date)) || compareTaskTime(a.task_time, b.task_time) || titleOf(a).localeCompare(titleOf(b));
}

/**
 * Open tasks due today. With the overdue ones (below) this is exactly
 * the Today page's list, so the two blocks' counts add up to the number
 * beside Today in the sidebar.
 * @param {Task[]} open  open top-level tasks (lib/task-views.js openTasks)
 * @param {Date} todayStart
 * @param {Record<string, number>} [priorityOrder]
 */
export function dueToday(open, todayStart, priorityOrder = {}) {
  const today = toDateStr(todayStart);
  return open.filter((task) => task.due_date === today).sort(byTimeThenPriority(priorityOrder));
}

/**
 * Open tasks whose day has passed, longest overdue first.
 * @param {Task[]} open
 * @param {Date} todayStart
 */
export function overdueTasks(open, todayStart) {
  const today = toDateStr(todayStart);
  return open.filter((task) => task.due_date && task.due_date < today).sort(byDateThenTime);
}

/**
 * Open tasks due after today, up to `days` ahead, soonest first.
 * @param {Task[]} open
 * @param {Date} todayStart
 * @param {number} [days]
 */
export function upcomingDeadlines(open, todayStart, days = 14) {
  const today = toDateStr(todayStart);
  const last = toDateStr(addDays(todayStart, days));
  return open.filter((task) => task.due_date && task.due_date > today && task.due_date <= last).sort(byDateThenTime);
}

/**
 * Today and the six days after it, each with how many open tasks fall
 * on it.
 * @param {Task[]} open
 * @param {Date} todayStart
 * @returns {{ key: string, date: Date, label: string, count: number, isToday: boolean }[]}
 */
export function nextSevenDays(open, todayStart) {
  /** @type {Map<string, number>} */
  const perDay = new Map();
  for (const task of open) {
    if (task.due_date) perDay.set(task.due_date, (perDay.get(task.due_date) || 0) + 1);
  }
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(todayStart, index);
    const key = toDateStr(date);
    return { key, date, label: format(date, "EEE"), count: perDay.get(key) || 0, isToday: index === 0 };
  });
}

/**
 * This week (Sunday to Saturday, as the calendar draws it): how many
 * tasks were finished, and how many open ones are still due by the end
 * of it, overdue ones included, because they still have to be done.
 *
 * @param {Task[]} tasks  every top-level and sub task, events left out
 * @param {Task[]} open   the open ones (already less hidden calendars)
 * @param {Date} todayStart
 * @param {Set<string>} [hiddenCalendars]
 * @returns {{ done: number, left: number, total: number }}
 */
export function weekProgress(tasks, open, todayStart, hiddenCalendars) {
  const weekStart = startOfWeek(todayStart, { weekStartsOn: 0 });
  const weekEnd = toDateStr(endOfWeek(todayStart, { weekStartsOn: 0 }));
  const done = tasks.filter((task) => {
    if (task.parent_id || task.status !== "done" || !task.completed_at) return false;
    if (hiddenCalendars && hiddenCalendars.has(calendarKeyForTask(/** @type {any} */ (task)))) return false;
    const when = new Date(task.completed_at);
    return !Number.isNaN(when.getTime()) && when.getTime() >= weekStart.getTime();
  }).length;
  const left = open.filter((task) => task.due_date && task.due_date <= weekEnd).length;
  return { done, left, total: done + left };
}

/**
 * Tags ranked by how many open tasks carry each, busiest first. Tags
 * with none are left out: a ranking of zeros says nothing. `share` is
 * the count against the busiest tag, for the bar's length.
 *
 * @param {Task[]} open
 * @returns {{ tag: string, count: number, share: number }[]}
 */
export function tagRanking(open) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const task of open) {
    for (const tag of task.tags || []) {
      if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const most = ranked[0]?.count || 1;
  return ranked.map((row) => ({ ...row, share: row.count / most }));
}

/**
 * Today on the clock: calendar events dated today and open tasks due
 * today that have a time. All-day events first, then in time order.
 *
 * @param {Task[]} everything  tasks AND calendar events, as loaded
 * @param {Date} todayStart
 * @param {Set<string>} [hiddenCalendars]
 * @returns {{ id: string, isEvent: boolean, title: string, start: number | null, end: number | null,
 *   time: string, endTime: string, calendar: string, color: string, task: Task }[]}
 */
export function scheduleToday(everything, todayStart, hiddenCalendars) {
  const today = toDateStr(todayStart);
  return everything
    .filter((task) => {
      if (!task.id || task.parent_id || task.due_date !== today) return false;
      if (hiddenCalendars && hiddenCalendars.has(calendarKeyForTask(/** @type {any} */ (task)))) return false;
      if (isExternalEvent(task)) return true;
      return task.status !== "done" && parseTaskTime(task.task_time) != null;
    })
    .map((task) => ({
      id: String(task.id),
      isEvent: isExternalEvent(task),
      title: titleOf(task),
      start: parseTaskTime(task.task_time),
      end: parseTaskTime(task.task_end_time),
      time: String(task.task_time || ""),
      endTime: String(task.task_end_time || ""),
      calendar: String(task.source_calendar_name || ""),
      color: String(task.source_color_hex || ""),
      task,
    }))
    .sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || a.title.localeCompare(b.title));
}

/**
 * This month as weeks of seven days (Sunday first), each day with how
 * many open tasks are due on it. Days outside the month fill the first
 * and last weeks and are marked so.
 *
 * @param {Task[]} open
 * @param {Date} todayStart
 * @returns {{ label: string, weeks: { key: string, day: number, inMonth: boolean, isToday: boolean, count: number }[][] }}
 */
export function monthGrid(open, todayStart) {
  /** @type {Map<string, number>} */
  const perDay = new Map();
  for (const task of open) {
    if (task.due_date) perDay.set(task.due_date, (perDay.get(task.due_date) || 0) + 1);
  }
  const first = startOfMonth(todayStart);
  const month = first.getMonth();
  const today = toDateStr(todayStart);
  const weeks = [];
  let cursor = startOfWeek(first, { weekStartsOn: 0 });
  do {
    const week = [];
    for (let index = 0; index < 7; index += 1) {
      const key = toDateStr(cursor);
      week.push({ key, day: cursor.getDate(), inMonth: cursor.getMonth() === month, isToday: key === today, count: perDay.get(key) || 0 });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month);
  return { label: format(first, "MMMM"), weeks };
}

/**
 * Pinned notes, most recently edited first.
 * @param {Record<string, any>[]} notes
 */
export function pinnedNotes(notes) {
  return notes
    .filter((note) => note.pinned)
    .sort((a, b) => String(b.updated_date || "").localeCompare(String(a.updated_date || "")));
}
