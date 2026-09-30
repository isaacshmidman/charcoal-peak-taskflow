// @ts-check
/**
 * @file Tools that change things. Offered only to a connection the person
 * allowed to make changes, and held to rules the server enforces whatever
 * the AI app has been told:
 *   - nothing from a connected calendar is changed, subtasks included:
 *     editing it here would change the real event
 *   - nothing is deleted for good: deletes go to Recently Deleted, files
 *     and all, and subtasks (whose delete is permanent) are refused
 *   - every change passes the same checks as the app's own saves, echoes to
 *     calendars the same way (enqueueTaskPush), and is logged for Undo
 *   - at most WRITES_PER_HOUR changes an hour per connection
 *
 * Where the app has its own way of doing something — completing a
 * repeating task, the Recently Deleted snapshot, a new task's default
 * priority and end time — these follow it field for field
 * (src/hooks/useOfflineMutation.js, src/hooks/useDeletedTasks.js,
 * src/components/tasks/TaskForm).
 */
import { withTransaction } from "../db.js";
import { createEntityRecord, deleteEntityRecord, updateEntityRecord, validateClientInput } from "../store.js";
import { enqueueTaskPush } from "../push.js";
import { MAX_BEFORE_MINUTES, parseReminder } from "../reminders.js";
import { getNextRecurringDueDate } from "../lib/recurrence.js";
import { PRIORITY_COLORS } from "../priority-color.js";
import { countWords, docToText, plainTextToDoc } from "../lib/plain-text-doc.js";
import { ToolError, isRealDate } from "./args.js";
import { logActivity } from "./activity.js";
import { DATE, findPriority, getOwnNote, getOwnTask, listRecords, loadPriorities, loadTasks, lower } from "./context.js";
import { WRITES_PER_HOUR, takeSlot } from "./rate-limit.js";
import { dayLabel, defaultEndTime, describeRecurrence, describeReminder, formatTime, fromCalendar, isFromCalendar, normalizeTime, speakDay, speakTime, timeMinutes, todayIn } from "./view.js";

/** The task editor's limit (richtext/content.js WORD_LIMIT). */
const TASK_DESCRIPTION_WORDS = 500;
/** The note editor's limit (NoteCanvas NOTE_WORD_LIMIT). */
const NOTE_WORDS = 5000;
const SUBTASK_FIELDS = new Set(["title", "due_date", "time", "description", "parent_task_id"]);

/**
 * @typedef {import("./context.js").Tool} Tool
 * @typedef {import("./context.js").ToolContext} ToolContext
 */

/**
 * db.js's withTransaction, typed for the records these tools get back.
 * @param {any} db
 * @param {() => any} fn
 * @returns {any}
 */
const inTransaction = (db, fn) => withTransaction(db, fn);

/** @param {string} title */
const quote = (title) => `“${title}”`;

/**
 * @param {Date} date  local midnight, as the recurrence helpers return
 */
function localYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * @param {ToolContext} ctx
 * @param {any} task
 */
export function assertEditable(ctx, task) {
  /** @param {any} item */
  const refuse = (item) =>
    new ToolError(
      `${quote(item.title)} is from ${fromCalendar(item)}. AI apps can't change calendar items: it would change the real event. ` +
        "The person can change it in the calendar itself."
    );
  if (isFromCalendar(task)) throw refuse(task);
  if (task.parent_id) {
    const parent = loadTasks(ctx).find((t) => t.id === task.parent_id);
    if (parent && isFromCalendar(parent)) throw refuse(parent);
  }
}

/**
 * Spend one of the connection's changes for the hour. Called once a
 * change has passed its checks, just before it's saved.
 * @param {ToolContext} ctx
 */
export function spendWrite(ctx) {
  const slot = takeSlot(`write:${ctx.grant.id}`, WRITES_PER_HOUR, 60 * 60 * 1000);
  if (!slot.ok) {
    throw new ToolError(
      `That's ${WRITES_PER_HOUR} changes in the last hour, the most one connection can make. Try again in ${Math.ceil(slot.retryAfterMs / 60_000)} minutes.`
    );
  }
}

/**
 * @param {ToolContext} ctx
 * @param {"upsert" | "delete"} op
 * @param {any} taskSnapshot
 */
function push(ctx, op, taskSnapshot) {
  enqueueTaskPush(ctx.db, ctx.config, { op, appId: ctx.appId, taskSnapshot });
}

/**
 * "default", "none", "at start", "30 minutes before", "2 hours before",
 * "1 day before" (timed tasks) or "at 9:00AM" (all-day) → tasks.reminder.
 * @param {string} input
 * @param {boolean} timed
 */
function reminderValue(input, timed) {
  const text = input.trim().toLowerCase().replace(/_/g, " ");
  const needsTime = () => {
    if (!timed) throw new ToolError(`A reminder "before" a task needs the task to have a time. For an all-day task use something like "at 9:00AM".`);
  };
  if (text === "default") return "";
  if (text === "none" || text === "no reminder") return "none";
  if (text === "at start" || text === "at the start") {
    needsTime();
    return "before:0";
  }
  const before = /^(\d{1,5})\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)\s+before$/.exec(text);
  if (before) {
    needsTime();
    const unit = before[2].startsWith("d") ? 24 * 60 : before[2].startsWith("h") ? 60 : 1;
    const minutes = Number(before[1]) * unit;
    if (minutes > MAX_BEFORE_MINUTES) throw new ToolError("A reminder can be at most 7 days before.");
    return `before:${minutes}`;
  }
  const at = /^at\s+(.+)$/.exec(text);
  if (at) {
    if (timed) throw new ToolError(`"at <time>" reminders are for all-day tasks. For a task with a time use something like "30 minutes before".`);
    return `at:${normalizeTime(at[1], "reminder")}`;
  }
  throw new ToolError(`"reminder" must be "default", "none", "at start", like "30 minutes before" (tasks with a time) or like "at 9:00AM" (all-day tasks).`);
}

/**
 * The start and end a task should have after this call, or null when the
 * call doesn't touch its times. A new start keeps the length the task had
 * (as dragging it on the calendar does), else gets the form's hour.
 * @param {Record<string, any>} args
 * @param {{ task_time?: string, task_end_time?: string }} current
 * @param {{ subtask?: boolean }} [opts]
 */
