// @ts-check
/**
 * @file Zephyrly's two plans, and who has which. The one place that
 * decides what Basic and Plus allow; every gate on the server asks here.
 *
 *   Basic (free) — the whole app: tasks, notes, reminders, one schedule at
 *     a time, 500 MB of files, Recently Deleted, export and restore.
 *   Plus ($9 once, for the life of the account) — Google and Apple
 *     Calendar sync, AI apps (Claude, ChatGPT, Gemini, local models,
 *     Siri), any number of schedules at once, 1 GB of files.
 *
 * Plus is a row in `entitlements`, written only here: by a payment Stripe
 * confirmed (backend/billing.js), by the owner's gift script
 * (backend/scripts/plus.mjs), or once, at launch, for every account that
 * already existed ("founding"; backend/db.js). No API route writes it. A
 * refund or a chargeback revokes it.
 *
 * The app's upgrade prompts are only a courtesy: every gate is here, on
 * the server, so a modified app gets a 402 and not the feature.
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "./http.js";

export const LIMITS = {
  basic: { storageBytes: 500_000_000, activeSchedules: 1, calendarSync: false, aiApps: false },
  plus: { storageBytes: 1_000_000_000, activeSchedules: Infinity, calendarSync: true, aiApps: true },
};

/** What each gated feature is called when it's refused. */
const FEATURE_NAMES = {
  calendarSync: "Google and Apple Calendar sync",
  aiApps: "Connecting AI apps",
  activeSchedules: "More than one schedule at a time",
  storageBytes: "More room for files",
};

/**
 * @typedef {{ appId: string, userId: string }} Who
 * @typedef {"basic" | "plus"} Plan
 */

/**
 * The account's Plus, if it has it: its row in `entitlements`.
 * @param {any} db
 * @param {Who} who
 * @returns {any | null}
 */
export function plusOf(db, { appId, userId }) {
  return (
    db
      .prepare(`SELECT * FROM entitlements WHERE app_id = ? AND user_id = ? AND plan = 'plus' AND revoked_at IS NULL ORDER BY granted_at LIMIT 1`)
      .get(appId, userId) || null
  );
}

/**
 * @param {any} db
 * @param {Who} who
 * @returns {Plan}
 */
export function planOf(db, who) {
  return plusOf(db, who) ? "plus" : "basic";
}

/**
 * @param {any} db
 * @param {Who} who
 */
export function limitsOf(db, who) {
  return LIMITS[planOf(db, who)];
}

/**
 * Refuse a Plus feature to a Basic account: 402 with the feature named,
 * which the app turns into its upgrade prompt.
 * @param {any} db
 * @param {Who} who
 * @param {"calendarSync" | "aiApps"} feature
 */
export function requirePlus(db, who, feature) {
  if (limitsOf(db, who)[feature]) return;
  throw new HttpError(402, `${FEATURE_NAMES[feature]} is part of Zephyrly Plus.`, "plus_required", { feature });
}

/**
 * Give an account Plus (a payment, a gift). Does nothing if it has it.
 * @param {any} db
 * @param {Who & { source: "stripe" | "gift" | "founding", stripeSessionId?: string, stripePaymentIntent?: string, amountTotal?: number, currency?: string }} input
 */
