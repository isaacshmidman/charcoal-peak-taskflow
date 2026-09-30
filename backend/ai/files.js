// @ts-check
/**
 * @file Tools for the files attached to tasks: find them, read the text
 * ones, and attach a text file an AI app wrote.
 *
 * Deliberately not here: deleting a file. That is permanent, and AI apps
 * never delete anything for good (a file goes to Recently Deleted only
 * with its task, via delete_task). Nor fetching a file from a URL, which
 * would let an AI app make the server call arbitrary addresses.
 */
import { readFileSync } from "node:fs";
import { HttpError } from "../http.js";
import { createAttachment, getAttachment, listAttachmentsForTask, searchAttachments } from "../attachments.js";
import { ToolError } from "./args.js";
import { logActivity } from "./activity.js";
import { getOwnTask, loadTasks } from "./context.js";
import { assertEditable, spendWrite } from "./writes.js";

/**
 * @typedef {import("./context.js").Tool} Tool
 */

const READ_MAX_CHARS = 20_000;
const READ_MAX_BYTES = 400_000;
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "log", "yaml", "yml", "ics"]);
// What an AI app may attach: plain, readable text only.
const WRITE_TYPES = /** @type {Record<string, string>} */ ({ txt: "text/plain", md: "text/markdown", csv: "text/csv" });
const MAX_WRITE_BYTES = 1_000_000;

/** @param {string} name */
const extensionOf = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] || "").toLowerCase();

/**
 * Text Zephyrly can hand an AI app as-is. Never HTML or SVG, which are
 * only ever downloaded (see attachments.js).
 * @param {{ filename: string, mime_type: string }} file
 */
function isReadableText(file) {
  const mime = String(file.mime_type || "").toLowerCase();
  if (/html|svg|xml/.test(mime)) return false;
  return mime.startsWith("text/") || mime === "application/json" || TEXT_EXTENSIONS.has(extensionOf(file.filename));
}