function resolveTimes(args, current, { subtask = false } = {}) {
  if (!args.clear_time && !args.time && !args.end_time) return null;
  if (args.clear_time) {
    if (args.time || args.end_time) throw new ToolError(`Give either "clear_time" or a time, not both.`);
    return { task_time: "", task_end_time: "" };
  }
  const start = args.time ? normalizeTime(args.time, "time") : current.task_time || "";
  if (subtask) return { task_time: start, task_end_time: "" };
  let end = current.task_end_time || "";
  if (args.end_time) {
    end = normalizeTime(args.end_time, "end_time");
  } else if (args.time) {
    const oldStart = current.task_time ? timeMinutes(current.task_time) : null;
    const oldEnd = current.task_end_time ? timeMinutes(current.task_end_time) : null;
    const newStart = /** @type {number} */ (timeMinutes(start));
    if (oldStart != null && oldEnd != null && oldEnd > oldStart) {
      const newEnd = newStart + (oldEnd - oldStart);
      end = newEnd >= 24 * 60 ? "11:59PM" : formatTime(newEnd);
    } else {
      end = defaultEndTime(start);
    }
  }
  if (end && !start) throw new ToolError(`"end_time" needs a start "time" too.`);
  if (start && end && /** @type {number} */ (timeMinutes(end)) <= /** @type {number} */ (timeMinutes(start))) {
    throw new ToolError(`"end_time" must be after "time".`);
  }
  return { task_time: start, task_end_time: end };
}

/**
 * @param {string[] | undefined} tags
 */
function cleanTags(tags) {
  /** @type {string[]} */
  const out = [];
  for (const tag of tags || []) {
    const name = tag.replace(/^#+/, "").trim();
    if (name && !out.some((t) => lower(t) === lower(name))) out.push(name);
  }
  return out;
}

/**
 * Description as the editor stores it: the text, plus the same text as a
 * rich document so none of it is ever read as markup.
 * @param {string} text
 */
function descriptionFields(text) {
  if (countWords(text) > TASK_DESCRIPTION_WORDS) {
    throw new ToolError(`A task description can be at most ${TASK_DESCRIPTION_WORDS} words. Put longer text in a note.`);
  }
  return { description: text, description_json: text ? JSON.stringify(plainTextToDoc(text)) : "" };
}

/**
 * @param {any[]} priorities
 * @param {string} wanted
 */
function priorityNamed(priorities, wanted) {
  const found = findPriority(priorities, wanted);
  if (!found) throw new ToolError(`There's no priority called "${wanted}". The priorities are: ${priorities.map((p) => p.name).join(", ")}.`);
  return found;
}

/**
 * " on Tue 29 Sep, 9:00AM–10:00AM"
 * @param {any} task
 */
function when(task) {
  if (!task.due_date) return "";
  const time = task.task_time ? `, ${task.task_end_time ? `${task.task_time}–${task.task_end_time}` : task.task_time}` : "";
  return ` on ${dayLabel(task.due_date)}${time}`;
}

const TITLE = { type: "string", maxLength: 2000, description: "The task's title." };
const TIME = { type: "string", maxLength: 20, description: "A time like 9:15AM or 21:15." };
const REMINDER = {
  type: "string",
  maxLength: 40,
  description: `"default" (the person's usual setting), "none", "at start", like "30 minutes before" (tasks with a time) or like "at 9:00AM" (all-day tasks).`,
};
const TAG_LIST = { type: "array", maxItems: 100, items: { type: "string", maxLength: 100 } };

// Repeating, as the task form offers it (TaskForm/RecurrenceFields.jsx).
const REPEATS = ["none", "daily", "weekdays", "weekly", "biweekly", "monthly", "quarterly", "yearly", "custom_days"];
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const REPEAT_FIELDS = {
  repeats: {
    type: "string",
    enum: REPEATS,
    description: 'How it repeats; "none" stops it repeating. custom_days needs repeat_days.',
  },
  repeat_days: {
    type: "array",
    maxItems: 7,
    items: { type: "string", enum: WEEKDAY_NAMES },
    description: "For custom_days: the weekdays, e.g. [\"monday\", \"thursday\"].",
  },
  repeat_until: {
    type: "string",
    maxLength: 10,
    description: 'Last day it can come round, YYYY-MM-DD, or "never".',
  },
};

/**
 * The recurrence fields a task should have after this call, or null when
 * the call doesn't touch repeating. Stored exactly as the task form stores
 * them: task_type "recurring" with a recurrence, days only for
 * custom_days, and all of it cleared when it stops repeating.
 * @param {Record<string, any>} args
 * @param {any} current  the task as it is ({} for a new one)
 * @param {string} dueDate  the due date it will have
 */
function resolveRepeats(args, current, dueDate) {
  if (args.repeats == null && args.repeat_days == null && args.repeat_until == null) return null;
  const currentlyRepeating = current.recurrence && current.recurrence !== "none";
  const recurrence = args.repeats ?? (currentlyRepeating ? current.recurrence : "none");
  if (recurrence === "none") {
    if (args.repeat_days || args.repeat_until) throw new ToolError(`"repeat_days" and "repeat_until" only apply to a task that repeats.`);
    return { task_type: "one_time", recurrence: "none", recurrence_days: [], recurrence_end_date: "" };
  }
  if (!dueDate) throw new ToolError("A repeating task needs a due date: that's when it first comes round.");
  let days = [];
  if (recurrence === "custom_days") {
    const names = args.repeat_days ?? (current.recurrence === "custom_days" ? (current.recurrence_days || []).map((/** @type {number} */ d) => WEEKDAY_NAMES[d]) : []);
    days = [...new Set(names.map((/** @type {string} */ n) => WEEKDAY_NAMES.indexOf(n)))].filter((d) => d >= 0).sort((a, b) => a - b);
    if (!days.length) throw new ToolError(`"custom_days" needs "repeat_days", e.g. ["monday", "thursday"].`);
  } else if (args.repeat_days) {
    throw new ToolError(`"repeat_days" only applies with repeats "custom_days".`);
  }
  let until = currentlyRepeating ? current.recurrence_end_date || "" : "";
  if (args.repeat_until != null) {
    if (args.repeat_until === "never") until = "";
    else if (isRealDate(args.repeat_until)) until = args.repeat_until;
    else throw new ToolError(`"repeat_until" must be a date written like 2026-12-31, or "never".`);
  }
  if (until && until < dueDate) throw new ToolError(`"repeat_until" can't be before the due date, ${dueDate}.`);
  return { task_type: "recurring", recurrence, recurrence_days: days, recurrence_end_date: until };
}

/** @type {Tool} */
const createTask = {
  name: "create_task",
  title: "Add a task",
  description:
    "Add a task (due_date required), or a subtask under parent_task_id (title, due_date, time and description only). " +
    "With a time and no end_time it gets an hour, like the app's task form; with no priority it gets the middle one. " +
    "repeats makes it a repeating task (subtasks can't repeat). Can't add to items from connected calendars.",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE,
      due_date: { ...DATE, description: "The day it's due, YYYY-MM-DD. Required unless it's a subtask." },
      time: { ...TIME, description: "Start time. Leave out for an all-day task." },
      end_time: { ...TIME, description: "End time. Defaults to an hour after time." },
      priority: { type: "string", maxLength: 200, description: "A priority name (see list_priorities_and_tags) or id." },
      tags: { ...TAG_LIST, description: "Tags, without #." },
      description: { type: "string", maxLength: 20_000, description: `Plain text, at most ${TASK_DESCRIPTION_WORDS} words.` },
      reminder: REMINDER,
      ...REPEAT_FIELDS,
      parent_task_id: { type: "string", maxLength: 200, description: "Make it a subtask of this task." },
    },
    required: ["title"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const priorities = loadPriorities(ctx);
    /** @type {Record<string, any>} */
    let input;
    let parent = null;
    if (args.parent_task_id) {
      parent = getOwnTask(ctx, args.parent_task_id);
      assertEditable(ctx, parent);
      if (parent.parent_id) throw new ToolError("Subtasks can't have subtasks of their own.");
      const extra = Object.keys(args).filter((k) => !SUBTASK_FIELDS.has(k));
      if (extra.length) throw new ToolError(`Subtasks only have a title, due_date, time and description, not ${extra.join(", ")}.`);
      const siblings = loadTasks(ctx).filter((t) => t.parent_id === parent.id);
      input = {
        title: args.title,
        status: "todo",
        task_type: "one_time",
        parent_id: parent.id,
        order: siblings.length,
        due_date: args.due_date || "",
        ...(resolveTimes(args, {}, { subtask: true }) || {}),
        ...(args.description ? descriptionFields(args.description) : {}),
      };
    } else {
      if (!args.due_date) throw new ToolError(`"due_date" is required for a task (a subtask can go without).`);
      const times = resolveTimes(args, {}) || { task_time: "", task_end_time: "" };
      // The task form's default: the middle priority by order.
      const priority = args.priority ? priorityNamed(priorities, args.priority) : priorities[Math.floor(priorities.length / 2)] || null;
      input = {
        title: args.title,
        status: "todo",
        task_type: "one_time",
        recurrence: "none",
        due_date: args.due_date,
        ...times,
        priority_id: priority?.id || "",
        tags: cleanTags(args.tags),
        ...(args.description ? descriptionFields(args.description) : {}),
        reminder: args.reminder ? reminderValue(args.reminder, Boolean(times.task_time)) : "",
        ...(resolveRepeats(args, {}, args.due_date) || {}),
      };
    }
    validateClientInput("Task", input);
    spendWrite(ctx);
    const created = inTransaction(ctx.db, () =>
      createEntityRecord(ctx.db, { entityName: "Task", appId: ctx.appId, user: ctx.user, input, config: ctx.config })
    );
    push(ctx, "upsert", created);
    const where = parent ? ` under ${quote(parent.title)}` : "";
    const repeatWords = describeRecurrence(created);
    const repeating = repeatWords ? `, repeating ${repeatWords}` : "";
    logActivity(ctx, "create_task", `Added ${quote(created.title)}${where}${when(created)}${repeating}.`, {
      kind: "create_task",
      task_id: created.id,
      updated_date: created.updated_date,
    });
    const spokenWhen = created.due_date
      ? ` for ${speakDay(created.due_date, todayIn(ctx.timeZone))}${created.task_time ? ` at ${speakTime(created.task_time)}` : ""}`
      : "";
    return {
      text: `Added ${quote(created.title)}${where}${when(created)}${repeating} (id ${created.id}).`,
      data: {
        id: created.id,
        title: created.title,
        due_date: created.due_date || null,
        time: created.task_time || null,
        end_time: created.task_end_time || null,
        parent_task_id: parent?.id || null,
        spoken: `Added ${created.title}${spokenWhen}${repeating}.`,
      },
    };
  },
};