export function grantPlus(db, { appId, userId, source, stripeSessionId, stripePaymentIntent, amountTotal, currency }) {
  const existing = plusOf(db, { appId, userId });
  if (existing) return existing;
  const row = {
    id: `ent_${randomUUID()}`,
    granted_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO entitlements (id, app_id, user_id, plan, source, stripe_session_id, stripe_payment_intent, amount_total, currency, granted_at)
     VALUES (?, ?, ?, 'plus', ?, ?, ?, ?, ?, ?)`
  ).run(row.id, appId, userId, source, stripeSessionId || null, stripePaymentIntent || null, amountTotal ?? null, currency || null, row.granted_at);
  return plusOf(db, { appId, userId });
}

/**
 * Take Plus back: an account's, or the one a Stripe payment bought.
 * Returns how many were revoked.
 * @param {any} db
 * @param {{ appId?: string, userId?: string, stripePaymentIntent?: string, reason: string }} input
 */
export function revokePlus(db, { appId, userId, stripePaymentIntent, reason }) {
  const now = new Date().toISOString();
  if (stripePaymentIntent) {
    return db
      .prepare(`UPDATE entitlements SET revoked_at = ?, revoked_reason = ? WHERE stripe_payment_intent = ? AND revoked_at IS NULL`)
      .run(now, reason, stripePaymentIntent).changes;
  }
  return db
    .prepare(`UPDATE entitlements SET revoked_at = ?, revoked_reason = ? WHERE app_id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(now, reason, appId, userId).changes;
}

/**
 * Give Plus back after a dispute the seller won.
 * @param {any} db
 * @param {{ stripePaymentIntent: string }} input
 */
export function restorePlus(db, { stripePaymentIntent }) {
  return db
    .prepare(`UPDATE entitlements SET revoked_at = NULL, revoked_reason = NULL WHERE stripe_payment_intent = ? AND revoked_reason = 'dispute'`)
    .run(stripePaymentIntent).changes;
}

// ── Schedules: one switched on at a time on Basic ──────────────────────

/**
 * Whether a note's stored schedule is switched on.
 * @param {unknown} json
 */
function scheduleOn(json) {
  if (typeof json !== "string" || !json) return false;
  try {
    return JSON.parse(json)?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * How many of the account's notes, other than `exceptNoteId`, show as a
 * schedule.
 * @param {any} db
 * @param {Who} who
 * @param {string | null} [exceptNoteId]
 */
export function otherSchedulesOn(db, { appId, userId }, exceptNoteId = null) {
  return db
    .prepare(`SELECT id, schedule_json FROM notes WHERE app_id = ? AND created_by_id = ? AND schedule_json LIKE '%"enabled":true%'`)
    .all(appId, userId)
    .filter((/** @type {any} */ row) => row.id !== exceptNoteId && scheduleOn(row.schedule_json)).length;
}

/**
 * A schedule arriving with a note that's being brought back (Recently
 * Deleted, Undo, restore from an export) is kept, but switched off when
 * the plan's number at once is already reached: nothing is lost, and
 * nothing is refused.
 * @param {any} db
 * @param {Who} who
 * @param {unknown} scheduleJson
 * @returns {unknown}
 */
export function scheduleWithinPlan(db, who, scheduleJson) {
  if (!scheduleOn(scheduleJson)) return scheduleJson;
  if (otherSchedulesOn(db, who) < limitsOf(db, who).activeSchedules) return scheduleJson;
  return JSON.stringify({ ...JSON.parse(String(scheduleJson)), enabled: false });
}

/**
 * Refuse switching on a schedule past the plan's number at once. Only
 * switching one on counts: editing or switching off a schedule is always
 * fine, so nobody is ever stuck.
 * @param {any} db
 * @param {Who} who
 * @param {string | null} noteId  the note being changed, or null for a new one
 * @param {unknown} scheduleJson  what it's about to store
 */
export function assertScheduleAllowed(db, who, noteId, scheduleJson) {
  if (!scheduleOn(scheduleJson)) return;
  if (noteId) {
    const row = db.prepare(`SELECT schedule_json FROM notes WHERE id = ? AND app_id = ?`).get(noteId, who.appId);
    if (row && scheduleOn(row.schedule_json)) return; // already on: an edit
  }
  const allowed = limitsOf(db, who).activeSchedules;
  if (otherSchedulesOn(db, who, noteId) >= allowed) {
    throw new HttpError(
      402,
      "Basic has one schedule at a time. Switch the other one off first, or get Zephyrly Plus for as many as you like.",
      "plus_required",
      { feature: "activeSchedules" }
    );
  }
}
