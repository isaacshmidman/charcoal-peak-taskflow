// @ts-check
/**
 * @file Access for AI apps. A grant is one connected app for one user; a
 * token carries a grant. Deliberately separate from sign-in sessions: an
 * AI token opens only the AI endpoints (/api/mcp, /api/v1), never the
 * app's own API, and a session token never opens the AI endpoints — a
 * read-only token must not be a way into the whole account.
 *
 * Secrets are random and shown once; only their sha256 is stored.
 */
import { randomUUID } from "node:crypto";
import { limitsOf, requirePlus } from "../plans.js";
import { HttpError } from "../http.js";
import { buildUserPayload, createOpaqueToken, sha256 } from "../auth.js";
import { sanitizeTimeZone } from "../notifications.js";

export const MAX_ACTIVE_TOKENS_PER_USER = 10;
const MAX_LABEL_CHARS = 100;
const ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// last_used_at is for the Settings list, not an audit trail; writing it on
// every request would put a write on every read.
const LAST_USED_RESOLUTION_MS = 60 * 1000;

const TOKEN_PREFIXES = /** @type {const} */ ({ personal: "zeph_pat_", access: "zeph_at_", refresh: "zeph_rt_" });

/**
 * AI apps are Zephyrly Plus (backend/plans.js). The one place that decides.
 * @param {any} db
 * @param {string} appId
 * @param {{ id: string }} user
 */
export function aiAccessAllowed(db, appId, user) {
  return limitsOf(db, { appId, userId: user.id }).aiApps;
}

/**
 * @param {any} row
 */
function serializeGrant(row) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    can_write: Boolean(row.can_write),
    time_zone: row.time_zone,
    created_date: row.created_date,
    last_used_at: row.last_used_at || null,
  };
}

/**
 * @param {unknown} label
 */
function cleanLabel(label) {
  const text = String(label ?? "").replace(/\p{Cc}/gu, " ").trim().slice(0, MAX_LABEL_CHARS);
  if (!text) throw new HttpError(400, "Give the connection a name.", "validation_error", { field: "label" });
  return text;
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string, kind: "token" | "oauth", label: string, clientId?: string | null, canWrite: boolean, timeZone?: string }} input
 */
export function createGrant(db, { appId, userId, kind, label, clientId = null, canWrite, timeZone }) {
  const row = {
    id: `grant_${randomUUID()}`,
    app_id: appId,
    user_id: userId,
    kind,
    label: cleanLabel(label),
    client_id: clientId,
    can_write: canWrite ? 1 : 0,
    time_zone: sanitizeTimeZone(timeZone),
    created_date: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO ai_grants (id, app_id, user_id, kind, label, client_id, can_write, time_zone, created_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.app_id, row.user_id, row.kind, row.label, row.client_id, row.can_write, row.time_zone, row.created_date);
  return row;
}

/**
 * Mint a secret for a grant. Returns the secret — the only time it exists
 * outside the caller's hands.
 *
 * @param {any} db
 * @param {{ grantId: string, kind: "personal" | "access" | "refresh", ttlMs?: number | null }} input
 */
export function issueToken(db, { grantId, kind, ttlMs = null }) {
  const token = `${TOKEN_PREFIXES[kind]}${createOpaqueToken(32)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO ai_tokens (token_hash, grant_id, kind, expires_at, created_date) VALUES (?, ?, ?, ?, ?)`
  ).run(sha256(token), grantId, kind, ttlMs ? new Date(now + ttlMs).toISOString() : null, new Date(now).toISOString());
  return token;
}

/**
 * A personal token: typed into an AI app's settings by hand. Lasts until
 * it's revoked.
 *
 * @param {any} db
 * @param {{ appId: string, user: { id: string }, label: unknown, canWrite: unknown, timeZone?: unknown }} input
 */
export function createPersonalToken(db, { appId, user, label, canWrite, timeZone }) {
  requirePlus(db, { appId, userId: user.id }, "aiApps");
  const active = db
    .prepare(`SELECT COUNT(*) AS n FROM ai_grants WHERE app_id = ? AND user_id = ? AND kind = 'token' AND revoked_at IS NULL`)
    .get(appId, user.id);
  if (Number(active?.n || 0) >= MAX_ACTIVE_TOKENS_PER_USER) {
    throw new HttpError(
      400,
      `You have ${MAX_ACTIVE_TOKENS_PER_USER} tokens already. Revoke one you no longer use first.`,
      "too_many_tokens"
    );
  }
  const grant = createGrant(db, {
    appId,
    userId: user.id,
    kind: "token",
    label: /** @type {string} */ (label),
    canWrite: canWrite === true,
    timeZone: typeof timeZone === "string" ? timeZone : undefined,
  });
  const token = issueToken(db, { grantId: grant.id, kind: "personal" });
  return { grant: serializeGrant(grant), token };
}

