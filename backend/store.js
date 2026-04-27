// @ts-check
import { randomUUID } from "node:crypto";
import { HttpError } from "./http.js";
import { getDeletedTaskRetentionMs } from "./config.js";

const ENTITY_DEFINITIONS = {
  Task: {
    table: "tasks",
    idPrefix: "task",
    jsonColumns: ["recurrence_days", "tags"],
    booleanColumns: ["is_sample", "source_writable"],
    fieldMap: { order: "sort_order", recurrence_days: "recurrence_days_json", tags: "tags_json" },
    defaults: {
      description: "",
      priority_id: "",
      status: "todo",
      task_type: "one_time",
      recurrence: "none",
      recurrence_days: [],
      recurrence_end_date: "",
      due_date: "",
      task_time: "",
      task_end_time: "",
      tags: [],
      completed_at: "",
      order: null,
      is_sample: false,
      source_provider: "",
      source_kind: "",
      source_calendar_id: "",
      source_calendar_name: "",
      source_color_hex: "",
      source_writable: true,
      source_recurrence_rule: "",
    },
    mutableFields: [
      "parent_id",
      "title",
      "description",
      "priority_id",
      "status",
      "task_type",
      "recurrence",
      "recurrence_days",
      "recurrence_end_date",
      "due_date",
      "task_time",
      "task_end_time",
      "tags",
      "completed_at",
      "order",
      "is_sample",
      "source_provider",
      "source_kind",
      "source_calendar_id",
      "source_calendar_name",
      "source_color_hex",
      "source_writable",
      "source_recurrence_rule",
    ],
  },
  DeletedTask: {
    table: "deleted_tasks",
    idPrefix: "deleted",
    jsonColumns: ["recurrence_days", "tags", "subtasks"],
    booleanColumns: ["is_sample", "was_completed", "is_completion_record"],
    fieldMap: {
      recurrence_days: "recurrence_days_json",
      tags: "tags_json",
      subtasks: "subtasks_json",
    },
    defaults: {
      description: "",
      priority_id: "",
      priority_color: "",
      status: "todo",
      task_type: "one_time",
      recurrence: "none",
      recurrence_days: [],
      recurrence_end_date: "",
      due_date: "",
      task_time: "",
      task_end_time: "",
      tags: [],
      completed_at: "",
      was_completed: false,
      is_completion_record: false,
      subtasks: [],
      is_sample: false,
    },
    mutableFields: [
      "task_id",
      "title",
      "description",
      "priority_id",
      "priority_color",
      "status",
      "task_type",
      "recurrence",
      "recurrence_days",
      "recurrence_end_date",
      "due_date",
      "task_time",
      "task_end_time",
      "tags",
      "completed_at",
      "deleted_at",
      "expires_at",
      "was_completed",
      "is_completion_record",
      "subtasks",
      "is_sample",
    ],
  },
  Priority: {
    table: "priorities",
    idPrefix: "priority",
    jsonColumns: [],
    booleanColumns: ["is_sample"],
    fieldMap: { order: "sort_order" },
    defaults: {
      color: "slate",
      order: 0,
      is_sample: false,
    },
    mutableFields: ["name", "color", "order", "is_sample"],
  },
  SavedTag: {
    table: "saved_tags",
    idPrefix: "tag",
    jsonColumns: [],
    booleanColumns: ["is_sample"],
    fieldMap: {},
    defaults: {
      is_sample: false,
    },
    mutableFields: ["name", "is_sample"],
  },
};

const DEFAULT_PRIORITIES = [
  { name: "Urgent", color: "red", order: 0 },
  { name: "High", color: "orange", order: 1 },
  { name: "Normal", color: "blue", order: 2 },
  { name: "Low", color: "green", order: 3 },
];

function toIsoString(value, fallback = "") {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function parseJsonColumn(value, fallback) {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value) || typeof value === "object") return value;

  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizedFieldList(fields) {
  if (!fields) return null;
  const rawList = Array.isArray(fields) ? fields : String(fields).split(",");
  const trimmed = rawList.map((field) => field.trim()).filter(Boolean);
  return trimmed.length ? trimmed : null;
}

function mapFieldName(entityName, fieldName) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) return fieldName;
  return definition.fieldMap[fieldName] || fieldName;
}

function mapFieldNameFromDb(entityName, fieldName) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) return fieldName;
  const inverse = Object.entries(definition.fieldMap).find(([, dbField]) => dbField === fieldName);
  return inverse ? inverse[0] : fieldName;
}

/**
 * @param {string} entityName
 * @param {Record<string, unknown> | null | undefined} row
 */
