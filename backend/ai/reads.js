// @ts-check
/**
 * @file Tools that only read: the agenda, task and note search, details,
 * and the person's priorities and tags. Offered to every connection.
 */
import { getEntityRecord } from "../store.js";
import { ToolError } from "./args.js";
import { DATE, asToolError, findPriority, getOwnTask, hasTag, listRecords, loadPriorities, loadTasks, lower } from "./context.js";
import {
  addDaysYmd,
  byTimeThenPriority,
  clip,
  dayLabel,
  describeRecurrence,
  describeReminder,
  fromCalendar,
  isCalendarEvent,
  isFromCalendar,
  speakDay,
  speakList,
  speakTask,
  taskData,
  taskLine,
  todayIn,
  viewContext,
} from "./view.js";

const MAX_OVERDUE = 30;
const NOTE_MAX_CHARS = 20_000;

/**
 * @typedef {import("./context.js").Tool} Tool
 */

/** @type {Tool} */
const getAgenda = {
  name: "get_agenda",
  title: "Agenda",
  description:
    "What's due: the person's open tasks and calendar events day by day, starting today (in their time zone) unless start_date says otherwise. " +
    "When the range starts today, overdue open tasks are listed first. Repeating tasks appear once, on their next date. " +
    "Events come from connected Google/Apple calendars and are read-only here.",
  inputSchema: {
    type: "object",
    properties: {
      start_date: { ...DATE, description: "First day, YYYY-MM-DD. Defaults to today." },
      days: { type: "integer", minimum: 1, maximum: 31, description: "How many days, 1–31. Defaults to 1." },
      include_overdue: { type: "boolean", description: "List overdue tasks when starting today. Defaults to true." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx, args) {
    const today = todayIn(ctx.timeZone);
    const start = args.start_date || today;
    const days = args.days || 1;
    const end = addDaysYmd(start, days - 1);
    const all = loadTasks(ctx);
    const view = viewContext(all, loadPriorities(ctx));
    const topLevel = all.filter((t) => !t.parent_id);
    const sort = byTimeThenPriority(view);

    const overdue =
      start === today && args.include_overdue !== false
        ? topLevel
            .filter((t) => t.status !== "done" && t.due_date && t.due_date < today && !isCalendarEvent(t))
            .sort((a, b) => a.due_date.localeCompare(b.due_date) || sort(a, b))
        : [];

    const lines = [`Agenda from ${dayLabel(start, { year: true })}${days > 1 ? ` to ${dayLabel(end, { year: true })}` : ""} (time zone ${ctx.timeZone}; today is ${today}).`];
    if (overdue.length) {
      lines.push("", `Overdue (${overdue.length}):`);
      for (const t of overdue.slice(0, MAX_OVERDUE)) lines.push(`- ${taskLine(t, view, { withDate: true })}`);
      if (overdue.length > MAX_OVERDUE) lines.push(`- …and ${overdue.length - MAX_OVERDUE} more (use search_tasks with due_before).`);
    }

    const dayData = [];
    for (let i = 0; i < days; i += 1) {
      const date = addDaysYmd(start, i);
      const due = topLevel.filter((t) => t.due_date === date);
      const open = due.filter((t) => t.status !== "done").sort(sort);
      const done = due.filter((t) => t.status === "done" && !isCalendarEvent(t)).length;
      lines.push("", `${dayLabel(date)}${date === today ? " (today)" : ""}:`);
      if (!open.length) lines.push("- Nothing due.");
      for (const t of open) lines.push(`- ${taskLine(t, view)}`);
      if (done) lines.push(`- (${done} already done)`);
      dayData.push({ date, tasks: open.map((t) => taskData(t, view)), done_count: done });
    }

    // The same agenda as a couple of sentences, for Siri.
    const spokenDays = dayData.map(({ date }) => {
      const open = topLevel.filter((t) => t.due_date === date && t.status !== "done").sort(sort);
      const when = speakDay(date, today);
      const label = when === "today" || when === "tomorrow" ? `${when.charAt(0).toUpperCase()}${when.slice(1)}` : `On ${when}`;
      if (!open.length) return `${label} there's nothing due.`;
      return `${label} you have ${open.length === 1 ? "one thing" : `${open.length} things`}: ${speakList(open.map(speakTask))}.`;
    });
    if (overdue.length) {
      spokenDays.push(`Also ${overdue.length} overdue: ${speakList(overdue.map((t) => t.title), 5)}.`);
    }

    return {
      text: lines.join("\n"),
      data: {
        time_zone: ctx.timeZone,
        today,
        start_date: start,
        end_date: end,
        overdue: overdue.slice(0, MAX_OVERDUE).map((t) => taskData(t, view)),
        overdue_count: overdue.length,
        days: dayData,
        spoken: spokenDays.join(" "),
      },
    };
  },
};

/** @type {Tool} */
const searchTasks = {
  name: "search_tasks",
  title: "Search tasks",
  description:
    "Find tasks by words in the title or description, status, due dates, tag or priority. Returns top-level tasks with subtask counts; " +
    "when `text` is given, matching subtasks are included too. Calendar events are left out unless include_calendar_events is true.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 200, description: "Words to look for in the title or description." },
      status: { type: "string", enum: ["open", "done", "any"], description: "Defaults to open." },
      due_after: { ...DATE, description: "Due on or after this date." },
      due_before: { ...DATE, description: "Due on or before this date." },
      tag: { type: "string", maxLength: 100, description: "A tag, with or without #." },
      priority: { type: "string", maxLength: 200, description: "A priority name (see list_priorities_and_tags) or id." },
      include_calendar_events: { type: "boolean", description: "Include events from connected calendars. Defaults to false." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "At most this many, 1–50. Defaults to 20." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx, args) {
    const all = loadTasks(ctx);
    const priorities = loadPriorities(ctx);
    const view = viewContext(all, priorities);
    const status = args.status || "open";
    const limit = args.limit || 20;
    const words = args.text ? lower(args.text).split(/\s+/).filter(Boolean) : [];
    const priority = args.priority ? findPriority(priorities, args.priority) : null;
    if (args.priority && !priority) {
      throw new ToolError(`There's no priority called "${args.priority}". The priorities are: ${priorities.map((p) => p.name).join(", ")}.`);
    }

    const matches = all.filter((t) => {
      if (t.parent_id && !words.length) return false;
      if (status === "open" && t.status === "done") return false;
      if (status === "done" && t.status !== "done") return false;
      if (!args.include_calendar_events && isCalendarEvent(t)) return false;
      if (args.due_after && !(t.due_date && t.due_date >= args.due_after)) return false;
      if (args.due_before && !(t.due_date && t.due_date <= args.due_before)) return false;
      if (args.tag && !hasTag(t.tags, args.tag)) return false;
      if (priority && t.priority_id !== priority.id) return false;
      if (words.length) {
        const haystack = lower(`${t.title} ${t.description || ""}`);
        if (!words.every((w) => haystack.includes(w))) return false;
      }
      return true;
    });
    const sort = byTimeThenPriority(view);
    matches.sort((a, b) => {
      if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1;
      return String(a.due_date).localeCompare(String(b.due_date)) || sort(a, b);
    });

    const shown = matches.slice(0, limit);
    const byId = new Map(all.map((t) => [t.id, t]));
    const lines = shown.map((t) => {
      const parent = t.parent_id ? byId.get(t.parent_id) : null;
      return `- ${taskLine(t, view, { withDate: true })}${parent ? ` — subtask of "${parent.title}"` : ""}`;
    });
    const header = matches.length
      ? `${matches.length} matching task${matches.length === 1 ? "" : "s"}${matches.length > shown.length ? `, showing the first ${shown.length}` : ""}:`
      : "No tasks match.";
    return {
      text: [header, ...lines].join("\n"),
      data: { total: matches.length, tasks: shown.map((t) => taskData(t, view)) },
    };
  },
};

/** @type {Tool} */
const getTask = {
  name: "get_task",
  title: "Task details",
  description: "Everything about one task: description, subtasks, reminder, how it repeats, attached file names, and whether it can be changed.",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "string", maxLength: 200, description: "The task's id." } },
    required: ["task_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx, args) {
    const task = getOwnTask(ctx, args.task_id);
    const all = loadTasks(ctx);
    const view = viewContext(all, loadPriorities(ctx));
    const subtasks = all.filter((t) => t.parent_id === task.id);
    const parent = task.parent_id ? all.find((t) => t.id === task.parent_id) : null;
    const files = ctx.db
      .prepare(`SELECT filename FROM task_attachments WHERE app_id = ? AND task_id = ? AND user_id = ? ORDER BY created_date`)
      .all(ctx.appId, task.id, ctx.user.id)
      .map((/** @type {any} */ row) => row.filename);

    const data = { ...taskData(task, view, { full: true }), subtask_list: subtasks.map((s) => taskData(s, view)), files, ...(parent ? { parent_title: parent.title } : {}) };
    const lines = [
      taskLine(task, view, { withDate: true }),
      parent ? `Subtask of "${parent.title}" (id ${parent.id}).` : null,
      `Status: ${data.status}${task.completed_at ? `, completed ${task.completed_at.slice(0, 10)}` : ""}.`,
      `Reminder: ${describeReminder(task.reminder)}.`,
      describeRecurrence(task) ? `Repeats ${describeRecurrence(task)}.` : null,
      isFromCalendar(task) ? `From ${fromCalendar(task)}: read-only here; change it in the calendar itself.` : null,
      data.description ? `Description:\n${data.description}` : "No description.",
      subtasks.length ? `Subtasks:\n${subtasks.map((s) => `- ${s.status === "done" ? "[x]" : "[ ]"} ${s.title} (id ${s.id})`).join("\n")}` : null,
      files.length ? `Files: ${files.join(", ")}.` : null,
    ].filter(Boolean);
    return { text: lines.join("\n"), data };
  },
};

