// @ts-check
/**
 * @file Generic entity CRUD routes — /api/apps/:appId/entities/:entityName/:id?
 * Task mutations trigger the outbound push hook (enqueueTaskPush) so
 * changes echo to connected calendar providers.
 */
import { HttpError, readJsonBody, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import {
  createEntityRecord,
  deleteEntityRecord,
  getEntityRecord,
  listEntityRecords,
  updateEntityRecord,
} from "../store.js";
import { enqueueTaskPush } from "../push.js";

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
    sendJson(
      response,
      200,
      listEntityRecords(db, {
        entityName,
        appId,
        user,
        sort: url.searchParams.get("sort") || undefined,
        skip: parseLimit(url.searchParams.get("skip")) || 0,
        limit: parseLimit(url.searchParams.get("limit")),
        fields: url.searchParams.get("fields") || undefined,
        query: parseQueryFilter(url.searchParams),
      })
    );
    return true;
  }

  if (request.method === "GET" && entityName && entityId) {
    sendJson(response, 200, getEntityRecord(db, { entityName, appId, user, id: entityId }));
    return true;
  }

  if (request.method === "POST" && entityName && !entityId) {
    const body = (await readJsonBody(request)) || {};
    const created = createEntityRecord(db, {
      entityName,
      appId,
      user,
      input: body,
      config,
    });
    if (entityName === "Task") {
      enqueueTaskPush(db, config, { op: "upsert", appId, taskSnapshot: created });
    }
    sendJson(response, 201, created);
    return true;
  }

  if (request.method === "PUT" && entityName && entityId) {
    const body = (await readJsonBody(request)) || {};
    const updated = updateEntityRecord(db, { entityName, appId, user, id: entityId, input: body });
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
        snapshot = getEntityRecord(db, { entityName, appId, user, id: entityId });
      } catch {
        // Already gone; nothing to snapshot.
      }
    }
    const result = deleteEntityRecord(db, { entityName, appId, user, id: entityId });
    if (entityName === "Task" && snapshot) {
      enqueueTaskPush(db, config, { op: "delete", appId, taskSnapshot: snapshot });
    }
    sendJson(response, 200, result);
    return true;
  }

  throw new HttpError(404, "Route not found.", "not_found");
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
