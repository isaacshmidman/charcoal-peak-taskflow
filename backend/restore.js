// @ts-check
/**
 * @file "Restore from an export": put back whatever's missing from a
 * Zephyrly export (export.js) — the .zip as downloaded, the same folder
 * re-zipped, or just its data.json.
 *
 * Only ever adds. Anything already in the account is left exactly as it
 * is, so restoring the same export twice adds nothing the second time.
 *
 * The file is untrusted input, whoever uploads it:
 * - every record is owned by the signed-in user — owner fields in the
 *   file are never read;
 * - only the entity's own fields are copied, each checked like a record
 *   sent from the browser (validateClientInput);
 * - an id that's already used (by anyone) gets a fresh one, with
 *   subtasks, notes' task links and files following it;
 * - files go through the normal upload path (createAttachment): blocked
 *   types, the per-file and per-task caps, and the storage quota all
 *   apply.
 *
 * Not restored: events and tasks from connected calendars (calendar sync
 * brings those back; restoring them would duplicate them), notification
 * settings and calendar connections (those stay as they are now).
 */
import { promises as fsp } from "node:fs";
import { HttpError } from "./http.js";
import { withTransaction } from "./db.js";
import { createEntityRecord, entityFieldNames, validateClientInput } from "./store.js";
import { createAttachment, MAX_FILE_BYTES } from "./attachments.js";
import { EXPORT_FORMAT, EXPORT_VERSION } from "./export.js";
import { openZip, ZipError } from "./unzip.js";

export const MAX_RESTORE_UPLOAD_BYTES = 1_200_000_000;
const MAX_DATA_JSON_BYTES = 100 * 1_000_000;
const MAX_RECORDS = 100_000;
// Ids are copied over when they're free; anything odd gets a fresh one.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Open an uploaded export: a ZIP (the export as downloaded, or its folder
 * re-zipped) or a bare data.json.
 *
 * @param {string} path
 * @returns {Promise<{ data: any, readFile: ((file: string) => Promise<Buffer | null>) | null, close: () => Promise<void> }>}
 */
export async function openExport(path) {
  const handle = await fsp.open(path, "r");
  let head;
  let size;
  try {
    size = (await handle.stat()).size;
    head = Buffer.alloc(Math.min(4, size));
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }

  const isZip = head.length === 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5);
  if (!isZip) {
    if (size > MAX_DATA_JSON_BYTES) throw new HttpError(413, "That file is too large to be an export's data.json.", "restore_too_large");
    return { data: parseData(await fsp.readFile(path)), readFile: null, close: async () => {} };
  }

  let zip;
  try {
    zip = await openZip(path);
  } catch (error) {
    if (error instanceof ZipError) throw new HttpError(400, error.message, "restore_bad_zip");
    throw error;
  }
  try {
    // data.json marks the export's folder, wherever the archive put it.
    const dataEntry = zip.entries
      .filter((entry) => entry.name === "data.json" || entry.name.endsWith("/data.json"))
      .sort((a, b) => a.name.split("/").length - b.name.split("/").length)[0];
    if (!dataEntry) throw new HttpError(400, "This ZIP isn't a Zephyrly export — it has no data.json.", "restore_not_export");
    const prefix = dataEntry.name.slice(0, -"data.json".length);
    let raw;
    try {
      raw = await zip.read(dataEntry, MAX_DATA_JSON_BYTES);
    } catch (error) {
      if (error instanceof ZipError) throw new HttpError(400, error.message, "restore_bad_zip");
      throw error;
    }
    const byName = new Map(zip.entries.map((entry) => [entry.name, entry]));
    return {
      data: parseData(raw),
      async readFile(file) {
        const entry = byName.get(`${prefix}${file}`);
        return entry ? zip.read(entry, MAX_FILE_BYTES) : null;
      },
      close: () => zip.close(),
    };
  } catch (error) {
    await zip.close();
    throw error;
  }
}