export function hydrateRecord(entityName, row) {
  if (!row) return null;
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) return { ...row };

  /** @type {Record<string, unknown>} */
  const record = {};

  for (const [dbField, value] of Object.entries(row)) {
    const outputField = mapFieldNameFromDb(entityName, dbField);
    if (definition.jsonColumns.includes(outputField)) {
      record[outputField] = parseJsonColumn(value, []);
      continue;
    }
    if (definition.booleanColumns.includes(outputField)) {
      record[outputField] = toBoolean(value);
      continue;
    }
    if (outputField === "preferences") {
      record[outputField] = parseJsonColumn(value, {});
      continue;
    }
    record[outputField] = value;
  }

  return record;
}

function stableUserScope(user) {
  return [user?.id || "", String(user?.email || "").toLowerCase()];
}

function authWhereClause(entityName) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) {
    return {
      clause: "",
      params: () => [],
    };
  }
  return {
    clause: " AND ((created_by_id = ? AND created_by_id != '') OR LOWER(created_by) = ?)",
    params: stableUserScope,
  };
}

function compareValues(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;

  const leftDate = typeof left === "string" ? Date.parse(left) : Number.NaN;
  const rightDate = typeof right === "string" ? Date.parse(right) : Number.NaN;
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
    return leftDate - rightDate;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
}

function sortRecords(records, sortParam) {
  if (!sortParam) return [...records];
  const sortFields = String(sortParam)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (sortFields.length === 0) return [...records];

  return [...records].sort((left, right) => {
    for (const sortField of sortFields) {
      const descending = sortField.startsWith("-");
      const field = descending ? sortField.slice(1) : sortField;
      const result = compareValues(left[field], right[field]);
      if (result !== 0) {
        return descending ? -result : result;
      }
    }
    return 0;
  });
}

function arrayContains(haystack, needle) {
  if (!Array.isArray(haystack)) return false;
  return haystack.some((value) => compareValues(value, needle) === 0);
}

function matchesOperator(recordValue, operator, operatorValue) {
  switch (operator) {
    case "$eq":
      return Array.isArray(recordValue) ? arrayContains(recordValue, operatorValue) : compareValues(recordValue, operatorValue) === 0;
    case "$ne":
      return Array.isArray(recordValue) ? !arrayContains(recordValue, operatorValue) : compareValues(recordValue, operatorValue) !== 0;
    case "$in":
      return Array.isArray(operatorValue) && operatorValue.some((value) => matchesOperator(recordValue, "$eq", value));
    case "$contains":
      if (Array.isArray(recordValue)) return arrayContains(recordValue, operatorValue);
      return String(recordValue || "").toLowerCase().includes(String(operatorValue || "").toLowerCase());
    case "$exists":
      return operatorValue ? recordValue != null && recordValue !== "" : recordValue == null || recordValue === "";
    case "$gt":
      return compareValues(recordValue, operatorValue) > 0;
    case "$gte":
      return compareValues(recordValue, operatorValue) >= 0;
    case "$lt":
      return compareValues(recordValue, operatorValue) < 0;
    case "$lte":
      return compareValues(recordValue, operatorValue) <= 0;
    default:
      return false;
  }
}

function matchesQuery(record, query) {
  if (!query || typeof query !== "object") return true;

  for (const [field, expected] of Object.entries(query)) {
    if (field === "$or") {
      if (!Array.isArray(expected) || !expected.some((part) => matchesQuery(record, part))) return false;
      continue;
    }

    if (field === "$and") {
      if (!Array.isArray(expected) || !expected.every((part) => matchesQuery(record, part))) return false;
      continue;
    }

    const actual = record[field];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const operators = Object.entries(expected);
      if (!operators.every(([operator, operatorValue]) => matchesOperator(actual, operator, operatorValue))) {
        return false;
      }
      continue;
    }

    if (Array.isArray(actual)) {
      if (!arrayContains(actual, expected)) return false;
      continue;
    }

    if (compareValues(actual, expected) !== 0) return false;
  }

  return true;
}

function pickFields(record, fields) {
  const selectedFields = normalizedFieldList(fields);
  if (!selectedFields) return record;
  return selectedFields.reduce((accumulator, field) => {
    accumulator[field] = record[field];
    return accumulator;
  }, /** @type {Record<string, unknown>} */ ({}));
}

function assertNonEmptyString(value, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, message, "validation_error");
  }
}

function validateEntityInput(entityName, input, { mode = "create" } = {}) {
  if (entityName === "Task") {
    if (mode === "create") {
      assertNonEmptyString(input.title, "Task title is required.");
    } else if ("title" in input) {
      assertNonEmptyString(input.title, "Task title cannot be empty.");
    }
  }

  if (entityName === "DeletedTask") {
    if (mode === "create") {
      assertNonEmptyString(input.task_id, "Deleted task records require the original task id.");
      assertNonEmptyString(input.title, "Deleted task title is required.");
    } else {
      if ("task_id" in input) {
        assertNonEmptyString(input.task_id, "Deleted task records require the original task id.");
      }
      if ("title" in input) {
        assertNonEmptyString(input.title, "Deleted task title cannot be empty.");
      }
    }
  }

  if (entityName === "Priority") {
    if (mode === "create" || "name" in input) {
      assertNonEmptyString(input.name, "Priority name is required.");
    }
  }

  if (entityName === "SavedTag") {
    if (mode === "create" || "name" in input) {
      assertNonEmptyString(input.name, "Tag name is required.");
    }
  }
}