/** @type {Tool} */
const searchNotes = {
  name: "search_notes",
  title: "Search notes",
  description: "Find notes by words in the title or text, or by tag. Pinned notes first, then most recently edited.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 200, description: "Words to look for." },
      tag: { type: "string", maxLength: 100, description: "A tag, with or without #." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "At most this many, 1–50. Defaults to 20." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx, args) {
    const notes = listRecords(ctx, "Note");
    const words = args.text ? lower(args.text).split(/\s+/).filter(Boolean) : [];
    const matches = notes
      .filter((n) => (!args.tag || hasTag(n.tags, args.tag)) && words.every((w) => lower(`${n.title} ${n.content_text}`).includes(w)))
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updated_date).localeCompare(String(a.updated_date)));
    const shown = matches.slice(0, args.limit || 20);
    const data = shown.map((n) => ({
      id: n.id,
      title: n.title || "Untitled",
      tags: n.tags || [],
      pinned: Boolean(n.pinned),
      snippet: clip(n.content_text, 200),
      updated_date: n.updated_date,
    }));
    const lines = data.map((n) => `- ${n.pinned ? "(pinned) " : ""}${n.title}${n.tags.map((t) => ` #${t}`).join("")} — ${n.snippet || "empty"} (id ${n.id})`);
    const header = matches.length ? `${matches.length} matching note${matches.length === 1 ? "" : "s"}${matches.length > shown.length ? `, showing ${shown.length}` : ""}:` : "No notes match.";
    return { text: [header, ...lines].join("\n"), data: { total: matches.length, notes: data } };
  },
};

