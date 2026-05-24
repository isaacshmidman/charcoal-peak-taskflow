// @ts-check
/**
 * @file ONE-SHOT MIGRATION SCRIPT.
 * Run only when migrating a legacy Base44 dataset into Zephyrly. Not
 * invoked at server startup. Triggered manually via:
 *   npm run backend:import
 * Safe to delete once all Base44 data has been migrated. Until then it
 * stays here so users with old Base44 dumps can re-import as needed.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { backendConfig } from "./config.js";
import { createDatabase, ensureAppSettings, withTransaction } from "./db.js";
import { importEntityRecord, upsertImportedUser } from "./store.js";

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;

    const key = value.slice(2);
    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = nextValue;
    index += 1;
  }

  return args;
}

function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      if (currentRow.some((value) => value !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += character;
  }

  currentRow.push(currentField);
  if (currentRow.some((value) => value !== "")) {
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];
  const [headerRow, ...dataRows] = rows;
  return dataRows.map((row) =>
    headerRow.reduce((record, header, index) => {
      record[header] = row[index] ?? "";
      return record;
    }, /** @type {Record<string, string>} */ ({}))
  );
}

function parseJsonLike(value, fallback) {
  if (value == null || value === "") return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseBoolean(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

function normalizeSharedFields(record) {
  return {
    id: record.id || undefined,
    created_date: record.created_date || undefined,
    updated_date: record.updated_date || undefined,
    created_by_id: record.created_by_id || undefined,
    created_by: record.created_by || undefined,
    is_sample: parseBoolean(record.is_sample),
  };
}

function normalizeTaskRecord(record) {
  return {
    ...normalizeSharedFields(record),
    parent_id: record.parent_id || "",
    title: record.title || "",
    description: record.description || "",
    priority_id: record.priority_id || "",
    status: record.status || "todo",
    task_type: record.task_type || "one_time",
    recurrence: record.recurrence || "none",
    recurrence_days: parseJsonLike(record.recurrence_days, []),
    recurrence_end_date: record.recurrence_end_date || "",
    due_date: record.due_date || "",
    task_time: record.task_time || "",
    tags: parseJsonLike(record.tags, []),
    completed_at: record.completed_at || "",
    order: record.order === "" ? null : Number(record.order),
  };
}

function normalizeDeletedTaskRecord(record, config) {
  const deletedAt = record.deleted_at || new Date().toISOString();
  return {
    ...normalizeSharedFields(record),
    task_id: record.task_id || record.id || "",
    title: record.title || "",
    description: record.description || "",
    priority_id: record.priority_id || "",
    status: record.status || "todo",
    task_type: record.task_type || "one_time",
    recurrence: record.recurrence || "none",
    recurrence_days: parseJsonLike(record.recurrence_days, []),
    recurrence_end_date: record.recurrence_end_date || "",
    due_date: record.due_date || "",
    task_time: record.task_time || "",
    tags: parseJsonLike(record.tags, []),
    completed_at: record.completed_at || "",
    deleted_at: deletedAt,
    expires_at:
      record.expires_at ||
      new Date(new Date(deletedAt).getTime() + config.deletedTaskRetentionDays * 24 * 60 * 60 * 1000).toISOString(),
    was_completed: parseBoolean(record.was_completed),
    subtasks: parseJsonLike(record.subtasks, []),
  };
}

function normalizePriorityRecord(record) {
  return {
    ...normalizeSharedFields(record),
    name: record.name || "",
    color: record.color || "slate",
    order: record.order === "" ? 0 : Number(record.order),
  };
}

function normalizeSavedTagRecord(record) {
  return {
    ...normalizeSharedFields(record),
    name: record.name || "",
  };
}

function collectUsers(records) {
  const seen = new Map();
  for (const record of records) {
    if (!record.created_by) continue;
    const key = String(record.created_by).toLowerCase();
    if (seen.has(key)) continue;
    seen.set(key, {
      id: record.created_by_id || undefined,
      email: key,
      fullName: key.split("@")[0],
    });
  }
  return [...seen.values()];
}

function readCsvFile(filePath) {
  const absolutePath = resolve(filePath);
  const fileContents = readFileSync(absolutePath, "utf8");
  const rows = parseCsv(fileContents);
  console.log(`Imported ${rows.length} rows from ${basename(absolutePath)}`);
  return rows;
}

function usage() {
  console.log(`
Usage:
  node backend/import-base44-exports.js \\
    --tasks "/path/to/Task Export.csv" \\
    --deleted-tasks "/path/to/DeletedTask Export.csv" \\
    --priorities "/path/to/Priority Export.csv" \\
    --saved-tags "/path/to/Saved Tags Export.csv" \\
    [--replace]
  `);
}

const args = parseArgs(process.argv.slice(2));

if (!args.tasks && !args["deleted-tasks"] && !args.priorities && !args["saved-tags"]) {
  usage();
  process.exit(1);
}

const config = {
  ...backendConfig,
  appId: String(args["app-id"] || backendConfig.appId),
};

const db = createDatabase(config);
ensureAppSettings(db, config);

/** @type {ReturnType<typeof readCsvFile>} */
let taskRows = [];
/** @type {ReturnType<typeof readCsvFile>} */
let deletedTaskRows = [];
/** @type {ReturnType<typeof readCsvFile>} */
let priorityRows = [];
/** @type {ReturnType<typeof readCsvFile>} */
let savedTagRows = [];

if (typeof args.tasks === "string") taskRows = readCsvFile(args.tasks);
if (typeof args["deleted-tasks"] === "string") deletedTaskRows = readCsvFile(args["deleted-tasks"]);
if (typeof args.priorities === "string") priorityRows = readCsvFile(args.priorities);
if (typeof args["saved-tags"] === "string") savedTagRows = readCsvFile(args["saved-tags"]);

const importedUsers = collectUsers([...taskRows, ...deletedTaskRows, ...priorityRows, ...savedTagRows]);

withTransaction(db, () => {
  if (args.replace) {
    for (const table of ["sessions", "tasks", "deleted_tasks", "priorities", "saved_tags", "users"]) {
      db.prepare(`DELETE FROM ${table} WHERE app_id = ?`).run(config.appId);
    }
  }

  /** @type {Map<string, any>} */
  const usersByEmail = new Map();
  for (const importedUser of importedUsers) {
    const userRow = upsertImportedUser(db, {
      appId: config.appId,
      id: importedUser.id,
      email: importedUser.email,
      fullName: importedUser.fullName,
      provider: "import",
    });
    usersByEmail.set(String(importedUser.email).toLowerCase(), userRow);
  }

  const resolveUser = (record) =>
    usersByEmail.get(String(record.created_by || "").toLowerCase()) || {
      id: record.created_by_id || "",
      email: record.created_by || "",
    };

  for (const record of priorityRows) {
    importEntityRecord(db, {
      entityName: "Priority",
      appId: config.appId,
      user: resolveUser(record),
      input: normalizePriorityRecord(record),
      config,
    });
  }

  for (const record of savedTagRows) {
    importEntityRecord(db, {
      entityName: "SavedTag",
      appId: config.appId,
      user: resolveUser(record),
      input: normalizeSavedTagRecord(record),
      config,
    });
  }

  for (const record of taskRows) {
    importEntityRecord(db, {
      entityName: "Task",
      appId: config.appId,
      user: resolveUser(record),
      input: normalizeTaskRecord(record),
      config,
    });
  }

  for (const record of deletedTaskRows) {
    importEntityRecord(db, {
      entityName: "DeletedTask",
      appId: config.appId,
      user: resolveUser(record),
      input: normalizeDeletedTaskRecord(record, config),
      config,
    });
  }
});

console.log(`Base44 export import completed for app ${config.appId}.`);
