// @ts-check
/**
 * @file GET/PUT /api/apps/:appId/home-layout — how a person arranged
 * their Home page (backend/home-layout.js). `layout` is a list of
 * `{ id, size }`, or null when they never arranged it. A PUT replaces it;
 * `{ "layout": null }` forgets it. Signed-in only.
 */
import { readJsonBody, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { getHomeLayout, setHomeLayout } from "../home-layout.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleHomeLayoutRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "home-layout" || segments.length !== 4) return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  const user = requireAuthenticatedUser(db, config, request, appId);
  const who = { appId, userId: user.id };
  if (request.method === "GET") {
    sendJson(response, 200, { layout: getHomeLayout(db, who) });
    return true;
  }
  if (request.method === "PUT") {
    const body = /** @type {any} */ ((await readJsonBody(request)) || {});
    sendJson(response, 200, { layout: setHomeLayout(db, { ...who, layout: body.layout }) });
    return true;
  }
  sendJson(response, 405, { message: "Method not allowed.", code: "method_not_allowed" });
  return true;
}
