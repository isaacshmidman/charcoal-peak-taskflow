// @ts-check
/**
 * @file Generic entity CRUD routes — /api/apps/:appId/entities/:entityName/:id?
 * Task mutations trigger the outbound push hook (enqueueTaskPush) so
 * changes echo to connected calendar providers.
 */
import { HttpError, acceptsGzip, readJsonBody, sendJson, sendJsonText } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import {
  createEntityRecord,
  deleteEntityRecord,
  getEntityRecord,
  listEntityRecords,
  updateEntityRecord,
  validateClientInput,
} from "../store.js";
import { enqueueTaskPush } from "../push.js";
import { MAX_ENTITY_BODY_BYTES } from "../limits.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleEntitiesRoute(request, response, { config, db, url, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps") return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  if (segments[3] !== "entities") return false;

  const user = requireAuthenticatedUser(db, config, request, appId);
  const entityName = segments[4];
  const entityId = segments[5];

  if (request.method === "GET" && entityName === "User" && entityId === "me") {
    sendJson(response, 200, user);
    return true;
  }

  if (request.method === "GET" && entityName && !entityId) {
    const list = () =>
      listEntityRecords(db, {
        entityName,
        appId,
        user,
        sort: url.searchParams.get("sort") || undefined,
        skip: parseLimit(url.searchParams.get("skip")) || 0,
        limit: parseLimit(url.searchParams.get("limit")),
        fields: url.searchParams.get("fields") || undefined,
        query: parseQueryFilter(url.searchParams),
        config,
      });
    if (!KEPT_LISTS.has(entityName)) {
      sendJson(response, 200, list());
      return true;
    }
    // The same question asked while nothing in the database has changed
    // has the same answer, so the answer is kept (see keptAnswer).
    const answer = keptAnswer(db, `${appId}\n${user.id}\n${String(user.email).toLowerCase()}\n${entityName}\n${url.search}`, list);
    // A long answer is kept only compressed; the rare client that can't
    // read that gets it written out again.
    const text = answer.text === null && !acceptsGzip(request) ? JSON.stringify(list()) : answer.text;
    sendJsonText(response, 200, text ?? "", {}, answer);
    return true;
  }

  if (request.method === "GET" && entityName && entityId) {
    sendJson(response, 200, getEntityRecord(db, { entityName, appId, user, id: entityId, config }));
    return true;
  }

  if (request.method === "POST" && entityName && !entityId) {
    const body = (await readJsonBody(request, { maxBytes: MAX_ENTITY_BODY_BYTES })) || {};
    validateClientInput(entityName, body);
    // The app names each thing it creates. If it asks again under the
    // same name — because the first answer never arrived — it gets the
    // record that ask made, not a second one.
    const createKey = createKeyOf(request);
    if (createKey) {
      const earlier = db
        .prepare("SELECT record_id FROM created_once WHERE app_id = ? AND user_id = ? AND entity = ? AND create_key = ?")
        .get(appId, user.id, entityName, createKey);
      if (earlier) {
        let record;
        try {
          record = getEntityRecord(db, { entityName, appId, user, id: earlier.record_id, config });
        } catch {
          // Made, and deleted since. It stays deleted; the app is told
          // which record it was so it can stop asking.
          record = { id: earlier.record_id, gone: true };
        }
        sendJson(response, 200, record, { "Idempotent-Replayed": "true" });
        return true;
      }
    }
    const created = createEntityRecord(db, {
      entityName,
      appId,
      user,
      input: body,
      config,
      // A restore (from Recently Deleted, or an Undo) names the task it
      // brings back, so that task's files come back on it.
      restoresTaskId: restoredTaskId(entityName, body),
    });
    if (createKey && created?.id) {
      db.prepare(
        "INSERT OR REPLACE INTO created_once (app_id, user_id, entity, create_key, record_id, created_date) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(appId, user.id, entityName, createKey, String(created.id), new Date().toISOString());
    }
    if (entityName === "Task") {
      enqueueTaskPush(db, config, { op: "upsert", appId, taskSnapshot: created });
    }
    sendJson(response, 201, created);
    return true;
  }

  if (request.method === "PUT" && entityName && entityId) {
    const body = (await readJsonBody(request, { maxBytes: MAX_ENTITY_BODY_BYTES })) || {};
    validateClientInput(entityName, body);
    const updated = updateEntityRecord(db, { entityName, appId, user, id: entityId, input: body, config });
    if (entityName === "Task") {
      enqueueTaskPush(db, config, { op: "upsert", appId, taskSnapshot: updated });
    }
    sendJson(response, 200, updated);
    return true;
  }

  if (request.method === "DELETE" && entityName && entityId) {
    // Snapshot the Task BEFORE delete so push has data for Google DELETE.
    /** @type {any} */
    let snapshot = null;
    if (entityName === "Task") {
      try {
        snapshot = getEntityRecord(db, { entityName, appId, user, id: entityId, config });
      } catch {
        // Already gone; nothing to snapshot.
      }
    }
    // The app's delete moves a task to Recently Deleted (a subtask: behind
    // an Undo), so its files are held for the restore, not deleted.
    const result = deleteEntityRecord(db, { entityName, appId, user, id: entityId, config, holdFiles: true });
    if (entityName === "Task" && snapshot) {
      enqueueTaskPush(db, config, { op: "delete", appId, taskSnapshot: snapshot });
    }
    sendJson(response, 200, result);
    return true;
  }

  throw new HttpError(404, "Route not found.", "not_found");
}

