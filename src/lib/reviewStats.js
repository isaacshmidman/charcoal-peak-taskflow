// @ts-check
/**
 * @file Review stats — pure computations over the tasks array for the
 * daily/weekly review dialog. All client-side (the ["tasks"] cache),
 * `now` injected for tests. "Waiting" = overdue, top-level, ours.
 */

import { isExternalEvent } from "@/lib/task-filters";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local calendar date of an ISO timestamp (completed_at), or null. */
function completedDateStr(task) {
  if (!task.completed_at) return null;
  const d = new Date(task.completed_at);
  return Number.isNaN(d.getTime()) ? null : dateStr(d);
}

function isOurTopLevel(task) {
  return !task.parent_id && !isExternalEvent(task);
}

/**
 * @param {Array<Record<string, any>>} tasks
 * @param {{ now?: Date }} [options]
 */
export function computeDailyReview(tasks, { now = new Date() } = {}) {
  const today = dateStr(now);
  const yesterday = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  let doneYesterday = 0;
  let doneToday = 0;
  const waiting = [];

  for (const task of tasks) {
    if (!isOurTopLevel(task)) continue;
    const completedOn = completedDateStr(task);
    if (task.status === "done" || completedOn) {
      if (completedOn === yesterday) doneYesterday += 1;
      if (completedOn === today) doneToday += 1;
      continue;
    }
    if (task.due_date && task.due_date < today) waiting.push(task);
  }

  waiting.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return { doneYesterday, doneToday, waiting };
}

/**
 * @param {Array<Record<string, any>>} tasks
 * @param {{ now?: Date }} [options]
 */
export function computeWeeklyReview(tasks, { now = new Date() } = {}) {
  const today = dateStr(now);
  const weekAgo = dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));

  let doneThisWeek = 0;
  /** @type {Record<string, number>} */
  const tagCounts = {};
  /** @type {Record<string, any> | null} */
  let oldestWaiting = null;

  for (const task of tasks) {
    if (!isOurTopLevel(task)) continue;
    const completedOn = completedDateStr(task);
    if (completedOn && completedOn >= weekAgo && completedOn <= today) {
      doneThisWeek += 1;
      for (const tag of task.tags || []) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
      continue;
    }
    if (task.status !== "done" && task.due_date && task.due_date < today) {
      if (!oldestWaiting || task.due_date < oldestWaiting.due_date) oldestWaiting = task;
    }
  }

  const busiestEntry = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    doneThisWeek,
    busiestTag: busiestEntry ? { name: busiestEntry[0], count: busiestEntry[1] } : null,
    oldestWaiting,
  };
}