/** @type {Tool} */
const getNote = {
  name: "get_note",
  title: "Read a note",
  description: `The full text of one note (up to ${NOTE_MAX_CHARS.toLocaleString("en-US")} characters).`,
  inputSchema: {
    type: "object",
    properties: { note_id: { type: "string", maxLength: 200, description: "The note's id." } },
    required: ["note_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx, args) {
    /** @type {any} */
    const note = asToolError(() => getEntityRecord(ctx.db, { entityName: "Note", appId: ctx.appId, user: ctx.user, id: args.note_id }), `No note with id "${args.note_id}".`);
    const text = String(note.content_text || "");
    const cut = text.length > NOTE_MAX_CHARS;
    const body = cut ? `${text.slice(0, NOTE_MAX_CHARS)}\n\n(cut off at ${NOTE_MAX_CHARS.toLocaleString("en-US")} characters)` : text;
    return {
      text: `${note.title || "Untitled"}${(note.tags || []).map((/** @type {string} */ t) => ` #${t}`).join("")} (id ${note.id})\n\n${body || "(empty)"}`,
      data: { id: note.id, title: note.title || "Untitled", tags: note.tags || [], pinned: Boolean(note.pinned), text: body, truncated: cut, updated_date: note.updated_date },
    };
  },
};

/** @type {Tool} */
const listPrioritiesAndTags = {
  name: "list_priorities_and_tags",
  title: "Priorities and tags",
  description: "The person's priorities (most urgent first) and the tags they use, for filtering and for labelling tasks.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx) {
    const priorities = loadPriorities(ctx);
    const saved = listRecords(ctx, "SavedTag").map((t) => t.name);
    const used = loadTasks(ctx).flatMap((t) => t.tags || []);
    const tags = [...new Set([...saved, ...used].map((t) => String(t)))].sort((a, b) => a.localeCompare(b));
    return {
      text: `Priorities, most urgent first: ${priorities.map((p) => p.name).join(", ") || "none"}.\nTags: ${tags.map((t) => `#${t}`).join(" ") || "none"}.`,
      data: { priorities: priorities.map((p) => ({ id: p.id, name: p.name })), tags },
    };
  },
};

/** @type {Tool[]} */
export const READ_TOOLS = [getAgenda, searchTasks, getTask, searchNotes, getNote, listPrioritiesAndTags];
