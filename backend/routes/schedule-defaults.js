// @ts-check
/**
 * @file GET/PUT /api/apps/:appId/schedule-defaults — a person's schedule
 * preferences: the settings pinned so every new schedule starts with them
 * (`defaults`), and what to do with a slot like a task already on the day
 * it's added to (`similar_tasks`: ask, merge or keep). A PUT changes only
 * what it sends. Signed-in only.
 */
import { readJsonBody, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { getScheduleDefaults, getSimilarTasksChoice, setScheduleDefaults, setSimilarTasksChoice } from "../schedule-defaults.js";

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
  const who = { appId, userId: user.id };
  const current = () => ({ defaults: getScheduleDefaults(db, who), similar_tasks: getSimilarTasksChoice(db, who) });
  if (request.method === "GET") {
    sendJson(response, 200, current());
    return true;
  }
  if (request.method === "PUT") {
    const body = /** @type {any} */ ((await readJsonBody(request)) || {});
    if (Object.hasOwn(body, "defaults")) setScheduleDefaults(db, { ...who, defaults: body.defaults });
    if (Object.hasOwn(body, "similar_tasks")) setSimilarTasksChoice(db, { ...who, choice: body.similar_tasks });
    sendJson(response, 200, current());
    return true;
  }
  sendJson(response, 405, { message: "Method not allowed.", code: "method_not_allowed" });
  return true;
}