/** @type {Tool} */
const updateTask = {
  name: "update_task",
  title: "Change a task",
  description:
    "Change a task's title, date, time, priority, tags, description, reminder or how it repeats. A new time keeps the task's length unless end_time is given; " +
    "clear_time makes it all-day; repeats \"none\" stops it repeating. Moving a repeating task moves its next date. Can't change items from connected calendars.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", maxLength: 200, description: "The task's id." },
      title: TITLE,
      due_date: { ...DATE, description: "New due date, YYYY-MM-DD." },
      time: TIME,
      end_time: TIME,
      clear_time: { type: "boolean", description: "Make it an all-day task." },
      priority: { type: "string", maxLength: 200, description: "A priority name or id." },
      add_tags: { ...TAG_LIST, description: "Tags to add, without #." },
      remove_tags: { ...TAG_LIST, description: "Tags to remove." },
      description: { type: "string", maxLength: 20_000, description: `Replaces the description. Plain text, at most ${TASK_DESCRIPTION_WORDS} words.` },
      reminder: REMINDER,
      ...REPEAT_FIELDS,
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const task = getOwnTask(ctx, args.task_id);
    assertEditable(ctx, task);
    const subtask = Boolean(task.parent_id);
    if (Object.keys(args).length === 1) throw new ToolError("Say what to change: title, due_date, time, priority, tags, description, reminder or repeats.");
    if (subtask) {
      const extra = Object.keys(args).filter((k) => k !== "task_id" && k !== "clear_time" && !SUBTASK_FIELDS.has(k));
      if (extra.length) throw new ToolError(`Subtasks only have a title, due_date, time and description, not ${extra.join(", ")}.`);
    }

    /** @type {Record<string, any>} */
    const patch = {};
    /** @type {string[]} */
    const changes = [];
    if (args.title && args.title !== task.title) {
      patch.title = args.title;
      changes.push(`title to ${quote(args.title)}`);
    }
    if (args.due_date && args.due_date !== task.due_date) {
      patch.due_date = args.due_date;
      changes.push(`date ${task.due_date ? dayLabel(task.due_date) : "none"} → ${dayLabel(args.due_date)}`);
    }
    const times = resolveTimes(args, task, { subtask });
    if (times && (times.task_time !== (task.task_time || "") || times.task_end_time !== (task.task_end_time || ""))) {
      Object.assign(patch, times);
      changes.push(times.task_time ? `time ${times.task_end_time ? `${times.task_time}–${times.task_end_time}` : times.task_time}` : "now all-day");
    }
    if (args.priority) {
      const priorities = loadPriorities(ctx);
      const priority = priorityNamed(priorities, args.priority);
      if (priority.id !== task.priority_id) {
        patch.priority_id = priority.id;
        const old = priorities.find((p) => p.id === task.priority_id);
        changes.push(`priority ${old ? `${old.name} → ` : ""}${priority.name}`);
      }
    }
    if (args.add_tags || args.remove_tags) {
      const removing = new Set(cleanTags(args.remove_tags).map(lower));
      const next = cleanTags([...(task.tags || []), ...cleanTags(args.add_tags)]).filter((t) => !removing.has(lower(t)));
      if (JSON.stringify(next) !== JSON.stringify(task.tags || [])) {
        patch.tags = next;
        changes.push(`tags ${next.length ? next.map((t) => `#${t}`).join(" ") : "none"}`);
      }
    }
    if (args.description != null && args.description !== (task.description || "")) {
      Object.assign(patch, descriptionFields(args.description));
      changes.push("new description");
    }
    const timed = Boolean(("task_time" in patch ? patch.task_time : task.task_time) || "");
    if (args.reminder) {
      const value = reminderValue(args.reminder, timed);
      if (value !== (task.reminder || "")) {
        patch.reminder = value;
        changes.push(`reminder ${describeReminder(value)}`);
      }
    } else if (!subtask && "task_time" in patch && Boolean(task.task_time) !== timed) {
      // A "before" reminder means nothing on an all-day task and an "at"
      // one nothing on a timed task; the app's picker resets too.
      const kind = parseReminder(task.reminder).kind;
      if ((kind === "before" && !timed) || (kind === "at" && timed)) {
        patch.reminder = "";
        changes.push("reminder back to the default");
      }
    }

    const repeats = resolveRepeats(args, task, patch.due_date ?? task.due_date);
    if (repeats) {
      const changed = Object.entries(repeats).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(task[key] ?? (Array.isArray(value) ? [] : "")));
      if (changed) {
        Object.assign(patch, repeats);
        const words = describeRecurrence(repeats);
        changes.push(words ? `repeats ${words}` : "no longer repeats");
      }
    }

    if (!changes.length) {
      return { text: `Nothing to change: ${quote(task.title)} already looks like that (id ${task.id}).`, data: { id: task.id, changed: false } };
    }
    validateClientInput("Task", patch);
    spendWrite(ctx);
    /** @type {Record<string, any>} */
    const before = {};
    for (const key of Object.keys(patch)) before[key] = task[key] ?? "";
    const updated = inTransaction(ctx.db, () =>
      updateEntityRecord(ctx.db, { entityName: "Task", appId: ctx.appId, user: ctx.user, id: task.id, input: patch })
    );
    push(ctx, "upsert", updated);
    const summary = `Changed ${quote(updated.title)}: ${changes.join("; ")}.`;
    logActivity(ctx, "update_task", summary, { kind: "update_task", task_id: task.id, before, updated_date: updated.updated_date });
    return { text: `${summary} (id ${task.id})`, data: { id: task.id, changed: true, changes } };
  },
};

