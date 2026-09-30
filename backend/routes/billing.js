// @ts-check
/**
 * @file /api/apps/:appId/billing — the signed-in account's plan, what it
 * allows, and whether Plus can be bought here. Plus itself is never set
 * through here: see backend/plans.js.
 */
import { HttpError, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { LIMITS, plusOf } from "../plans.js";

/**
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, userId: string }} who
 */
export function billingStatus(db, config, who) {
  const plus = plusOf(db, who);
  const limits = LIMITS[plus ? "plus" : "basic"];
  return {
    plan: plus ? "plus" : "basic",
    source: plus?.source || null,
    since: plus?.granted_at || null,
    limits: {
      storage_bytes: limits.storageBytes,
      active_schedules: Number.isFinite(limits.activeSchedules) ? limits.activeSchedules : null,
      calendar_sync: limits.calendarSync,
      ai_apps: limits.aiApps,
    },
    buy: { available: false, price: null },
  };
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleBillingRoute(request, response, { config, db, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "billing") return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  const user = requireAuthenticatedUser(db, config, request, appId);
  const who = { appId, userId: user.id };
  if (request.method === "GET" && segments.length === 4) {
    sendJson(response, 200, billingStatus(db, config, who));
    return true;
  }
  throw new HttpError(404, "Route not found.", "not_found");
}
