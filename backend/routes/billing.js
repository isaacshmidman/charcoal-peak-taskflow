// @ts-check
/**
 * @file Plans and buying Plus.
 *   GET  /api/apps/:appId/billing            the account's plan, its limits, and whether/what Plus costs here
 *   POST /api/apps/:appId/billing/checkout   → { url } of Stripe's Checkout page, for this account
 *   POST /api/apps/:appId/billing/confirm    { session_id } back from Checkout: Stripe is asked, then Plus granted
 *   POST /api/billing/stripe/webhook         Stripe's signed events (no session: the signature is the proof)
 * Plus itself is never set by a request: see backend/plans.js and backend/billing.js.
 */
import { HttpError, readBodyText, readJsonBody, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { LIMITS, plusOf } from "../plans.js";
import { billingEnabled, confirmCheckout, handleStripeEvent, plusPrice, startCheckout, taxAddedAtCheckout, verifyWebhook } from "../billing.js";
import { takeSlot } from "../ai/rate-limit.js";

/** Stripe's events are small; this is far above any of them. */
const MAX_WEBHOOK_BYTES = 512 * 1024;

/**
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, userId: string }} who
 */
export async function billingStatus(db, config, who) {
  const plus = plusOf(db, who);
  const limits = LIMITS[plus ? "plus" : "basic"];
  const price = plus ? null : await plusPrice(config);
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
    buy: {
      available: !plus && billingEnabled(config) && Boolean(price),
      price: price ? { amount: price.amount, currency: price.currency, label: price.label, tax_added: taxAddedAtCheckout(config, price) } : null,
    },
  };
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleBillingRoute(request, response, { config, db, segments }) {
  // Stripe → us. Unsigned or stale requests are refused before anything is read into the database.
  if (segments[0] === "api" && segments[1] === "billing" && segments[2] === "stripe" && segments[3] === "webhook" && segments.length === 4) {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    if (!billingEnabled(config)) throw new HttpError(503, "Buying Plus isn't set up on this server.", "billing_not_configured");
    const raw = await readBodyText(request, { maxBytes: MAX_WEBHOOK_BYTES });
    const event = verifyWebhook(raw, request.headers["stripe-signature"], config.stripeWebhookSecret);
    await handleStripeEvent(db, config, event);
    sendJson(response, 200, { received: true });
    return true;
  }

  if (segments[0] !== "api" || segments[1] !== "apps" || segments[3] !== "billing") return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  const user = requireAuthenticatedUser(db, config, request, appId);
  const who = { appId, userId: user.id };

  if (request.method === "GET" && segments.length === 4) {
    sendJson(response, 200, await billingStatus(db, config, who));
    return true;
  }
  if (request.method === "POST" && segments[4] === "checkout" && segments.length === 5) {
    if (!takeSlot(`checkout:${user.id}`, 5, 60_000).ok) throw new HttpError(429, "Too many tries. Wait a minute and try again.", "too_many_attempts");
    sendJson(response, 200, await startCheckout(db, config, { appId, user }));
    return true;
  }
  if (request.method === "POST" && segments[4] === "confirm" && segments.length === 5) {
    if (!takeSlot(`confirm:${user.id}`, 20, 60_000).ok) throw new HttpError(429, "Too many tries. Wait a minute and try again.", "too_many_attempts");
    const body = /** @type {any} */ ((await readJsonBody(request)) || {});
    await confirmCheckout(db, config, { appId, user, sessionId: body.session_id });
    sendJson(response, 200, await billingStatus(db, config, who));
    return true;
  }
  throw new HttpError(404, "Route not found.", "not_found");
}