/** @type {Tool} */
const completeTask = {
  name: "complete_task",
  title: "Complete a task",
  description:
    "Mark a task done, or open again with done=false. A repeating task behaves as in the app: this occurrence is kept as a done task and the series moves to its next date.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", maxLength: 200, description: "The task's id." },
      done: { type: "boolean", description: "false reopens a done task. Defaults to true." },
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const task = getOwnTask(ctx, args.task_id);
    assertEditable(ctx, task);
    const done = args.done !== false;
    if (done === (task.status === "done")) {
      return { text: `${quote(task.title)} is already ${done ? "done" : "open"} (id ${task.id}).`, data: { id: task.id, changed: false } };
    }
    const scope = { appId: ctx.appId, user: ctx.user };
    const now = new Date().toISOString();
    const repeating = done && !task.parent_id && task.recurrence && task.recurrence !== "none";

    if (!repeating) {
      const patch = done ? { status: "done", completed_at: now } : { status: "todo", completed_at: "" };
      spendWrite(ctx);
      const updated = inTransaction(ctx.db, () => updateEntityRecord(ctx.db, { entityName: "Task", ...scope, id: task.id, input: patch }));
      push(ctx, "upsert", updated);
      const summary = `${done ? "Completed" : "Reopened"} ${quote(task.title)}.`;
      logActivity(ctx, "complete_task", summary, {
        kind: "update_task",
        task_id: task.id,
        before: { status: task.status || "todo", completed_at: task.completed_at || "" },
        updated_date: updated.updated_date,
      });
      return { text: `${summary} (id ${task.id})`, data: { id: task.id, changed: true, status: done ? "done" : "open" } };
    }

    // completeRecurringTask: keep this occurrence as a one-time done task
    // (with copies of its subtasks), then move the series on.
    const next = getNextRecurringDueDate(task);
    const nextDate = next ? localYmd(next) : null;
    const subtasks = loadTasks(ctx)
      .filter((t) => t.parent_id === task.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.created_date).localeCompare(String(b.created_date)));
    spendWrite(ctx);
    const result = inTransaction(ctx.db, () => {
      const create = (/** @type {Record<string, any>} */ input) =>
        createEntityRecord(ctx.db, { entityName: "Task", ...scope, input, config: ctx.config });
      const snapshot = create({
        title: task.title,
        description: task.description || "",
        priority_id: task.priority_id || "",
        status: "done",
        task_type: "one_time",
        recurrence: "none",
        recurrence_days: [],
        recurrence_end_date: "",
        due_date: task.due_date || "",
        task_time: task.task_time || "",
        tags: task.tags || [],
        completed_at: now,
      });
      const copies = subtasks.map((sub, i) =>
        create({
          title: sub.title,
          description: sub.description || "",
          status: sub.status || "todo",
          task_type: "one_time",
          due_date: sub.due_date || "",
          task_time: sub.task_time || "",
          completed_at: sub.completed_at || "",
          parent_id: snapshot.id,
          order: i,
        })
      );
      const update = (/** @type {string} */ id, /** @type {Record<string, any>} */ input) =>
        updateEntityRecord(ctx.db, { entityName: "Task", ...scope, id, input });
      const series = nextDate
        ? update(task.id, { due_date: nextDate, status: "todo", completed_at: "" })
        : update(task.id, { status: "done", completed_at: now });
      const reset = nextDate
        ? subtasks.filter((s) => s.status === "done").map((s) => ({ before: s, after: update(s.id, { status: "todo", completed_at: "" }) }))
        : [];
      return { snapshot, copies, series, reset };
    });
    for (const record of [result.snapshot, ...result.copies, result.series, ...result.reset.map((r) => r.after)]) push(ctx, "upsert", record);

    const summary = nextDate
      ? `Completed ${quote(task.title)}; it comes round again on ${dayLabel(nextDate)}.`
      : `Completed ${quote(task.title)}; that was its last time.`;
    logActivity(ctx, "complete_task", summary, {
      kind: "complete_recurring",
      task_id: task.id,
      before: nextDate
        ? { due_date: task.due_date || "", status: task.status || "todo", completed_at: task.completed_at || "" }
        : { status: task.status || "todo", completed_at: task.completed_at || "" },
      updated_date: result.series.updated_date,
      snapshot_id: result.snapshot.id,
      snapshot_updated_date: result.snapshot.updated_date,
      copy_ids: result.copies.map((c) => c.id),
      subtasks: result.reset.map(({ before, after }) => ({
        id: before.id,
        before: { status: before.status, completed_at: before.completed_at || "" },
        updated_date: after.updated_date,
      })),
    });
    return {
      text: `${summary} (series id ${task.id}, this occurrence kept as id ${result.snapshot.id})`,
      data: { id: task.id, changed: true, next_date: nextDate, completed_occurrence_id: result.snapshot.id },
    };
  },
};

