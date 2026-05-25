// @ts-check
/**
 * @file Notification routes — settings + push subscriptions + test send.
 * All routes under /api/apps/:appId/notifications/* require an
 * authenticated user.
 */
import { HttpError, readJsonBody, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import {
  getNotificationSettingsResponse,
  sendTestNotification,
  unsubscribeNotificationSubscription,
  updateUserNotificationSettings,
  upsertNotificationSubscription,
} from "../notifications.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleNotificationsRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps") return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  if (segments[3] !== "notifications") return false;

  const user = requireAuthenticatedUser(db, config, request, appId);

  if (request.method === "GET" && segments[4] === "settings") {
    sendJson(response, 200, getNotificationSettingsResponse(db, config, { appId, user }));
    return true;
  }

  if (request.method === "PUT" && segments[4] === "settings") {
    const body = (await readJsonBody(request)) || {};
    const settings = updateUserNotificationSettings(db, {
      appId,
      userId: user.id,
      input: body.settings || body,
    });
    sendJson(response, 200, {
      ...getNotificationSettingsResponse(db, config, { appId, user }),
      settings,
      defaulted: false,
    });
    return true;
  }

  if (request.method === "POST" && segments[4] === "subscribe") {
    const body = (await readJsonBody(request)) || {};
    const subscription = upsertNotificationSubscription(db, {
      appId,
      user,
      subscription: body.subscription || body,
      userAgent: String(request.headers["user-agent"] || ""),
    });
    sendJson(response, 200, { success: true, subscription_id: subscription.id });
    return true;
  }

  if (request.method === "POST" && segments[4] === "unsubscribe") {
    const body = (await readJsonBody(request)) || {};
    sendJson(
      response,
      200,
      unsubscribeNotificationSubscription(db, {
        appId,
        user,
        endpoint: body.endpoint,
      })
    );
    return true;
  }

  if (request.method === "POST" && segments[4] === "test") {
    sendJson(response, 200, await sendTestNotification(db, config, { appId, user }));
    return true;
  }

  throw new HttpError(404, "Route not found.", "not_found");
}