function buildInsertRow(entityName, input, { appId, user, config, allowSystemFields = false }) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");
  const now = new Date().toISOString();
  const row = {
    id: allowSystemFields && input.id ? String(input.id) : `${definition.idPrefix}_${randomUUID()}`,
    app_id: appId,
    created_date: allowSystemFields && input.created_date ? String(input.created_date) : now,
    updated_date: allowSystemFields && input.updated_date ? String(input.updated_date) : now,
    created_by_id: String(input.created_by_id || user?.id || ""),
    created_by: String(input.created_by || user?.email || ""),
    is_sample: toBoolean(input.is_sample) ? 1 : 0,
  };

  for (const [field, defaultValue] of Object.entries(definition.defaults)) {
    const value = input[field] ?? defaultValue;
    const dbField = mapFieldName(entityName, field);
    if (definition.jsonColumns.includes(field)) {
      row[dbField] = JSON.stringify(parseJsonColumn(value, defaultValue));
    } else if (definition.booleanColumns.includes(field)) {
      row[dbField] = toBoolean(value) ? 1 : 0;
    } else {
      row[dbField] = value;
    }
  }

  for (const field of definition.mutableFields) {
    if (!(field in input) || field in definition.defaults) continue;
    const dbField = mapFieldName(entityName, field);
    const value = input[field];
    if (definition.jsonColumns.includes(field)) {
      row[dbField] = JSON.stringify(parseJsonColumn(value, []));
    } else if (definition.booleanColumns.includes(field)) {
      row[dbField] = toBoolean(value) ? 1 : 0;
    } else {
      row[dbField] = value;
    }
  }

  if (entityName === "DeletedTask") {
    row.deleted_at = String(input.deleted_at || now);
    row.expires_at = String(
      input.expires_at ||
        new Date(new Date(row.deleted_at).getTime() + getDeletedTaskRetentionMs(config)).toISOString()
    );
    row.was_completed =
      "was_completed" in input ? (toBoolean(input.was_completed) ? 1 : 0) : row.status === "done" ? 1 : 0;
    row.subtasks_json = JSON.stringify(parseJsonColumn(input.subtasks, []));
  }

  return row;
}

function buildUpdateRow(entityName, input) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");

  /** @type {Record<string, unknown>} */
  const patch = { updated_date: new Date().toISOString() };

  for (const field of definition.mutableFields) {
    if (!(field in input)) continue;
    const dbField = mapFieldName(entityName, field);
    const value = input[field];
    if (definition.jsonColumns.includes(field)) {
      patch[dbField] = JSON.stringify(parseJsonColumn(value, []));
    } else if (definition.booleanColumns.includes(field)) {
      patch[dbField] = toBoolean(value) ? 1 : 0;
    } else {
      patch[dbField] = value;
    }
  }

  return patch;
}

function insertRow(db, table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).run(
    ...columns.map((column) => row[column])
  );
}