/** @param {Buffer} raw */
function parseData(raw) {
  let data;
  try {
    data = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new HttpError(400, "That file isn't a Zephyrly export.", "restore_not_export");
  }
  if (!data || typeof data !== "object" || data.format !== EXPORT_FORMAT) {
    throw new HttpError(400, "That file isn't a Zephyrly export.", "restore_not_export");
  }
  if (!(Number(data.version) >= 1 && Number(data.version) <= EXPORT_VERSION)) {
    throw new HttpError(400, "This export is from a newer version of Zephyrly. Update, then try again.", "restore_newer_version");
  }
  return data;
}

/** @param {unknown} value @returns {any[]} */
const list = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : []);

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Point task links inside a rich-text document at the tasks' ids in this
 * account (a restored task can get a fresh id).
 *
 * @param {unknown} json
 * @param {Map<string, string>} taskIds  export id → id here
 */
export function remapTaskLinks(json, taskIds) {
  if (typeof json !== "string" || !json.includes("taskLink")) return json;
  let doc;
  try {
    doc = JSON.parse(json);
  } catch {
    return json;
  }
  let changed = false;
  /** @param {any} node */
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const mark of Array.isArray(node.marks) ? node.marks : []) {
      const id = mark?.type === "taskLink" ? mark.attrs?.taskId : undefined;
      const mapped = typeof id === "string" ? taskIds.get(id) : undefined;
      if (mapped && mapped !== id) {
        mark.attrs.taskId = mapped;
        changed = true;
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(doc);
  return changed ? JSON.stringify(doc) : json;
}

/** @param {any} error */
function fileSkipReason(error) {
  switch (error?.code) {
    case "quota_exceeded": return "they'd go over your storage space";
    case "too_many_attachments": return "their task already has the most files it can hold";
    case "blocked_extension": return "that type of file isn't allowed";
    case "file_too_large": return "they're over the 25 MB limit";
    default: return error instanceof ZipError ? "they're damaged in the archive" : "they couldn't be read";
  }
}

/**
 * Add back everything from `data` that this account is missing.
 *
 * @param {any} db
 * @param {any} config
 * @param {{
 *   appId: string,
 *   user: { id: string, email: string },
 *   data: any,
 *   readFile: ((file: string) => Promise<Buffer | null>) | null,
 *   now?: Date,
 * }} args
 */
export async function restoreExport(db, config, { appId, user, data, readFile, now = new Date() }) {
  const deleted = data.recently_deleted && typeof data.recently_deleted === "object" ? data.recently_deleted : {};
  const input = {
    priorities: list(data.priorities),
    tags: list(data.saved_tags),
    tasks: list(data.tasks),
    notes: list(data.notes),
    deletedTasks: list(deleted.tasks),
    deletedNotes: list(deleted.notes),
    attachments: list(data.attachments),
  };
  const total = Object.values(input).reduce((sum, items) => sum + items.length, 0);
  if (total > MAX_RECORDS) {
    throw new HttpError(413, `That export has more than ${MAX_RECORDS.toLocaleString("en-US")} records.`, "restore_too_large");
  }

  const nowIso = now.toISOString();
  const added = { tasks: 0, notes: 0, priorities: 0, tags: 0, recentlyDeleted: 0, files: 0 };
  const skipped = { alreadyHere: 0, fromCalendars: 0, inRecentlyDeleted: 0, orphanSubtasks: 0, invalid: 0 };

  // ── Queries, scoped to this user ────────────────────────────────────
  const OWNED = "((created_by_id = ? AND created_by_id != '') OR LOWER(created_by) = ?)";
  const scope = [user.id, String(user.email || "").toLowerCase()];
  /** @param {string} table @param {string} [column] */
  const ownedValues = (table, column = "id") =>
    new Set(
      db.prepare(`SELECT ${column} AS v FROM ${table} WHERE app_id = ? AND ${OWNED}`).all(appId, ...scope).map((row) => row.v)
    );
  /** @param {string} table @param {string} column */
  const pendingInTrash = (table, column) =>
    new Set(
      db
        .prepare(`SELECT ${column} AS v FROM ${table} WHERE app_id = ? AND expires_at > ? AND ${OWNED}`)
        .all(appId, nowIso, ...scope)
        .map((row) => row.v)
    );
  // Export ids that had to take a fresh id in an earlier restore.
  const earlier = new Map(
    db
      .prepare(`SELECT entity, source_id, local_id FROM restored_ids WHERE app_id = ? AND user_id = ?`)
      .all(appId, user.id)
      .map((row) => [`${row.entity}:${row.source_id}`, String(row.local_id)])
  );
  /** Where an exported record lives in this account, if it came across before. */
  const localId = (/** @type {string} */ entityName, /** @type {string} */ id) => (id && earlier.get(`${entityName}:${id}`)) || id;
  const rememberId = db.prepare(
    `INSERT OR REPLACE INTO restored_ids (app_id, user_id, entity, source_id, local_id) VALUES (?, ?, ?, ?, ?)`
  );

  /** @param {string} table @param {unknown} id */
  const freeId = (table, id) =>
    typeof id === "string" && SAFE_ID.test(id) && !db.prepare(`SELECT 1 FROM ${table} WHERE app_id = ? AND id = ?`).get(appId, id)
      ? id
      : undefined;

  /**
   * Copy the entity's own fields, check them like browser input, and
   * insert — owned by this user whatever the file says.
   *
   * @param {string} entityName
   * @param {string} table
   * @param {any} record
   * @param {Record<string, unknown>} overrides
   */
  const insert = (entityName, table, record, overrides) => {
    /** @type {Record<string, unknown>} */
    const fields = {};
    for (const field of entityFieldNames(entityName)) {
      if (Object.hasOwn(record, field)) fields[field] = record[field];
    }
    Object.assign(fields, overrides);
    try {
      validateClientInput(entityName, fields);
      return createEntityRecord(db, {
        entityName,
        appId,
        user,
        config,
        // allowSystemFields keeps the id and dates below; the owner is
        // set here, from the signed-in user, never from the file.
        allowSystemFields: true,
        input: {
          ...fields,
          id: freeId(table, record.id),
          created_date: validDate(record.created_date) || nowIso,
          updated_date: validDate(record.updated_date) || nowIso,
          created_by_id: user.id,
          created_by: user.email,
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        skipped.invalid += 1;
        return null;
      }
      throw error;
    }
  };
  /**
   * insert(), then note the new id if it isn't the exported one.
   *
   * @param {string} entityName
   * @param {string} table
   * @param {any} record
   * @param {Record<string, unknown>} overrides
   */
  const restoreRecord = (entityName, table, record, overrides) => {
    const created = insert(entityName, table, record, overrides);
    const sourceId = typeof record.id === "string" ? record.id : "";
    if (created && sourceId && created.id !== sourceId) {
      rememberId.run(appId, user.id, entityName, sourceId, String(created.id));
    }
    return created;
  };

  /** export id → id in this account, for everything restored or already here */
  /** @type {Map<string, string>} */
  const priorityIds = new Map();
  /** @type {Map<string, string>} */
  const taskIds = new Map();

  withTransaction(db, () => {
    // Priorities and tags are matched by name.
    const prioritiesByName = new Map(
      db
        .prepare(`SELECT id, name FROM priorities WHERE app_id = ? AND ${OWNED}`)
        .all(appId, ...scope)
        .map((row) => [String(row.name).trim().toLowerCase(), row.id])
    );
    for (const priority of input.priorities) {
      const name = typeof priority.name === "string" ? priority.name.trim() : "";
      if (!name) {
        skipped.invalid += 1;
        continue;
      }
      let id = prioritiesByName.get(name.toLowerCase());
      if (id) {
        skipped.alreadyHere += 1;
      } else {
        const created = insert("Priority", "priorities", priority, { name });
        if (!created) continue;
        id = String(created.id);
        prioritiesByName.set(name.toLowerCase(), id);
        added.priorities += 1;
      }
      if (typeof priority.id === "string") priorityIds.set(priority.id, id);
    }
    /** @param {unknown} id */
    const priorityFor = (id) => (typeof id === "string" && priorityIds.get(id)) || "";

    const tagNames = new Set(
      db.prepare(`SELECT name FROM saved_tags WHERE app_id = ? AND ${OWNED}`).all(appId, ...scope).map((row) => String(row.name).trim().toLowerCase())
    );
    for (const tag of input.tags) {
      const name = typeof tag.name === "string" ? tag.name.trim() : "";
      if (!name) {
        skipped.invalid += 1;
      } else if (tagNames.has(name.toLowerCase())) {
        skipped.alreadyHere += 1;
      } else if (insert("SavedTag", "saved_tags", tag, { name })) {
        tagNames.add(name.toLowerCase());
        added.tags += 1;
      }
    }

    // Tasks: parents before subtasks, so a subtask can point at its
    // parent's id here.
    const liveTasks = ownedValues("tasks");
    const trashedTasks = pendingInTrash("deleted_tasks", "task_id");
    const ordered = [...input.tasks.filter((t) => !t.parent_id), ...input.tasks.filter((t) => t.parent_id)];
    for (const task of ordered) {
      const id = typeof task.id === "string" ? task.id : "";
      const here = localId("Task", id);
      if (here && liveTasks.has(here)) {
        taskIds.set(id, here);
        if (task.source_provider) skipped.fromCalendars += 1;
        else skipped.alreadyHere += 1;
        continue;
      }
      if (task.source_provider) {
        skipped.fromCalendars += 1;
        continue;
      }
      if (here && trashedTasks.has(here)) {
        skipped.inRecentlyDeleted += 1;
        continue;
      }
      let parentId = "";
      if (task.parent_id) {
        parentId = taskIds.get(String(task.parent_id)) || "";
        if (!parentId) {
          skipped.orphanSubtasks += 1;
          continue;
        }
      }
      const created = restoreRecord("Task", "tasks", task, {
        parent_id: parentId,
        priority_id: priorityFor(task.priority_id),
        source_provider: "",
      });
      if (!created) continue;
      if (id) taskIds.set(id, String(created.id));
      added.tasks += 1;
    }

    // Notes, with task links following any task that got a new id.
    const liveNotes = ownedValues("notes");
    const trashedNotes = pendingInTrash("deleted_notes", "note_id");
    for (const note of input.notes) {
      const here = localId("Note", typeof note.id === "string" ? note.id : "");
      if (here && liveNotes.has(here)) {
        skipped.alreadyHere += 1;
      } else if (here && trashedNotes.has(here)) {
        skipped.inRecentlyDeleted += 1;
      } else if (
        restoreRecord("Note", "notes", note, {
          priority_id: priorityFor(note.priority_id),
          content_json: remapTaskLinks(note.content_json, taskIds),
        })
      ) {
        added.notes += 1;
      }
    }

    // Recently Deleted, while it would still be there.
    const liveDeletedTasks = ownedValues("deleted_tasks");
    const liveDeletedNotes = ownedValues("deleted_notes");
    /** @param {any} record */
    const stillPending = (record) => {
      const expires = validDate(record.expires_at);
      return Boolean(expires && expires > nowIso);
    };
    for (const record of input.deletedTasks) {
      if (!stillPending(record)) continue;
      if (liveDeletedTasks.has(localId("DeletedTask", typeof record.id === "string" ? record.id : ""))) {
        skipped.alreadyHere += 1;
      } else if (restoreRecord("DeletedTask", "deleted_tasks", record, { priority_id: priorityFor(record.priority_id) })) {
        added.recentlyDeleted += 1;
      }
    }
    for (const record of input.deletedNotes) {
      if (!stillPending(record)) continue;
      if (liveDeletedNotes.has(localId("DeletedNote", typeof record.id === "string" ? record.id : ""))) {
        skipped.alreadyHere += 1;
      } else if (
        restoreRecord("DeletedNote", "deleted_notes", record, {
          priority_id: priorityFor(record.priority_id),
          content_json: remapTaskLinks(record.content_json, taskIds),
        })
      ) {
        added.recentlyDeleted += 1;
      }
    }
  });

  // ── Files ───────────────────────────────────────────────────────────
  // After the records (an upload can't run inside the transaction), one
  // at a time. A file already on its task — same name and size — is left.
  /** @type {Map<string, number>} */
  const fileSkips = new Map();
  const skipFile = (/** @type {string} */ reason) => fileSkips.set(reason, (fileSkips.get(reason) || 0) + 1);
  let filesNotInUpload = 0;
  let filesAlreadyHere = 0;
  const alreadyAttached = db.prepare(
    `SELECT 1 FROM task_attachments WHERE app_id = ? AND user_id = ? AND task_id = ? AND filename = ? AND size_bytes = ?`
  );
  for (const attachment of input.attachments) {
    if (typeof attachment.file !== "string" || !attachment.file) continue; // missing when exported
    const taskId = taskIds.get(String(attachment.task_id));
    if (!taskId) {
      skipFile("their task isn't here");
      continue;
    }
    const filename = typeof attachment.filename === "string" && attachment.filename.trim() ? attachment.filename.trim().slice(0, 255) : "file";
    if (alreadyAttached.get(appId, user.id, taskId, filename, Number(attachment.size_bytes) || 0)) {
      filesAlreadyHere += 1;
      continue;
    }
    if (!readFile) {
      filesNotInUpload += 1;
      continue;
    }
    try {
      const bytes = await readFile(attachment.file);
      if (!bytes) {
        skipFile("they're missing from the archive");
        continue;
      }
      await createAttachment(db, config, {
        appId,
        user,
        taskId,
        file: { filename, mimeType: safeMimeType(attachment.mime_type), data: bytes },
      });
      added.files += 1;
    } catch (error) {
      if (!(error instanceof HttpError) && !(error instanceof ZipError)) throw error;
      skipFile(fileSkipReason(error));
    }
  }

  // ── What to tell the person ─────────────────────────────────────────
  /** @type {string[]} */
  const notes = [];
  const alreadyHere = skipped.alreadyHere + filesAlreadyHere;
  if (alreadyHere) notes.push(`${plural(alreadyHere, "thing was", "things were")} already here and left as they are.`);
  if (skipped.fromCalendars) {
    notes.push(`${plural(skipped.fromCalendars, "item")} from connected calendars skipped — they come back when your calendars sync.`);
  }
  if (skipped.inRecentlyDeleted) {
    notes.push(`${plural(skipped.inRecentlyDeleted, "item is", "items are")} in Recently Deleted, so left there — restore from Recently Deleted if you want them back.`);
  }
  if (skipped.orphanSubtasks) notes.push(`${plural(skipped.orphanSubtasks, "subtask")} skipped because its task isn't here.`);
  if (skipped.invalid) notes.push(`${plural(skipped.invalid, "record")} couldn't be read and ${skipped.invalid === 1 ? "was" : "were"} skipped.`);
  if (filesNotInUpload) {
    notes.push(`${plural(filesNotInUpload, "file")} not restored — only data.json was uploaded. Upload the whole .zip to bring files back.`);
  }
  for (const [reason, count] of fileSkips) notes.push(`${plural(count, "file")} not restored: ${reason}.`);
  notes.push("Notification settings and calendar connections aren't part of a restore — yours are unchanged.");

  return { added, notes };
}

/** @param {unknown} value */
function validDate(value) {
  if (typeof value !== "string" || !value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/** A plain type/subtype, or the generic binary type. @param {unknown} value */
function safeMimeType(value) {
  const mime = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/.test(mime) ? mime : "application/octet-stream";
}