/**
 * Move a top-level task, its subtasks and their files to Recently Deleted,
 * the way the app deletes (useDeletedTasks.recordDeletion's snapshot).
 * @param {ToolContext} ctx
 * @param {any} task
 */
function moveTaskToRecentlyDeleted(ctx, task) {
  const subtasks = loadTasks(ctx).filter((t) => t.parent_id === task.id);
  const files = Number(
    ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM task_attachments WHERE app_id = ? AND user_id = ? AND task_deleted_at IS NULL AND task_id IN (${[task, ...subtasks].map(() => "?").join(", ")})`)
      .get(ctx.appId, ctx.user.id, task.id, ...subtasks.map((s) => s.id))?.n || 0
  );
  const priority = loadPriorities(ctx).find((p) => p.id === task.priority_id);
  // useDeletedTasks.recordDeletion's snapshot. Retention is the server's
  // setting; the app uses the same number unless changed on that device.
  const record = {
    task_id: task.id,
    title: task.title,
    description: task.description || "",
    description_json: task.description_json || "",
    priority_id: task.priority_id || "",
    priority_color: priority?.color || "",
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
  validateClientInput("DeletedTask", record);
  spendWrite(ctx);
  const deleted = inTransaction(ctx.db, () => {
    const saved = createEntityRecord(ctx.db, { entityName: "DeletedTask", appId: ctx.appId, user: ctx.user, input: record, config: ctx.config });
    // Removes the subtasks with it, and holds the files for a restore.
    deleteEntityRecord(ctx.db, { entityName: "Task", appId: ctx.appId, user: ctx.user, id: task.id, config: ctx.config, holdFiles: true });
    return saved;
  });
  for (const gone of [task, ...subtasks]) push(ctx, "delete", gone);
  const withSubtasks = subtasks.length ? ` and its ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}` : "";
  const summary = `Moved ${quote(task.title)}${withSubtasks} to Recently Deleted.`;
  return { deleted, summary, files };
}

/** @type {Tool} */
const deleteTask = {
  name: "delete_task",
  title: "Delete a task",
  description:
    "Move a task, with its subtasks and attached files, to Recently Deleted, where the person can restore it for a week. " +
    "Refused for subtasks, because deleting a subtask is permanent. Can't delete items from connected calendars.",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string", maxLength: 200, description: "The task's id." } },
    required: ["task_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const task = getOwnTask(ctx, args.task_id);
    assertEditable(ctx, task);
    if (task.parent_id) {
      throw new ToolError("Deleting a subtask is permanent in Zephyrly, so AI apps can't. Mark it done instead, or the person can delete it in the app.");
    }
    const { deleted, summary, files } = moveTaskToRecentlyDeleted(ctx, task);
    logActivity(ctx, "delete_task", summary, { kind: "delete_task", deleted_id: deleted.id });
    const withFiles = files ? `, with its ${files === 1 ? "file" : `${files} files`},` : "";
    return {
      text: `${summary} The person can restore it${withFiles} from there for ${ctx.config.deletedTaskRetentionDays} days.`,
      data: { id: task.id, deleted: true, recently_deleted_id: deleted.id },
    };
  },
};

/** @type {Tool} */
const createNote = {
  name: "create_note",
  title: "Add a note",
  description: `Add a note from plain text (one paragraph per line, at most ${NOTE_WORDS} words).`,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 100_000, description: "The note's text." },
      title: { type: "string", maxLength: 200, description: "A title. Optional." },
      tags: { ...TAG_LIST, description: "Tags, without #." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    if (countWords(args.text) > NOTE_WORDS) throw new ToolError(`A note can be at most ${NOTE_WORDS} words.`);
    const input = {
      title: args.title || "",
      content_text: args.text,
      content_json: JSON.stringify(plainTextToDoc(args.text)),
      tags: cleanTags(args.tags),
      pinned: false,
    };
    validateClientInput("Note", input);
    spendWrite(ctx);
    const created = inTransaction(ctx.db, () =>
      createEntityRecord(ctx.db, { entityName: "Note", appId: ctx.appId, user: ctx.user, input, config: ctx.config })
    );
    const name = created.title ? quote(created.title) : "an untitled note";
    logActivity(ctx, "create_note", `Added the note ${name}.`, { kind: "create_note", note_id: created.id, updated_date: created.updated_date });
    return { text: `Added the note ${name} (id ${created.id}).`, data: { id: created.id, title: created.title || "Untitled" } };
  },
};

/**
 * A note's body as a rich-text document: its saved JSON, or its plain
 * text laid out as the editor would open it.
 * @param {any} note
 */
function noteDoc(note) {
  if (note.content_json) {
    try {
      const parsed = JSON.parse(note.content_json);
      if (parsed && parsed.type === "doc") return parsed;
    } catch {
      // Fall through to the plain text.
    }
  }
  return note.content_text ? plainTextToDoc(note.content_text) : { type: "doc", content: [] };
}

/**
 * Replace `find` inside the document's text, one run of text at a time, so
 * formatting and note↔task links around it are kept. Returns how many.
 * @param {any} node
 * @param {string} find
 * @param {string} replacement
 */
function replaceInDoc(node, find, replacement) {
  let count = 0;
  if (!Array.isArray(node.content)) return 0;
  for (const child of node.content) {
    if (child.type === "text" && typeof child.text === "string" && child.text.includes(find)) {
      const parts = child.text.split(find);
      count += parts.length - 1;
      child.text = parts.join(replacement);
    } else {
      count += replaceInDoc(child, find, replacement);
    }
  }
  // ProseMirror has no empty text nodes; a run replaced with nothing goes.
  node.content = node.content.filter((/** @type {any} */ child) => child.type !== "text" || child.text);
  return count;
}

/**
 * @param {any} node
 */
function countTaskLinks(node) {
  let count = 0;
  for (const child of node.content || []) {
    if ((child.marks || []).some((/** @type {any} */ m) => m.type === "taskLink")) count += 1;
    count += countTaskLinks(child);
  }
  return count;
}

/** @type {Tool} */
const updateNote = {
  name: "update_note",
  title: "Change a note",
  description:
    "Change a note (read it first with get_note): its title, tags or pinning; add text at the end (append_text); " +
    "swap words inside it (find and replace_with, which keeps its formatting and links to tasks); or replace all of its text " +
    "(replace_all_text, which drops its formatting and task links). Every change can be undone in Zephyrly.",
  inputSchema: {
    type: "object",
    properties: {
      note_id: { type: "string", maxLength: 200, description: "The note's id." },
      title: { type: "string", maxLength: 200, "x-allow-empty": true, description: "New title (empty for untitled)." },
      add_tags: { ...TAG_LIST, description: "Tags to add, without #." },
      remove_tags: { ...TAG_LIST, description: "Tags to remove." },
      pinned: { type: "boolean", description: "Pin it to the top, or unpin it." },
      append_text: { type: "string", maxLength: 100_000, description: "Plain text to add at the end, one paragraph per line." },
      find: { type: "string", maxLength: 2000, description: "Exact text to look for; every match is replaced." },
      replace_with: { type: "string", maxLength: 20_000, "x-allow-empty": true, description: "What find becomes (empty to delete it)." },
      replace_all_text: { type: "string", maxLength: 100_000, description: "New text for the whole note, one paragraph per line." },
    },
    required: ["note_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const note = getOwnNote(ctx, args.note_id);
    if (Object.keys(args).length === 1) {
      throw new ToolError("Say what to change: title, tags, pinned, append_text, find and replace_with, or replace_all_text.");
    }
    if ((args.find != null) !== (args.replace_with != null)) throw new ToolError(`"find" and "replace_with" go together.`);
    if (args.replace_all_text != null && (args.append_text != null || args.find != null)) {
      throw new ToolError(`"replace_all_text" replaces everything, so use it on its own, without append_text or find.`);
    }

    /** @type {Record<string, any>} */
    const patch = {};
    /** @type {string[]} */
    const changes = [];
    if (args.title != null && args.title !== (note.title || "")) {
      patch.title = args.title;
      changes.push(args.title ? `title to ${quote(args.title)}` : "no title");
    }
    if (args.add_tags || args.remove_tags) {
      const removing = new Set(cleanTags(args.remove_tags).map(lower));
      const next = cleanTags([...(note.tags || []), ...cleanTags(args.add_tags)]).filter((t) => !removing.has(lower(t)));
      if (JSON.stringify(next) !== JSON.stringify(note.tags || [])) {
        patch.tags = next;
        changes.push(`tags ${next.length ? next.map((t) => `#${t}`).join(" ") : "none"}`);
      }
    }
    if (args.pinned != null && args.pinned !== Boolean(note.pinned)) {
      patch.pinned = args.pinned;
      changes.push(args.pinned ? "pinned" : "unpinned");
    }

    if (args.replace_all_text != null || args.find != null || args.append_text != null) {
      let doc = noteDoc(note);
      if (args.replace_all_text != null) {
        const links = countTaskLinks(doc);
        doc = plainTextToDoc(args.replace_all_text);
        changes.push(`replaced all its text${links ? `, removing ${links} link${links === 1 ? "" : "s"} to tasks` : ""}`);
      }
      if (args.find != null) {
        const found = replaceInDoc(doc, args.find, args.replace_with);
        if (!found) {
          throw new ToolError(
            `Couldn't find "${args.find}" in the note. It has to match exactly, within one stretch of text: a change of formatting splits it.`
          );
        }
        changes.push(`replaced "${args.find}"${found > 1 ? ` (${found} times)` : ""}`);
      }
      if (args.append_text != null) {
        doc.content = [...(doc.content || []), ...plainTextToDoc(args.append_text).content];
        changes.push("added text at the end");
      }
      const text = docToText(doc);
      if (countWords(text) > NOTE_WORDS) throw new ToolError(`A note can be at most ${NOTE_WORDS} words.`);
      patch.content_json = text ? JSON.stringify(doc) : "";
      patch.content_text = text;
    }

    const name = note.title ? quote(note.title) : "the untitled note";
    if (!changes.length) return { text: `Nothing to change: ${name} already looks like that (id ${note.id}).`, data: { id: note.id, changed: false } };
    validateClientInput("Note", patch);
    spendWrite(ctx);
    /** @type {Record<string, any>} */
    const before = {};
    for (const key of Object.keys(patch)) before[key] = note[key] ?? (key === "tags" ? [] : key === "pinned" ? false : "");
    const updated = inTransaction(ctx.db, () =>
      updateEntityRecord(ctx.db, { entityName: "Note", appId: ctx.appId, user: ctx.user, id: note.id, input: patch })
    );
    const summary = `Changed the note ${name}: ${changes.join("; ")}.`;
    logActivity(ctx, "update_note", summary, { kind: "update_note", note_id: note.id, before, updated_date: updated.updated_date });
    return { text: `${summary} (id ${note.id})`, data: { id: note.id, changed: true, changes } };
  },
};