function updateRow(db, table, id, patch, whereClause, params) {
  const columns = Object.keys(patch);
  if (columns.length === 0) return;
  const assignments = columns.map((column) => `${column} = ?`).join(", ");
  db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?${whereClause}`).run(
    ...columns.map((column) => patch[column]),
    id,
    ...params
  );
}

export function purgeExpiredDeletedTasks(db, appId) {
  db.prepare("DELETE FROM deleted_tasks WHERE app_id = ? AND expires_at <= ?").run(
    appId,
    new Date().toISOString()
  );
}

function listRowsForEntity(db, entityName, appId, user) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");
  const scope = authWhereClause(entityName);
  return db
    .prepare(`SELECT * FROM ${definition.table} WHERE app_id = ?${scope.clause}`)
    .all(appId, ...scope.params(user));
}

export function listEntityRecords(db, { entityName, appId, user, sort, skip = 0, limit, fields, query }) {
  if (entityName === "User") {
    return [pickFields(hydrateRecord("User", user), fields)];
  }
  if (entityName === "DeletedTask") {
    purgeExpiredDeletedTasks(db, appId);
  }

  const records = listRowsForEntity(db, entityName, appId, user)
    .map((row) => hydrateRecord(entityName, row))
    .filter((record) => matchesQuery(record, query));

  const sorted = sortRecords(records, sort);
  const sliced = sorted.slice(Math.max(0, skip), limit ? Math.max(0, skip) + Math.max(0, limit) : undefined);
  return sliced.map((record) => pickFields(record, fields));
}

export function getEntityRecord(db, { entityName, appId, user, id }) {
  if (entityName === "User" && id === "me") {
    return hydrateRecord("User", user);
  }

  if (entityName === "DeletedTask") {
    purgeExpiredDeletedTasks(db, appId);
  }

  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");
  const scope = authWhereClause(entityName);
  const row = db
    .prepare(`SELECT * FROM ${definition.table} WHERE id = ? AND app_id = ?${scope.clause}`)
    .get(id, appId, ...scope.params(user));

  if (!row) {
    throw new HttpError(404, `${entityName} not found.`, "not_found");
  }

  return hydrateRecord(entityName, row);
}

export function createEntityRecord(db, { entityName, appId, user, input, config, allowSystemFields = false }) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");
  validateEntityInput(entityName, input, { mode: "create" });

  const row = buildInsertRow(entityName, input, { appId, user, config, allowSystemFields });
  insertRow(db, definition.table, row);
  return hydrateRecord(entityName, row);
}

export function importEntityRecord(db, { entityName, appId, user, input, config }) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");

  if (input.id) {
    db.prepare(`DELETE FROM ${definition.table} WHERE id = ? AND app_id = ?`).run(String(input.id), appId);
  }

  return createEntityRecord(db, {
    entityName,
    appId,
    user,
    input,
    config,
    allowSystemFields: true,
  });
}

export function updateEntityRecord(db, { entityName, appId, user, id, input }) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");
  validateEntityInput(entityName, input, { mode: "update" });
  getEntityRecord(db, { entityName, appId, user, id });

  const scope = authWhereClause(entityName);
  const patch = buildUpdateRow(entityName, input);
  updateRow(db, definition.table, id, patch, ` AND app_id = ?${scope.clause}`, [appId, ...scope.params(user)]);
  return getEntityRecord(db, { entityName, appId, user, id });
}

export function deleteEntityRecord(db, { entityName, appId, user, id }) {
  const definition = ENTITY_DEFINITIONS[entityName];
  if (!definition) throw new HttpError(404, `Unknown entity: ${entityName}`, "unknown_entity");
  getEntityRecord(db, { entityName, appId, user, id });
  const scope = authWhereClause(entityName);
  db.prepare(`DELETE FROM ${definition.table} WHERE id = ? AND app_id = ?${scope.clause}`).run(
    id,
    appId,
    ...scope.params(user)
  );

  // Cascade: when deleting a Task, also remove its subtasks
  if (entityName === "Task") {
    db.prepare(`DELETE FROM ${definition.table} WHERE parent_id = ? AND app_id = ?${scope.clause}`).run(
      id,
      appId,
      ...scope.params(user)
    );
  }

  return { success: true };
}

export function findUserByEmail(db, appId, email) {
  if (!email) return null;
  return db.prepare("SELECT * FROM users WHERE app_id = ? AND LOWER(email) = ?").get(appId, String(email).toLowerCase());
}

export function upsertImportedUser(db, { appId, id, email, fullName = "", role = "user", provider = "import" }) {
  if (!email) return null;
  const now = new Date().toISOString();
  const existing = findUserByEmail(db, appId, email);
  if (existing) {
    db.prepare(
      `
        UPDATE users
        SET full_name = ?, role = ?, auth_provider = ?, updated_date = ?
        WHERE app_id = ? AND LOWER(email) = ?
      `
    ).run(fullName || existing.full_name || "", role || existing.role || "user", provider, now, appId, String(email).toLowerCase());
    return db.prepare("SELECT * FROM users WHERE app_id = ? AND LOWER(email) = ?").get(appId, String(email).toLowerCase());
  }

  const row = {
    id: id || `user_${randomUUID()}`,
    app_id: appId,
    full_name: fullName,
    email: String(email).toLowerCase(),
    role,
    auth_provider: provider,
    password_hash: null,
    google_subject: null,
    avatar_url: null,
    preferences_json: "{}",
    created_date: now,
    updated_date: now,
    last_login_at: null,
  };

  insertRow(db, "users", row);
  return row;
}

export function ensureDefaultPrioritiesForUser(db, { appId, user, config }) {
  const countRow = db
    .prepare(
      `
        SELECT COUNT(*) AS total
        FROM priorities
        WHERE app_id = ?
          AND ((created_by_id = ? AND created_by_id != '') OR LOWER(created_by) = ?)
      `
    )
    .get(appId, user.id || "", String(user.email || "").toLowerCase());

  if (Number(countRow?.total || 0) > 0) return;

  for (const priority of DEFAULT_PRIORITIES) {
    createEntityRecord(db, {
      entityName: "Priority",
      appId,
      user,
      input: priority,
      config,
    });
  }
}
