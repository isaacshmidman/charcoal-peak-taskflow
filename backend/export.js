// @ts-check
/**
 * @file "Export your data": everything a user has in Zephyrly, as a ZIP.
 *
 *   zephyrly-export-YYYY-MM-DD/
 *     README.txt      what's here
 *     data.json       every record, in the same shape the API returns —
 *                     complete, and the basis for any future import
 *     tasks.csv       tasks and subtasks for a spreadsheet
 *     notes/*.md      one file per note
 *     attachments/<task>/<file>   the files themselves
 *
 * Only the signed-in user's own data, and never a credential: calendar
 * connections are exported as which accounts and calendars, without
 * their OAuth tokens or app-specific passwords, and push subscriptions
 * (per-device keys) are left out entirely.
 */
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import { listEntityRecords } from "./store.js";
import { attachmentsRoot } from "./attachments.js";

export const EXPORT_FORMAT = "zephyrly-export";
export const EXPORT_VERSION = 1;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A string safe to use as one file or folder name on macOS, Windows and
 * Linux: no separators or reserved characters, no leading dots (so never
 * ".."), and not absurdly long.
 *
 * @param {unknown} value
 * @param {string} fallback
 */
export function safeFileName(value, fallback) {
  const cleaned = String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** Hands out names that are unique within one folder: "a", "a (2)", … */
function uniqueNamer() {
  const used = new Set();
  /** @param {string} base @param {string} [ext] */
  return (base, ext = "") => {
    let name = `${base}${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    return name;
  };
}

/** Split "photo.final.jpg" into ["photo.final", ".jpg"]. */
function splitExtension(filename) {
  const match = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/.exec(filename);
  return [match?.[1] || filename, match?.[2] || ""];
}

/**
 * One CSV cell. Quotes per RFC 4180, and defuses spreadsheet formulas:
 * descriptions include text other people wrote (calendar invites), and a
 * cell starting with = + - @ would run as a formula when opened in Excel.
 *
 * @param {unknown} value
 */
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {any} task */
function repeatsLabel(task) {
  if (task.task_type !== "recurring" || !task.recurrence || task.recurrence === "none") return "";
  if (task.recurrence === "custom_days" && Array.isArray(task.recurrence_days) && task.recurrence_days.length) {
    return task.recurrence_days.map((day) => DAY_LABELS[day] ?? day).join(", ");
  }
  return task.recurrence;
}

/**
 * @param {any[]} tasks
 * @param {Map<string, string>} priorityNames
 */
function tasksCsv(tasks, priorityNames) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const columns = [
    "Title", "Description", "Status", "Due date", "Time", "End time", "Priority",
    "Tags", "Repeats", "Subtask of", "Completed at", "Created", "Calendar", "ID", "Parent ID",
  ];
  const rows = tasks.map((task) => [
    task.title,
    task.description,
    task.status,
    task.due_date,
    task.task_time,
    task.task_end_time,
    priorityNames.get(task.priority_id) || "",
    (task.tags || []).join("; "),
    repeatsLabel(task),
    task.parent_id ? byId.get(task.parent_id)?.title || "" : "",
    task.completed_at,
    task.created_date,
    task.source_calendar_name || "",
    task.id,
    task.parent_id || "",
  ]);
  // BOM so Excel reads UTF-8; CRLF per RFC 4180.
  return "\ufeff" + [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Connected calendars, without a single credential: the token and
 * password columns are never selected.
 *
 * @param {any} db
 * @param {{ appId: string, userId: string }} scope
 */
function calendarConnections(db, { appId, userId }) {
  const integrations = db
    .prepare(
      `SELECT id, provider, external_account_email, status, is_default, last_synced_at, created_date
       FROM calendar_integrations WHERE app_id = ? AND user_id = ? ORDER BY created_date`
    )
    .all(appId, userId);
  const calendarsFor = db.prepare(
    `SELECT summary, item_kind, sync_enabled, access_role, color_hex, time_zone, primary_flag
     FROM integration_calendars WHERE app_id = ? AND integration_id = ? ORDER BY summary`
  );
  return integrations.map((row) => ({
    provider: row.provider,
    account_email: row.external_account_email,
    status: row.status,
    is_default: Boolean(row.is_default),
    last_synced_at: row.last_synced_at,
    connected_at: row.created_date,
    calendars: calendarsFor.all(appId, row.id).map((cal) => ({
      name: cal.summary,
      holds: cal.item_kind === "task" ? "tasks" : "events",
      synced: Boolean(cal.sync_enabled),
      primary: Boolean(cal.primary_flag),
      access_role: cal.access_role,
      color_hex: cal.color_hex,
      time_zone: cal.time_zone,
    })),
  }));
}

/** @param {unknown} raw */
function parsePreferences(raw) {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} folder
 * @param {{ exportedAt: string, counts: Record<string, number>, missingFiles: number }} info
 */
function readme(folder, { exportedAt, counts, missingFiles }) {
  const lines = [
    "Zephyrly export",
    "===============",
    "",
    `Exported ${exportedAt}.`,
    "",
    `data.json        Everything: ${counts.tasks} tasks and subtasks, ${counts.notes} notes, your`,
    "                 priorities and tags, Recently Deleted, notification settings and",
    "                 which calendars are connected. The complete copy.",
    "tasks.csv        Tasks and subtasks, for Excel, Numbers or Google Sheets.",
    `notes/           Each note as a Markdown file (${counts.notes}).`,
    `attachments/     Files attached to tasks, one folder per task (${counts.files}).`,
    "",
    "Events imported from Google or Apple Calendar are included in data.json and",
    "tasks.csv; they are marked with the calendar they came from.",
    "",
    "Never included: passwords, sign-in tokens, or the keys Zephyrly uses to reach",
    "your calendars. Reconnecting a calendar needs a fresh sign-in.",
  ];
  if (missingFiles) {
    lines.push(
      "",
      `${missingFiles} attachment file(s) could not be found on the server and are`,
      "listed in data.json with \"file\": null."
    );
  }
  lines.push("", `(This folder: ${folder})`, "");
  return lines.join("\r\n");
}

/**
 * Gather a user's data and describe the archive. Reads records now; the
 * attachment files themselves are read later, one at a time, as the ZIP
 * is written.
 *
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, user: any, now?: Date }} args
 * @returns {Promise<{ fileName: string, entries: import("./zip.js").ZipEntry[] }>}
 */
export async function buildExport(db, config, { appId, user, now = new Date() }) {
  /** @param {string} entityName @returns {any[]} */
  const list = (entityName) =>
    listEntityRecords(db, { entityName, appId, user, sort: "created_date", limit: undefined, fields: undefined, query: null });
  const tasks = list("Task");
  const notes = list("Note");
  const priorities = list("Priority");
  const savedTags = list("SavedTag");
  const deletedTasks = list("DeletedTask");
  const deletedNotes = list("DeletedNote");

  const stamp = now.toISOString().slice(0, 10);
  const folder = `zephyrly-export-${stamp}`;
  const exportedAt = now.toISOString();

  // Attachments: one folder per task, named after it.
  const root = attachmentsRoot(config);
  const attachmentRows = db
    .prepare(
      `SELECT id, task_id, filename, mime_type, size_bytes, storage_path, created_date
       FROM task_attachments WHERE app_id = ? AND user_id = ? ORDER BY created_date`
    )
    .all(appId, user.id);
  // Live titles win over a trashed copy's.
  /** @type {Map<string, string>} */
  const titleOfTask = new Map();
  for (const t of deletedTasks) titleOfTask.set(t.task_id, t.title);
  for (const t of tasks) titleOfTask.set(t.id, t.title);
  const folderNamer = uniqueNamer();
  /** @type {Map<string, { dir: string, name: (base: string, ext?: string) => string }>} */
  const taskFolders = new Map();
  /** @type {import("./zip.js").ZipEntry[]} */
  const fileEntries = [];
  const attachments = [];
  let missingFiles = 0;

  for (const row of attachmentRows) {
    let folderInfo = taskFolders.get(row.task_id);
    if (!folderInfo) {
      folderInfo = {
        dir: folderNamer(safeFileName(titleOfTask.get(row.task_id), "Untitled task")),
        name: uniqueNamer(),
      };
      taskFolders.set(row.task_id, folderInfo);
    }
    const absolutePath = resolve(root, String(row.storage_path));
    let size = -1;
    if (absolutePath.startsWith(root)) {
      try {
        const stat = await fsp.stat(absolutePath);
        if (stat.isFile()) size = stat.size;
      } catch {
        // Missing on disk: recorded below with file: null.
      }
    }
    let file = null;
    if (size >= 0) {
      const [base, ext] = splitExtension(String(row.filename || ""));
      file = `attachments/${folderInfo.dir}/${folderInfo.name(safeFileName(base, "file"), ext.toLowerCase())}`;
      const path = absolutePath;
      fileEntries.push({
        name: `${folder}/${file}`,
        size,
        read: () => fsp.readFile(path),
        date: new Date(row.created_date || now),
      });
    } else {
      missingFiles += 1;
    }
    attachments.push({
      id: row.id,
      task_id: row.task_id,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_date: row.created_date,
      file,
    });
  }

  const account = db
    .prepare(`SELECT email, full_name, created_date, preferences_json FROM users WHERE app_id = ? AND id = ?`)
    .get(appId, user.id);
  const preferences = parsePreferences(account?.preferences_json);

  const data = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: exportedAt,
    account: {
      email: account?.email ?? user.email,
      full_name: account?.full_name ?? user.full_name ?? "",
      member_since: account?.created_date ?? null,
    },
    notification_settings: preferences.notificationSettings ?? null,
    tasks,
    notes,
    priorities,
    saved_tags: savedTags,
    recently_deleted: { tasks: deletedTasks, notes: deletedNotes },
    attachments,
    calendar_connections: calendarConnections(db, { appId, userId: user.id }),
  };

  const noteNamer = uniqueNamer();
  const noteEntries = notes.map((note) => {
    const title = String(note.title || "").trim();
    const body = String(note.content_text || "").trim();
    return {
      name: `${folder}/notes/${noteNamer(safeFileName(title, "Untitled note"), ".md")}`,
      data: `${title ? `# ${title}\n\n` : ""}${body}\n`,
      date: new Date(note.updated_date || note.created_date || now),
    };
  });

  const priorityNames = new Map(priorities.map((p) => [p.id, p.name]));
  return {
    fileName: `${folder}.zip`,
    entries: [
      {
        name: `${folder}/README.txt`,
        data: readme(folder, {
          exportedAt,
          counts: { tasks: tasks.length, notes: notes.length, files: fileEntries.length },
          missingFiles,
        }),
      },
      { name: `${folder}/data.json`, data: JSON.stringify(data, null, 2) },
      { name: `${folder}/tasks.csv`, data: tasksCsv(tasks, priorityNames) },
      ...noteEntries,
      ...fileEntries,
    ],
  };
}
