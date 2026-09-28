// @ts-check
/**
 * @file How tasks and notes look to an AI app. Every tool answers twice:
 * short readable lines (with ids, so the next call can name the item) for
 * the model to read — small local models cope far better with these than
 * with raw records — and the same facts as structured data.
 *
 * Dates are the app's plain YYYY-MM-DD days; times are the app's stored
 * form, "9:15AM".
 */
import { parseTaskTime } from "../push/shape.js";
import { parseReminder } from "../reminders.js";
import { ToolError } from "./args.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LIST_DESCRIPTION_CHARS = 200;

/**
 * Today's date where the person is.
 * @param {string} timeZone
 */
export function todayIn(timeZone) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * @param {string} ymd
 * @param {number} days
 */
export function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * "Mon 28 Sep", or "Mon 28 Sep 2026" with the year.
 * @param {string} ymd
 * @param {{ year?: boolean }} [opts]
 */
export function dayLabel(ymd, { year = false } = {}) {
  const [y, m, d] = ymd.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ""}`;
}

/**
 * Minutes after midnight in the app's time format.
 * @param {number} minutes
 */
export function formatTime(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}:${String(m).padStart(2, "0")}${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * "9:15", "09:15", "21:15", "9:15am", "9:15 PM", "9pm" → "9:15AM" etc.
 * @param {string} input
 * @param {string} field
 */
export function normalizeTime(input, field) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(input.trim());
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3]?.[0].toLowerCase();
    const valid = meridiem ? hour >= 1 && hour <= 12 : hour <= 23 && match[2] != null;
    if (valid && minute <= 59) {
      if (meridiem === "a" && hour === 12) hour = 0;
      if (meridiem === "p" && hour !== 12) hour += 12;
      return formatTime(hour * 60 + minute);
    }
  }
  throw new ToolError(`"${field}" must be a time like 9:15AM or 21:15.`);
}

/**
 * The end a timed task gets when none is given — an hour after it starts,
 * never past 11:59 PM. Same as the task form's defaultEndTime.
 * @param {string} start
 */
export function defaultEndTime(start) {
  const minutes = parseTaskTime(start);
  if (minutes == null) return "";
  return minutes + 60 >= 24 * 60 ? "11:59PM" : formatTime(minutes + 60);
}

/**
 * @param {string} time
 */
export function timeMinutes(time) {
  return parseTaskTime(time);
}

const RECURRENCE_WORDS = /** @type {Record<string, string>} */ ({
  daily: "every day",
  weekdays: "every weekday",
  weekly: "every week",
  biweekly: "every two weeks",
  monthly: "every month",
  quarterly: "every three months",
  yearly: "every year",
});
const FULL_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "every week", "every Monday and Thursday until 2026-12-01", or null.
 * @param {any} task
 */
export function describeRecurrence(task) {
  const recurrence = task.recurrence;
  if (!recurrence || recurrence === "none") return null;
  let words = RECURRENCE_WORDS[recurrence];
  if (recurrence === "custom_days") {
    const days = [...(task.recurrence_days || [])].sort((a, b) => a - b).map((d) => FULL_WEEKDAYS[d]).filter(Boolean);
    words = days.length ? `every ${days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : days[0]}` : "on chosen days";
  }
  if (!words) words = "repeating";
  return task.recurrence_end_date ? `${words} until ${task.recurrence_end_date}` : words;
}

/**
 * @param {unknown} value
 */
export function describeReminder(value) {
  const rule = parseReminder(value);
  if (rule.kind === "none") return "no reminder";
  if (rule.kind === "before") {
    if (rule.minutes === 0) return "at the start";
    if (rule.minutes % (24 * 60) === 0) return `${rule.minutes / (24 * 60)} day${rule.minutes === 24 * 60 ? "" : "s"} before`;
    if (rule.minutes % 60 === 0) return `${rule.minutes / 60} hour${rule.minutes === 60 ? "" : "s"} before`;
    return `${rule.minutes} minutes before`;
  }
  if (rule.kind === "at") return `at ${formatTime(rule.minutes)}`;
  return "account default";
}

/**
 * "Google calendar · Work", or null for Zephyrly's own tasks.
 * @param {any} task
 */
export function fromCalendar(task) {
  if (!task.source_provider) return null;
  const provider = String(task.source_provider);
  const name = `${provider.charAt(0).toUpperCase()}${provider.slice(1)} calendar`;
  return task.source_calendar_name ? `${name} · ${task.source_calendar_name}` : name;
}

/**
 * A task only an AI app's reads can reach: from a connected calendar.
 * @param {any} task
 */
export function isFromCalendar(task) {
  return Boolean(task.source_provider);
}

/**
 * @param {any} task
 */
export function isCalendarEvent(task) {
  return isFromCalendar(task) && task.source_kind !== "task";
}

/**
 * @param {string} text
 * @param {number} max
 */
export function clip(text, max) {
  const value = String(text || "").trim();
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

/**
 * Context every view needs: priority names and order, and subtask counts.
 * @param {any[]} tasks
 * @param {any[]} priorities
 */
export function viewContext(tasks, priorities) {
  const priorityById = new Map(priorities.map((p) => [p.id, p]));
  /** @type {Map<string, { total: number, done: number }>} */
  const subtaskCounts = new Map();
  for (const task of tasks) {
    if (!task.parent_id) continue;
    const counts = subtaskCounts.get(task.parent_id) || { total: 0, done: 0 };
    counts.total += 1;
    if (task.status === "done") counts.done += 1;
    subtaskCounts.set(task.parent_id, counts);
  }
  return { priorityById, subtaskCounts };
}

/**
 * The structured form of a task.
 * @param {any} task
 * @param {ReturnType<typeof viewContext>} ctx
 * @param {{ full?: boolean }} [opts]
 */
export function taskData(task, ctx, { full = false } = {}) {
  const priority = ctx.priorityById.get(task.priority_id);
  const counts = ctx.subtaskCounts.get(task.id);
  return {
    id: task.id,
    title: task.title,
    status: task.status === "done" ? "done" : "open",
    due_date: task.due_date || null,
    time: task.task_time || null,
    end_time: task.task_time ? task.task_end_time || null : null,
    priority: priority?.name || null,
    tags: task.tags || [],
    repeats: describeRecurrence(task),
    ...(task.parent_id ? { parent_task_id: task.parent_id } : {}),
    ...(counts ? { subtasks: { total: counts.total, done: counts.done } } : {}),
    from_calendar: fromCalendar(task),
    is_event: isCalendarEvent(task),
    editable: !isFromCalendar(task),
    description: full ? clip(task.description, 10_000) : clip(task.description, LIST_DESCRIPTION_CHARS),
    ...(full
      ? {
          reminder: describeReminder(task.reminder),
          completed_at: task.completed_at || null,
          updated_date: task.updated_date,
        }
      : {}),
  };
}

/**
 * One readable line: "9:00AM–10:30AM · Plan the trip [High] #travel — every week (id task_…)".
 * @param {any} task
 * @param {ReturnType<typeof viewContext>} ctx
 * @param {{ withDate?: boolean }} [opts]
 */
export function taskLine(task, ctx, { withDate = false } = {}) {
  const parts = [];
  if (withDate) parts.push(task.due_date ? dayLabel(task.due_date) : "no date");
  if (task.task_time) parts.push(task.task_end_time ? `${task.task_time}–${task.task_end_time}` : task.task_time);
  let line = `${parts.length ? `${parts.join(" ")} · ` : ""}${task.title}`;
  if (task.status === "done") line += " (done)";
  const priority = ctx.priorityById.get(task.priority_id);
  if (priority && !isFromCalendar(task)) line += ` [${priority.name}]`;
  for (const tag of task.tags || []) line += ` #${tag}`;
  const counts = ctx.subtaskCounts.get(task.id);
  if (counts) line += ` — ${counts.done}/${counts.total} subtasks done`;
  const repeats = describeRecurrence(task);
  if (repeats) line += ` — repeats ${repeats}`;
  if (isFromCalendar(task)) line += ` — ${isCalendarEvent(task) ? "event" : "task"} from ${fromCalendar(task)}, read-only`;
  return `${line} (id ${task.id})`;
}