/**
 * Resolve a bearer token to its live grant and user, or null. Expired,
 * revoked and refresh tokens never authorize a request.
 *
 * @param {any} db
 * @param {string} appId
 * @param {string} token
 */
export function findGrantForToken(db, appId, token) {
  if (!token || !/^zeph_(pat|at)_/.test(token)) return null;
  const row = db
    .prepare(
      `SELECT ai_tokens.kind AS token_kind, ai_tokens.expires_at AS token_expires_at, ai_grants.*
       FROM ai_tokens JOIN ai_grants ON ai_grants.id = ai_tokens.grant_id
       WHERE ai_tokens.token_hash = ? AND ai_grants.app_id = ?`
    )
    .get(sha256(token), appId);
  if (!row || row.revoked_at) return null;
  if (row.token_kind !== "personal" && row.token_kind !== "access") return null;
  if (row.token_expires_at && row.token_expires_at <= new Date().toISOString()) return null;
  const userRow = db.prepare(`SELECT * FROM users WHERE id = ? AND app_id = ?`).get(row.user_id, appId);
  if (!userRow) return null;
  const user = buildUserPayload(userRow);
  // Without Plus (a refund) the connection stays listed but doesn't work.
  if (!user || !aiAccessAllowed(db, appId, user)) return null;
  return { grant: row, user };
}

/**
 * The grant and user behind an AI request's bearer token. Throws a 401
 * the caller turns into its own challenge (MCP adds WWW-Authenticate).
 *
 * @param {any} db
 * @param {any} config
 * @param {import("node:http").IncomingMessage} request
 */
export function requireAiGrant(db, config, request) {
  const header = String(request.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const found = findGrantForToken(db, config.appId, token);
  if (!found) throw new HttpError(401, "A Zephyrly token for AI apps is required.", "ai_token_required");

  const now = Date.now();
  if (!found.grant.last_used_at || now - Date.parse(found.grant.last_used_at) > LAST_USED_RESOLUTION_MS) {
    db.prepare(`UPDATE ai_grants SET last_used_at = ? WHERE id = ?`).run(new Date(now).toISOString(), found.grant.id);
  }
  return found;
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string }} scope
 */
export function listGrants(db, { appId, userId }) {
  return db
    .prepare(
      `SELECT * FROM ai_grants WHERE app_id = ? AND user_id = ? AND revoked_at IS NULL ORDER BY created_date DESC`
    )
    .all(appId, userId)
    .map(serializeGrant);
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string, grantId: string }} scope
 */
function getOwnGrant(db, { appId, userId, grantId }) {
  const row = db
    .prepare(`SELECT * FROM ai_grants WHERE id = ? AND app_id = ? AND user_id = ? AND revoked_at IS NULL`)
    .get(grantId, appId, userId);
  if (!row) throw new HttpError(404, "That connection doesn't exist.", "not_found");
  return row;
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string, grantId: string, canWrite: unknown }} input
 */
export function setGrantCanWrite(db, { appId, userId, grantId, canWrite }) {
  if (typeof canWrite !== "boolean") {
    throw new HttpError(400, "can_write must be true or false.", "validation_error", { field: "can_write" });
  }
  getOwnGrant(db, { appId, userId, grantId });
  db.prepare(`UPDATE ai_grants SET can_write = ? WHERE id = ?`).run(canWrite ? 1 : 0, grantId);
  return serializeGrant(getOwnGrant(db, { appId, userId, grantId }));
}

/**
 * Revoke a grant: its tokens stop working immediately and are deleted.
 * The grant row stays (revoked) so the activity log can still name it.
 *
 * @param {any} db
 * @param {{ appId: string, userId: string, grantId: string }} scope
 */
export function revokeGrant(db, { appId, userId, grantId }) {
  getOwnGrant(db, { appId, userId, grantId });
  revokeGrantById(db, grantId);
  return { success: true };
}

/**
 * @param {any} db
 * @param {string} grantId
 */
export function revokeGrantById(db, grantId) {
  db.prepare(`UPDATE ai_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(new Date().toISOString(), grantId);
  db.prepare(`DELETE FROM ai_tokens WHERE grant_id = ?`).run(grantId);
}

/**
 * Housekeeping, run with the other auth purges: expired access tokens,
 * refresh tokens already exchanged a day ago, and activity past 30 days.
 *
 * @param {any} db
 */
export function purgeExpiredAiRecords(db) {
  const now = new Date();
  db.prepare(`DELETE FROM ai_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(now.toISOString());
  db.prepare(`DELETE FROM ai_tokens WHERE kind = 'refresh' AND used_at IS NOT NULL AND used_at <= ?`).run(
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  );
  db.prepare(`DELETE FROM ai_activity WHERE created_date <= ?`).run(
    new Date(now.getTime() - ACTIVITY_RETENTION_MS).toISOString()
  );
}
