// @ts-check
/**
 * @file Tools that change things. Offered only to a connection the person
 * allowed to make changes, and held to rules the server enforces whatever
 * the AI app has been told:
 *   - nothing from a connected calendar is changed, subtasks included:
 *     editing it here would change the real event
 *   - nothing is deleted for good: deletes go to Recently Deleted, and
 *     subtasks and tasks with files (whose delete is permanent) are refused
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
import { countWords, plainTextToDoc } from "../lib/plain-text-doc.js";
import { ToolError } from "./args.js";
import { logActivity } from "./activity.js";
import { DATE, findPriority, getOwnTask, loadPriorities, loadTasks, lower } from "./context.js";
import { WRITES_PER_HOUR, takeSlot } from "./rate-limit.js";
import { dayLabel, defaultEndTime, describeReminder, formatTime, fromCalendar, isFromCalendar, normalizeTime, timeMinutes } from "./view.js";

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
function assertEditable(ctx, task) {
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
function spendWrite(ctx) {
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

/** @type {Tool} */
const createTask = {
  name: "create_task",
  title: "Add a task",
  description:
    "Add a task (due_date required), or a subtask under parent_task_id (title, due_date, time and description only). " +
    "With a time and no end_time it gets an hour, like the app's task form; with no priority it gets the middle one. " +
    "Can't add to items from connected calendars.",
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
      };
    }
    validateClientInput("Task", input);
    spendWrite(ctx);
    const created = inTransaction(ctx.db, () =>
      createEntityRecord(ctx.db, { entityName: "Task", appId: ctx.appId, user: ctx.user, input, config: ctx.config })
    );
    push(ctx, "upsert", created);
    const where = parent ? ` under ${quote(parent.title)}` : "";
    logActivity(ctx, "create_task", `Added ${quote(created.title)}${where}${when(created)}.`, {
      kind: "create_task",
      task_id: created.id,
      updated_date: created.updated_date,
    });
    return {
      text: `Added ${quote(created.title)}${where}${when(created)} (id ${created.id}).`,
      data: { id: created.id, title: created.title, due_date: created.due_date || null, time: created.task_time || null, end_time: created.task_end_time || null, parent_task_id: parent?.id || null },
    };
  },
};

/** @type {Tool} */
const updateTask = {
  name: "update_task",
  title: "Change a task",
  description:
    "Change a task's title, date, time, priority, tags, description or reminder. A new time keeps the task's length unless end_time is given; " +
    "clear_time makes it all-day. Moving a repeating task moves its next date. Can't change items from connected calendars.",
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
    if (Object.keys(args).length === 1) throw new ToolError("Say what to change: title, due_date, time, priority, tags, description or reminder.");
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

/** @type {Tool} */
const deleteTask = {
  name: "delete_task",
  title: "Delete a task",
  description:
    "Move a task, with its subtasks, to Recently Deleted, where the person can restore it for a week. " +
    "Refused for subtasks and for tasks with attached files, because deleting those is permanent. Can't delete items from connected calendars.",
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
    const subtasks = loadTasks(ctx).filter((t) => t.parent_id === task.id);
    const files = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM task_attachments WHERE app_id = ? AND user_id = ? AND task_id IN (${[task, ...subtasks].map(() => "?").join(", ")})`)
      .get(ctx.appId, ctx.user.id, task.id, ...subtasks.map((s) => s.id));
    if (Number(files?.n || 0) > 0) {
      throw new ToolError(`${quote(task.title)} has attached files, and deleting a task removes its files for good. The person can delete it in the app if they mean to.`);
    }
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
      // Removes the subtasks with it.
      deleteEntityRecord(ctx.db, { entityName: "Task", appId: ctx.appId, user: ctx.user, id: task.id });
      return saved;
    });
    for (const gone of [task, ...subtasks]) push(ctx, "delete", gone);
    const withSubtasks = subtasks.length ? ` and its ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}` : "";
    const summary = `Moved ${quote(task.title)}${withSubtasks} to Recently Deleted.`;
    logActivity(ctx, "delete_task", summary, { kind: "delete_task", deleted_id: deleted.id });
    return {
      text: `${summary} The person can restore it from there for ${ctx.config.deletedTaskRetentionDays} days.`,
      data: { id: task.id, deleted: true, recently_deleted_id: deleted.id },
    };
  },
};

/** @type {Tool} */
const createNote = {
  name: "create_note",
  title: "Add a note",
  description: `Add a note from plain text (one paragraph per line, at most ${NOTE_WORDS} words). Existing notes can't be edited from here.`,
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

/** @type {Tool[]} */
export const WRITE_TOOLS = [createTask, updateTask, completeTask, deleteTask, createNote];
