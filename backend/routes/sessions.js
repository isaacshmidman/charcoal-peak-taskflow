// @ts-check
/**
 * @file /api/apps/:appId/sessions — the account's signed-in devices.
 *   GET                       the list, this one marked
 *   DELETE /:id               sign that one out
 *   POST   /sign-out-others   sign out everywhere but here
 */
import { HttpError, sendJson } from "../http.js";
import { getAuthorizedSession } from "../auth.js";
import { listSessions, revokeOtherSessions, revokeSession } from "../sessions.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleSessionsRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "sessions") return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  const authorized = getAuthorizedSession(db, config, request, appId);
  if (!authorized?.user) throw new HttpError(401, "Authentication required.", "auth_required");
  const who = { appId, userId: authorized.user.id, currentId: authorized.session.id };

  if (request.method === "GET" && segments.length === 4) {
    sendJson(response, 200, { sessions: listSessions(db, who) });
    return true;
  }
  if (request.method === "POST" && segments[4] === "sign-out-others" && segments.length === 5) {
    sendJson(response, 200, { signed_out: revokeOtherSessions(db, who) });
    return true;
  }
  if (request.method === "DELETE" && segments.length === 5) {
    if (segments[4] === who.currentId) throw new HttpError(400, "That's this device: use Log out.", "current_session");
    revokeSession(db, { ...who, id: segments[4] });
    sendJson(response, 200, { success: true });
    return true;
  }
  throw new HttpError(404, "Route not found.", "not_found");
}