/** @param {number} bytes */
function size(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * @param {any} file
 * @param {Map<string, any>} tasksById
 */
function fileData(file, tasksById) {
  const task = tasksById.get(file.task_id);
  return {
    id: file.id,
    name: file.filename,
    type: file.mime_type,
    size_bytes: file.size_bytes,
    task_id: file.task_id,
    task_title: task?.title ?? file.task_title ?? null,
    readable: isReadableText(file),
  };
}

/** @type {Tool} */
const listFiles = {
  name: "list_files",
  title: "Find files",
  description:
    "The files attached to one task (task_id), or files anywhere found by words in their name (text), newest first. " +
    "Says which ones read_file can read (text files).",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", maxLength: 200, description: "A task whose files to list." },
      text: { type: "string", maxLength: 200, description: "Words in the file name, to search every task's files." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "At most this many, 1–50. Defaults to 20." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx, args) {
    const tasksById = new Map(loadTasks(ctx).map((t) => [t.id, t]));
    let files;
    if (args.task_id) {
      getOwnTask(ctx, args.task_id);
      files = listAttachmentsForTask(ctx.db, { appId: ctx.appId, user: ctx.user, taskId: args.task_id });
    } else {
      files = searchAttachments(ctx.db, { appId: ctx.appId, user: ctx.user, q: args.text || "", limit: args.limit || 20 });
    }
    const shown = files.slice(0, args.limit || 20).map((f) => fileData(f, tasksById));
    const lines = shown.map(
      (f) => `- ${f.name} (${size(f.size_bytes)}${f.readable ? ", readable" : ""}) on "${f.task_title || "a task"}" (file id ${f.id})`
    );
    const header = shown.length ? `${shown.length} file${shown.length === 1 ? "" : "s"}:` : "No files found.";
    return { text: [header, ...lines].join("\n"), data: { files: shown } };
  },
};

/** @type {Tool} */
const readFile = {
  name: "read_file",
  title: "Read a file",
  description: `The contents of a text file attached to a task (txt, md, csv, json and the like), up to ${READ_MAX_CHARS.toLocaleString("en-US")} characters. PDFs, images and other files can't be read here.`,
  inputSchema: {
    type: "object",
    properties: { file_id: { type: "string", maxLength: 200, description: "The file's id, from list_files or get_task." } },
    required: ["file_id"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  write: false,
  handler(ctx, args) {
    /** @type {{ row: any, absolutePath: string }} */
    let found;
    try {
      found = getAttachment(ctx.db, ctx.config, { appId: ctx.appId, user: ctx.user, id: args.file_id });
    } catch (error) {
      // Someone else's file and no file at all look the same.
      if (error instanceof HttpError && (error.status === 403 || error.status === 404)) throw new ToolError(`No file with id "${args.file_id}".`);
      throw error;
    }
    const held = ctx.db.prepare(`SELECT task_deleted_at FROM task_attachments WHERE id = ?`).get(args.file_id);
    if (held?.task_deleted_at) throw new ToolError("That file's task is in Recently Deleted.");
    const file = found.row;
    if (!isReadableText(file)) {
      throw new ToolError(`${file.filename} is a ${file.mime_type || "binary"} file; only text files can be read here.`);
    }
    let bytes;
    try {
      bytes = readFileSync(found.absolutePath);
    } catch {
      throw new ToolError(`${file.filename} is missing from storage.`);
    }
    const text = bytes.subarray(0, READ_MAX_BYTES).toString("utf8");
    const cut = text.length > READ_MAX_CHARS || bytes.length > READ_MAX_BYTES;
    const body = text.slice(0, READ_MAX_CHARS);
    return {
      text: `${file.filename} (file id ${file.id})\n\n${body}${cut ? `\n\n(cut off at ${READ_MAX_CHARS.toLocaleString("en-US")} characters)` : ""}`,
      data: { id: file.id, name: file.filename, text: body, truncated: cut },
    };
  },
};

/** @type {Tool} */
const attachTextFile = {
  name: "attach_text_file",
  title: "Attach a text file",
  description:
    "Save text as a file attached to a task: .txt, .md or .csv (a name without one gets .txt), up to 1 MB. " +
    "The task's usual limits apply (10 files, the person's storage). Can't attach to items from connected calendars.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", maxLength: 200, description: "The task to attach it to." },
      filename: { type: "string", maxLength: 120, description: 'e.g. "packing-list.md".' },
      text: { type: "string", maxLength: MAX_WRITE_BYTES, description: "The file's contents." },
    },
    required: ["task_id", "filename", "text"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  write: true,
  async handler(ctx, args) {
    const task = getOwnTask(ctx, args.task_id);
    assertEditable(ctx, task);
    let filename = args.filename.replace(/[/\\\p{Cc}]/gu, " ").trim();
    let ext = extensionOf(filename);
    if (!WRITE_TYPES[ext]) {
      filename = `${filename}.txt`;
      ext = "txt";
    }
    const data = Buffer.from(args.text, "utf8");
    if (data.length > MAX_WRITE_BYTES) throw new ToolError("A file from an AI app can be at most 1 MB.");
    spendWrite(ctx);
    let created;
    try {
      created = await createAttachment(ctx.db, ctx.config, {
        appId: ctx.appId,
        user: ctx.user,
        taskId: task.id,
        file: { filename, mimeType: WRITE_TYPES[ext], data },
      });
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) throw new ToolError(error.message);
      throw error;
    }
    const summary = `Attached ${filename} to “${task.title}”.`;
    logActivity(ctx, "attach_text_file", summary, { kind: "attach_file", file_id: created.id });
    return { text: `${summary} (file id ${created.id})`, data: { id: created.id, name: filename, task_id: task.id } };
  },
};

/** @type {Tool[]} */
export const FILE_READ_TOOLS = [listFiles, readFile];
/** @type {Tool[]} */
export const FILE_WRITE_TOOLS = [attachTextFile];