/**
 * Order within a day: untimed first, then by start, then priority, then title.
 * @param {ReturnType<typeof viewContext>} ctx
 */
export function byTimeThenPriority(ctx) {
  /** @param {any} task */
  const priorityOrder = (task) => ctx.priorityById.get(task.priority_id)?.order ?? Number.MAX_SAFE_INTEGER;
  return (/** @type {any} */ a, /** @type {any} */ b) => {
    const at = a.task_time ? timeMinutes(a.task_time) ?? -1 : -1;
    const bt = b.task_time ? timeMinutes(b.task_time) ?? -1 : -1;
    if (at !== bt) return at - bt;
    const ap = priorityOrder(a);
    const bp = priorityOrder(b);
    if (ap !== bp) return ap - bp;
    return String(a.title).localeCompare(String(b.title));
  };
}

// ── Speech ─────────────────────────────────────────────────────────────
// Siri reads answers aloud through Shortcuts (/api/v1 "spoken"), where ids
// and punctuation-heavy lines are noise. These phrase the same facts as a
// person would say them.

const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * "9:00AM" → "9 AM", "9:30PM" → "9:30 PM".
 * @param {string} time
 */
export function speakTime(time) {
  const minutes = timeMinutes(time);
  if (minutes == null) return time;
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * "today", "tomorrow", or "Tuesday 29 September".
 * @param {string} ymd
 * @param {string} today
 */
export function speakDay(ymd, today) {
  if (ymd === today) return "today";
  if (ymd === addDaysYmd(today, 1)) return "tomorrow";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${FULL_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${FULL_MONTHS[m - 1]}`;
}

/**
 * "A", "A and B", "A, B and C", "A, B, C and 4 more".
 * @param {string[]} items
 * @param {number} [max]
 */
export function speakList(items, max = 8) {
  if (items.length <= 1) return items[0] || "";
  if (items.length > max) return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * "Pay rent at 9 AM", or just the title for an untimed task.
 * @param {any} task
 */
export function speakTask(task) {
  return task.task_time ? `${task.title} at ${speakTime(task.task_time)}` : task.title;
}