/** @type {Tool} */
const deleteNote = {
  name: "delete_note",
  title: "Delete a note",
  description: "Move a note to Recently Deleted, where the person can restore it for a week.",
  inputSchema: {
    type: "object",
    properties: { note_id: { type: "string", maxLength: 200, description: "The note's id." } },
    required: ["note_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const note = getOwnNote(ctx, args.note_id);
    // The Notes page's own snapshot (src/pages/Notes.jsx).
    const record = {
      note_id: note.id,
      title: note.title || "",
      content_json: note.content_json || "",
      content_text: note.content_text || "",
      pinned: Boolean(note.pinned),
      tags: note.tags || [],
      priority_id: note.priority_id || "",
    };
    validateClientInput("DeletedNote", record);
    spendWrite(ctx);
    const deleted = inTransaction(ctx.db, () => {
      const saved = createEntityRecord(ctx.db, { entityName: "DeletedNote", appId: ctx.appId, user: ctx.user, input: record, config: ctx.config });
      deleteEntityRecord(ctx.db, { entityName: "Note", appId: ctx.appId, user: ctx.user, id: note.id, config: ctx.config });
      return saved;
    });
    const summary = `Moved the note ${note.title ? quote(note.title) : "(untitled)"} to Recently Deleted.`;
    logActivity(ctx, "delete_note", summary, { kind: "delete_note", deleted_id: deleted.id });
    return {
      text: `${summary} The person can restore it from there for ${ctx.config.deletedTaskRetentionDays} days.`,
      data: { id: note.id, deleted: true, recently_deleted_id: deleted.id },
    };
  },
};

/** @type {Tool} */
const skipOccurrence = {
  name: "skip_occurrence",
  title: "Skip this time",
  description:
    "Skip the next time a repeating task comes round without marking it done: it moves on to the time after. " +
    "If that was its last time, it goes to Recently Deleted, as in the app.",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string", maxLength: 200, description: "The repeating task's id." } },
    required: ["task_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const task = getOwnTask(ctx, args.task_id);
    assertEditable(ctx, task);
    if (task.parent_id || !task.recurrence || task.recurrence === "none") {
      throw new ToolError(`${quote(task.title)} doesn't repeat. Move it with update_task, or finish it with complete_task.`);
    }
    // skipRecurringTask in the app: on to the next date, or deleted.
    const next = getNextRecurringDueDate(task);
    if (!next) {
      const { deleted, summary, files } = moveTaskToRecentlyDeleted(ctx, task);
      logActivity(ctx, "skip_occurrence", `Skipped ${quote(task.title)}'s last time. ${summary}`, { kind: "delete_task", deleted_id: deleted.id });
      return {
        text: `That was ${quote(task.title)}'s last time, so it moved to Recently Deleted${files ? " with its files" : ""}.`,
        data: { id: task.id, deleted: true, recently_deleted_id: deleted.id },
      };
    }
    const nextDate = localYmd(next);
    const patch = { due_date: nextDate, status: "todo", completed_at: "" };
    spendWrite(ctx);
    const updated = inTransaction(ctx.db, () => updateEntityRecord(ctx.db, { entityName: "Task", appId: ctx.appId, user: ctx.user, id: task.id, input: patch }));
    push(ctx, "upsert", updated);
    const summary = `Skipped ${quote(task.title)} this time; it comes round again on ${dayLabel(nextDate)}.`;
    logActivity(ctx, "skip_occurrence", summary, {
      kind: "update_task",
      task_id: task.id,
      before: { due_date: task.due_date || "", status: task.status || "todo", completed_at: task.completed_at || "" },
      updated_date: updated.updated_date,
    });
    return { text: `${summary} (id ${task.id})`, data: { id: task.id, next_date: nextDate } };
  },
};

const PRIORITY_FIELDS = ["name", "color", "order"];
/** @param {any} p */
const priorityFields = (p) => Object.fromEntries(PRIORITY_FIELDS.map((k) => [k, p[k]]));

/** @type {Tool} */
const editPriorities = {
  name: "edit_priorities",
  title: "Change priorities",
  description:
    "Change the person's priorities (the list in Settings, most urgent first): add one, rename or recolour one, move one " +
    "to a new position, or delete one. Deleting leaves its tasks and notes with no priority label. Every change can be undone.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "rename", "recolor", "move", "delete"] },
      priority: { type: "string", maxLength: 200, description: "The priority to change, by name or id (not for add)." },
      name: { type: "string", maxLength: 200, description: "For add and rename: the name." },
      color: { type: "string", enum: PRIORITY_COLORS, description: 'For add and recolor. "slate" is grey; "_alt" colours are deeper shades. Add defaults to slate.' },
      position: { type: "integer", minimum: 1, maximum: 50, description: "For move: the new place, 1 being most urgent." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const priorities = loadPriorities(ctx);
    const scope = { appId: ctx.appId, user: ctx.user };
    const named = (/** @type {string} */ wanted) => priorityNamed(priorities, wanted);
    const nameTaken = (/** @type {string} */ name, /** @type {string} */ exceptId = "") =>
      priorities.some((p) => p.id !== exceptId && lower(p.name) === lower(name));
    const need = (/** @type {string} */ key) => {
      if (args[key] == null) throw new ToolError(`"${key}" is needed to ${args.action} a priority.`);
      return args[key];
    };

    /** @type {{ id: string, before: any, after_updated_date: string | null }[]} */
    const rows = [];
    let summary = "";
    if (args.action === "add") {
      const name = need("name");
      if (nameTaken(name)) throw new ToolError(`There's already a priority called "${name}".`);
      const input = { name, color: args.color || "slate", order: priorities.length ? Math.max(...priorities.map((p) => Number(p.order) || 0)) + 1 : 0 };
      validateClientInput("Priority", input);
      spendWrite(ctx);
      const created = inTransaction(ctx.db, () => createEntityRecord(ctx.db, { entityName: "Priority", ...scope, input, config: ctx.config }));
      rows.push({ id: created.id, before: null, after_updated_date: String(created.updated_date) });
      summary = `Added the priority ${quote(name)}, least urgent.`;
    } else if (args.action === "rename" || args.action === "recolor") {
      const target = named(need("priority"));
      const patch = args.action === "rename" ? { name: need("name") } : { color: need("color") };
      if (patch.name && nameTaken(patch.name, target.id)) throw new ToolError(`There's already a priority called "${patch.name}".`);
      validateClientInput("Priority", patch);
      spendWrite(ctx);
      const updated = inTransaction(ctx.db, () => updateEntityRecord(ctx.db, { entityName: "Priority", ...scope, id: target.id, input: patch }));
      rows.push({ id: target.id, before: priorityFields(target), after_updated_date: String(updated.updated_date) });
      summary = patch.name ? `Renamed the priority ${quote(target.name)} to ${quote(patch.name)}.` : `Made the priority ${quote(target.name)} ${patch.color}.`;
    } else if (args.action === "move") {
      const target = named(need("priority"));
      const position = Math.min(need("position"), priorities.length);
      const reordered = priorities.filter((p) => p.id !== target.id);
      reordered.splice(position - 1, 0, target);
      spendWrite(ctx);
      // Settings renumbers the whole list on a move; so does this.
      inTransaction(ctx.db, () => {
        reordered.forEach((p, i) => {
          if (p.order === i) return;
          const updated = updateEntityRecord(ctx.db, { entityName: "Priority", ...scope, id: p.id, input: { order: i } });
          rows.push({ id: p.id, before: { order: p.order }, after_updated_date: String(updated.updated_date) });
        });
      });
      summary = `Moved the priority ${quote(target.name)} to place ${position}.`;
    } else {
      const target = named(need("priority"));
      spendWrite(ctx);
      inTransaction(ctx.db, () => deleteEntityRecord(ctx.db, { entityName: "Priority", ...scope, id: target.id, config: ctx.config }));
      rows.push({ id: target.id, before: priorityFields(target), after_updated_date: null });
      summary = `Deleted the priority ${quote(target.name)}; its tasks and notes now have none.`;
    }
    logActivity(ctx, "edit_priorities", summary, rows.length ? { kind: "rows", entity: "Priority", rows } : null);
    const now = loadPriorities(ctx).map((p) => p.name);
    return { text: `${summary} The priorities, most urgent first: ${now.join(", ") || "none"}.`, data: { priorities: now } };
  },
};

/** @type {Tool} */
const editTags = {
  name: "edit_tags",
  title: "Change tags",
  description:
    "Add a tag to the person's saved tags, remove one from the saved list (tasks and notes keep it), or rename a tag " +
    "everywhere: on every task and note that has it (not calendar items) and in the saved list. Every change can be undone.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "remove", "rename"] },
      tag: { type: "string", maxLength: 100, description: "The tag, without #." },
      new_name: { type: "string", maxLength: 100, description: "For rename: the new name, without #." },
    },
    required: ["action", "tag"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  write: true,
  handler(ctx, args) {
    const tag = cleanTags([args.tag])[0];
    if (!tag) throw new ToolError('"tag" is required.');
    const scope = { appId: ctx.appId, user: ctx.user };
    const saved = listRecords(ctx, "SavedTag");
    const savedRow = saved.find((t) => lower(t.name) === lower(tag));

    if (args.action === "add") {
      if (savedRow) return { text: `#${savedRow.name} is already a saved tag.`, data: { changed: false } };
      validateClientInput("SavedTag", { name: tag });
      spendWrite(ctx);
      const created = inTransaction(ctx.db, () => createEntityRecord(ctx.db, { entityName: "SavedTag", ...scope, input: { name: tag }, config: ctx.config }));
      logActivity(ctx, "edit_tags", `Saved the tag #${tag}.`, { kind: "rows", entity: "SavedTag", rows: [{ id: created.id, before: null, after_updated_date: String(created.updated_date) }] });
      return { text: `Saved the tag #${tag}.`, data: { changed: true } };
    }
    if (args.action === "remove") {
      if (!savedRow) throw new ToolError(`#${tag} isn't a saved tag. Saved tags are: ${saved.map((t) => `#${t.name}`).join(" ") || "none"}.`);
      spendWrite(ctx);
      inTransaction(ctx.db, () => deleteEntityRecord(ctx.db, { entityName: "SavedTag", ...scope, id: savedRow.id, config: ctx.config }));
      logActivity(ctx, "edit_tags", `Removed #${savedRow.name} from the saved tags.`, {
        kind: "rows",
        entity: "SavedTag",
        rows: [{ id: savedRow.id, before: { name: savedRow.name }, after_updated_date: null }],
      });
      return { text: `Removed #${savedRow.name} from the saved tags. Tasks and notes that have it keep it.`, data: { changed: true } };
    }

    // Rename everywhere.
    const newName = cleanTags([args.new_name || ""])[0];
    if (!newName) throw new ToolError('"new_name" is needed to rename a tag.');
    if (newName === tag) return { text: "That's already its name.", data: { changed: false } };
    const renamed = (/** @type {string[]} */ tags) => cleanTags((tags || []).map((t) => (lower(t) === lower(tag) ? newName : t)));
    const tasks = loadTasks(ctx).filter((t) => !isFromCalendar(t) && (t.tags || []).some((/** @type {string} */ x) => lower(x) === lower(tag)));
    const notes = listRecords(ctx, "Note").filter((n) => (n.tags || []).some((/** @type {string} */ x) => lower(x) === lower(tag)));
    if (!tasks.length && !notes.length && !savedRow) throw new ToolError(`Nothing has the tag #${tag}.`);
    spendWrite(ctx);
    /** @type {{ id: string, before: any, after_updated_date: string }[]} */
    const taskRows = [];
    /** @type {{ id: string, before: any, after_updated_date: string }[]} */
    const noteRows = [];
    /** @type {any[]} */
    const pushed = [];
    let savedChange = null;
    inTransaction(ctx.db, () => {
      for (const t of tasks) {
        const updated = updateEntityRecord(ctx.db, { entityName: "Task", ...scope, id: t.id, input: { tags: renamed(t.tags) } });
        taskRows.push({ id: t.id, before: { tags: t.tags }, after_updated_date: String(updated.updated_date) });
        pushed.push(updated);
      }
      for (const n of notes) {
        const updated = updateEntityRecord(ctx.db, { entityName: "Note", ...scope, id: n.id, input: { tags: renamed(n.tags) } });
        noteRows.push({ id: n.id, before: { tags: n.tags }, after_updated_date: String(updated.updated_date) });
      }
      if (savedRow) {
        const clash = saved.find((x) => x.id !== savedRow.id && lower(x.name) === lower(newName));
        if (clash) {
          deleteEntityRecord(ctx.db, { entityName: "SavedTag", ...scope, id: savedRow.id, config: ctx.config });
          savedChange = { id: savedRow.id, before: { name: savedRow.name }, after_updated_date: null };
        } else {
          const updated = updateEntityRecord(ctx.db, { entityName: "SavedTag", ...scope, id: savedRow.id, input: { name: newName } });
          savedChange = { id: savedRow.id, before: { name: savedRow.name }, after_updated_date: String(updated.updated_date) };
        }
      }
    });
    for (const t of pushed) push(ctx, "upsert", t);
    const counts = [tasks.length && `${tasks.length} task${tasks.length === 1 ? "" : "s"}`, notes.length && `${notes.length} note${notes.length === 1 ? "" : "s"}`].filter(Boolean);
    const summary = `Renamed #${tag} to #${newName}${counts.length ? ` on ${counts.join(" and ")}` : ""}${savedRow ? " and in the saved tags" : ""}.`;
    // One log entry, one Undo, for the whole rename.
    logActivity(ctx, "edit_tags", summary, {
      kind: "many",
      parts: [
        { kind: "rows", entity: "Task", rows: taskRows },
        { kind: "rows", entity: "Note", rows: noteRows },
        ...(savedChange ? [{ kind: "rows", entity: "SavedTag", rows: [savedChange] }] : []),
      ],
    });
    return { text: summary, data: { tasks: tasks.length, notes: notes.length, saved_tag: Boolean(savedRow) } };
  },
};

/** @type {Tool[]} */
export const WRITE_TOOLS = [
  createTask,
  updateTask,
  completeTask,
  skipOccurrence,
  deleteTask,
  createNote,
  updateNote,
  deleteNote,
  editPriorities,
  editTags,
];
