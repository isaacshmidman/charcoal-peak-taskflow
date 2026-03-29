import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  getDay,
} from "date-fns";

/**
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * @param {TaskRecord} task
 */
export function getNextRecurrenceDate(task) {
  const base = task.due_date ? new Date(`${task.due_date}T00:00:00`) : new Date();
  const recurrence = task.recurrence;

  if (!recurrence || recurrence === "none") return null;
  if (recurrence === "daily") return addDays(base, 1);

  if (recurrence === "weekdays") {
    let next = addDays(base, 1);
    while ([0, 6].includes(getDay(next))) next = addDays(next, 1);
    return next;
  }

  if (recurrence === "custom_days" && task.recurrence_days?.length) {
    const days = [...task.recurrence_days].sort((a, b) => a - b);
    let next = addDays(base, 1);

    for (let i = 0; i < 14; i += 1) {
      if (days.includes(getDay(next))) return next;
      next = addDays(next, 1);
    }

    return null;
  }

  if (recurrence === "weekly") return addWeeks(base, 1);
  if (recurrence === "biweekly") return addWeeks(base, 2);
  if (recurrence === "monthly") return addMonths(base, 1);
  if (recurrence === "quarterly") return addQuarters(base, 1);
  if (recurrence === "yearly") return addYears(base, 1);

  return null;
}

/**
 * @param {TaskRecord} task
 */
export function getNextRecurringDueDate(task) {
  const nextDate = getNextRecurrenceDate(task);

  if (!nextDate) return null;
  if (!task.recurrence_end_date) return nextDate;

  const recurrenceEnd = new Date(`${task.recurrence_end_date}T00:00:00`);
  return nextDate <= recurrenceEnd ? nextDate : null;
}