/**
 * The name the app gave this create (the Idempotency-Key header), or ""
 * when it gave none or one that isn't a plain short name.
 * @param {import("node:http").IncomingMessage} request
 */
function createKeyOf(request) {
  const key = String(request.headers?.["idempotency-key"] || "").trim();
  return /^[\w.:-]{8,120}$/.test(key) ? key : "";
}

/** Names older than this are forgotten: no app is still waiting on them. */
const CREATE_KEY_DAYS = 30;

/** @param {any} db */
export function purgeOldCreateKeys(db) {
  const before = new Date(Date.now() - CREATE_KEY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM created_once WHERE created_date <= ?").run(before);
}

/**
 * Lists whose answer depends only on what is in the database. Not the
 * Recently Deleted ones: listing those also throws out whatever has
 * expired, so their answer depends on the clock.
 */
const KEPT_LISTS = new Set(["Task", "Note", "Priority", "SavedTag"]);
const MAX_KEPT_ANSWERS = 200;
const KEEP_TEXT_UNDER = 64 * 1024;

/**
 * @typedef {{ version: string, text: string | null, etag?: string, gzipped?: Buffer | null }} KeptAnswer
 * @type {WeakMap<object, { answers: Map<string, KeptAnswer>, changes: any, dataVersion: any }>}
 */
const keptByDatabase = new WeakMap();

/**
 * The answer to a list request, worked out at most once per state of the
 * database.
 *
 * Listing tasks reads every one of the person's rows, turns each into a
 * record, sorts them and writes them out as JSON — tens of milliseconds
 * on a laptop for a few thousand tasks, several times that on the home
 * server, and nothing else is answered while it runs. The app asks for
 * that list whenever a page opens. So the answer is kept, along with the
 * state of the database it was made from, and reused until that changes.
 *
 * "State of the database" is exact, not a guess: `total_changes()` counts
 * every row this connection has inserted, updated or deleted, and
 * `PRAGMA data_version` moves when any other connection commits. If
 * either has moved — any write at all, to any table — every kept answer
 * is stale and is worked out again. (All writes here are synchronous, so
 * a list is never read half-way through a transaction.)
 *
 * @param {any} db
 * @param {string} key   who is asking, and exactly what for
 * @param {() => unknown} compute
 * @returns {KeptAnswer}
 */
function keptAnswer(db, key, compute) {
  let kept = keptByDatabase.get(db);
  if (!kept) {
    kept = {
      answers: new Map(),
      changes: db.prepare("SELECT total_changes() AS n"),
      dataVersion: db.prepare("PRAGMA data_version"),
    };
    keptByDatabase.set(db, kept);
  }
  const version = `${kept.changes.get().n}:${kept.dataVersion.get().data_version}`;
  const found = kept.answers.get(key);
  if (found && found.version === version) {
    // Once the compressed copy exists, a long answer's text is dead weight.
    if (found.gzipped && found.text && found.text.length > KEEP_TEXT_UNDER) found.text = null;
    // Most recently used goes to the back; the front is what gets dropped.
    kept.answers.delete(key);
    kept.answers.set(key, found);
    return found;
  }
  /** @type {KeptAnswer} */
  const answer = { version, text: JSON.stringify(compute()), gzipped: null };
  kept.answers.delete(key);
  kept.answers.set(key, answer);
  if (kept.answers.size > MAX_KEPT_ANSWERS) kept.answers.delete(kept.answers.keys().next().value);
  return answer;
}

/**
 * @param {string} entityName
 * @param {any} body
 */
function restoredTaskId(entityName, body) {
  const id = entityName === "Task" ? body.restores_task_id : undefined;
  return typeof id === "string" && id.length <= 200 ? id : "";
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseQueryFilter(searchParams) {
  const raw = searchParams.get("q");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "The q parameter must be valid JSON.", "invalid_query");
  }
}
