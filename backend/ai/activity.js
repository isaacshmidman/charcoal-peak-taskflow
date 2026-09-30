// @ts-check
/**
 * @file The log of what AI apps changed, and Undo.
 *
 * Every change an AI app makes is written here with what reversing it
 * needs. Undo only acts if what it would reverse hasn't been touched
 * since (the row's updated_date is still the one the AI left); otherwise
 * it says so and leaves things alone rather than overwrite a later edit.
 * Deletes aren't undone here: they went to Recently Deleted, which
 * already restores them properly.
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "../http.js";
import { withTransaction } from "../db.js";
import { deleteEntityRecord, getEntityRecord, updateEntityRecord } from "../store.js";
import { enqueueTaskPush } from "../push.js";

const DEFAULT_LIST_LIMIT = 50;

/**
 * @param {import("./context.js").ToolContext} ctx
 * @param {string} tool
 * @param {string} summary  one calm sentence, shown in Settings
 * @param {Record<string, any> | null} undo
 */
export function logActivity(ctx, tool, summary, undo) {
  const id = `aiact_${randomUUID()}`;
  ctx.db
    .prepare(
      `INSERT INTO ai_activity (id, app_id, user_id, grant_id, tool, summary, undo_json, created_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, ctx.appId, ctx.user.id, ctx.grant.id, tool, summary, undo ? JSON.stringify(undo) : null, new Date().toISOString());
  return id;
}

/**
 * @param {any} row
 */
function serializeActivity(row) {
  const undo = row.undo_json ? JSON.parse(row.undo_json) : null;
  return {
    id: row.id,
    app: row.app_label || "An AI app",
    tool: row.tool,
    summary: row.summary,
    created_date: row.created_date,
    // available | undone | recently_deleted (restore it there) | none
    undo: row.undone_at ? "undone" : !undo ? "none" : undo.kind === "delete_task" || undo.kind === "delete_note" ? "recently_deleted" : "available",
  };
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string, limit?: number }} scope
 */
export function listActivity(db, { appId, userId, limit = DEFAULT_LIST_LIMIT }) {
  return db
    .prepare(
      `SELECT ai_activity.*, ai_grants.label AS app_label
       FROM ai_activity LEFT JOIN ai_grants ON ai_grants.id = ai_activity.grant_id
       WHERE ai_activity.app_id = ? AND ai_activity.user_id = ?
       ORDER BY ai_activity.created_date DESC, ai_activity.rowid DESC
       LIMIT ?`
    )
    .all(appId, userId, limit)
    .map(serializeActivity);
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, user: any, activityId: string }} input
 */
export function undoActivity(db, config, { appId, user, activityId }) {
  const row = db
    .prepare(`SELECT * FROM ai_activity WHERE id = ? AND app_id = ? AND user_id = ?`)
    .get(activityId, appId, user.id);
  if (!row) throw new HttpError(404, "That change isn't in the log.", "not_found");
  if (row.undone_at) throw new HttpError(400, "That change was already undone.", "already_undone");
  const undo = row.undo_json ? JSON.parse(row.undo_json) : null;
  if (!undo) throw new HttpError(400, "That change can't be undone from here.", "not_undoable");
  if (undo.kind === "delete_task" || undo.kind === "delete_note") {
    throw new HttpError(400, "Restore it from Recently Deleted.", "use_recently_deleted");
  }

  /** @type {any} */
  const scope = { appId, user };
  /** @type {{ op: "upsert" | "delete", taskSnapshot: any }[]} */
  const pushes = [];

  /**
   * The record as it is now, or null if it's gone.
   * @param {string} entityName
   * @param {string} id
   * @returns {any}
   */
  const current = (entityName, id) => {
    try {
      return getEntityRecord(db, { entityName, ...scope, id });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  };
  /**
   * @param {any} record
   * @param {string} expected
   */
  const unchangedSince = (record, expected) => {
    if (record.updated_date !== expected) {
      throw new HttpError(409, `"${record.title || "It"}" has been changed since, so this can't be undone automatically.`, "changed_since");
    }
  };

  /**
   * Undoing an addition deletes the task for good, so files the person has
   * attached to it (or its subtasks) since would go with it: that counts as
   * a change too.
   * @param {any} record
   */
  const noFilesSince = (record) => {
    const ids = [record.id, ...db.prepare(`SELECT id FROM tasks WHERE app_id = ? AND parent_id = ?`).all(appId, record.id).map((/** @type {any} */ r) => r.id)];
    const files = db
      .prepare(`SELECT COUNT(*) AS n FROM task_attachments WHERE app_id = ? AND task_id IN (${ids.map(() => "?").join(", ")})`)
      .get(appId, ...ids);
    if (Number(files?.n || 0) > 0) {
      throw new HttpError(409, `"${record.title || "It"}" has had files attached since, so this can't be undone automatically.`, "changed_since");
    }
  };

  withTransaction(db, () => {
    if (undo.kind === "create_task") {
      const task = current("Task", undo.task_id);
      if (task) {
        unchangedSince(task, undo.updated_date);
        noFilesSince(task);
        deleteEntityRecord(db, { entityName: "Task", ...scope, id: task.id, config });
        pushes.push({ op: "delete", taskSnapshot: task });
      }
    } else if (undo.kind === "update_task") {
      const task = current("Task", undo.task_id);
      if (!task) throw new HttpError(409, "That task is gone, so there's nothing to undo.", "gone");
      unchangedSince(task, undo.updated_date);
      pushes.push({ op: "upsert", taskSnapshot: updateEntityRecord(db, { entityName: "Task", ...scope, id: task.id, input: undo.before }) });
    } else if (undo.kind === "complete_recurring") {
      const series = current("Task", undo.task_id);
      if (!series) throw new HttpError(409, "That task is gone, so there's nothing to undo.", "gone");
      unchangedSince(series, undo.updated_date);
      const subtasks = undo.subtasks.map((/** @type {any} */ s) => ({ ...s, record: current("Task", s.id) })).filter((/** @type {any} */ s) => s.record);
      for (const s of subtasks) unchangedSince(s.record, s.updated_date);
      const snapshot = current("Task", undo.snapshot_id);
      if (snapshot) {
        unchangedSince(snapshot, undo.snapshot_updated_date);
        noFilesSince(snapshot);
      }

      if (snapshot) {
        const copies = undo.copy_ids.map((/** @type {string} */ id) => current("Task", id)).filter(Boolean);
        // Deleting the snapshot takes its subtask copies with it.
        deleteEntityRecord(db, { entityName: "Task", ...scope, id: snapshot.id, config });
        for (const record of [snapshot, ...copies]) pushes.push({ op: "delete", taskSnapshot: record });
      }
      pushes.push({ op: "upsert", taskSnapshot: updateEntityRecord(db, { entityName: "Task", ...scope, id: series.id, input: undo.before }) });
      for (const s of subtasks) {
        pushes.push({ op: "upsert", taskSnapshot: updateEntityRecord(db, { entityName: "Task", ...scope, id: s.id, input: s.before }) });
      }
    } else if (undo.kind === "update_note") {
      const note = current("Note", undo.note_id);
      if (!note) throw new HttpError(409, "That note is gone, so there's nothing to undo.", "gone");
      unchangedSince(note, undo.updated_date);
      updateEntityRecord(db, { entityName: "Note", ...scope, id: note.id, input: undo.before });
    } else if (undo.kind === "create_note") {
      const note = current("Note", undo.note_id);
      if (note) {
        unchangedSince(note, undo.updated_date);
        deleteEntityRecord(db, { entityName: "Note", ...scope, id: note.id, config });
      }
    } else {
      throw new HttpError(400, "That change can't be undone from here.", "not_undoable");
    }
    db.prepare(`UPDATE ai_activity SET undone_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
  });

  for (const push of pushes) enqueueTaskPush(db, config, { ...push, appId });
  const [updated] = db
    .prepare(
      `SELECT ai_activity.*, ai_grants.label AS app_label FROM ai_activity
       LEFT JOIN ai_grants ON ai_grants.id = ai_activity.grant_id WHERE ai_activity.id = ?`
    )
    .all(row.id);
  return serializeActivity(updated);
}
