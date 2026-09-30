// @ts-check
/**
 * @file GET/PUT /api/apps/:appId/schedule-defaults — the settings a person
 * pinned so every new schedule starts with them. Signed-in only.
 */
import { readJsonBody, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { getScheduleDefaults, setScheduleDefaults } from "../schedule-defaults.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleScheduleDefaultsRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "schedule-defaults" || segments.length !== 4) return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  const user = requireAuthenticatedUser(db, config, request, appId);
  if (request.method === "GET") {
    sendJson(response, 200, { defaults: getScheduleDefaults(db, { appId, userId: user.id }) });
    return true;
  }
  if (request.method === "PUT") {
    const body = /** @type {any} */ ((await readJsonBody(request)) || {});
    sendJson(response, 200, { defaults: setScheduleDefaults(db, { appId, userId: user.id, defaults: body.defaults }) });
    return true;
  }
  sendJson(response, 405, { message: "Method not allowed.", code: "method_not_allowed" });
  return true;
}
