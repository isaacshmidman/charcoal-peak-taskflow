// @ts-check
/**
 * @file What every tool gets to work with: the connection, its person and
 * their time zone, and small lookups shared by the read and write tools.
 */
import { HttpError } from "../http.js";
import { getEntityRecord, listEntityRecords } from "../store.js";
import { getUserNotificationSettings } from "../notifications.js";
import { DATE_PATTERN, ToolError } from "./args.js";

export const DATE = { type: "string", pattern: DATE_PATTERN, description: "A date, YYYY-MM-DD." };

/**
 * @typedef {{ db: any, config: any, appId: string, user: any, grant: any, timeZone: string }} ToolContext
 * @typedef {{ text: string, data: any }} ToolResult
 * @typedef {{
 *   name: string, title: string, description: string, inputSchema: any,
 *   annotations: { readOnlyHint?: boolean, destructiveHint?: boolean, idempotentHint?: boolean, openWorldHint?: boolean },
 *   write: boolean,
 *   handler: (ctx: ToolContext, args: Record<string, any>) => ToolResult | Promise<ToolResult>,
 * }} Tool
 */

/**
 * The person's time zone for "today": the one the connection was made in,
 * else the one their notifications use, else UTC.
 * @param {any} db
 * @param {string} appId
 * @param {any} grant
 */
export function grantTimeZone(db, appId, grant) {
  if (grant.time_zone && grant.time_zone !== "UTC") return grant.time_zone;
  try {
    const { settings, defaulted } = getUserNotificationSettings(db, { appId, userId: grant.user_id });
    return (!defaulted && settings.timeZone) || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Every record of one kind the person owns.
 * @param {ToolContext} ctx
 * @param {string} entityName
 * @param {string} [sort]
 * @returns {any[]}
 */
export function listRecords(ctx, entityName, sort) {
  return listEntityRecords(ctx.db, { entityName, appId: ctx.appId, user: ctx.user, sort, limit: undefined, fields: undefined, query: null });
}

/**
 * @param {ToolContext} ctx
 */
export function loadTasks(ctx) {
  return listRecords(ctx, "Task");
}

/**
 * @param {ToolContext} ctx
 */
export function loadPriorities(ctx) {
  return listRecords(ctx, "Priority", "order");
}

/**
 * @param {string} value
 */
export const lower = (value) => String(value || "").toLowerCase();

/**
 * @param {any[]} priorities
 * @param {string} wanted  a name or an id
 */
export function findPriority(priorities, wanted) {
  const key = lower(wanted);
  return priorities.find((p) => p.id === wanted) || priorities.find((p) => lower(p.name) === key) || null;
}

/**
 * @param {any[]} tags
 * @param {string} wanted
 */
export const hasTag = (tags, wanted) => (tags || []).some((/** @type {string} */ t) => lower(t) === lower(wanted).replace(/^#/, ""));

/**
 * @template T
 * @param {() => T} fn
 * @param {string} message  shown instead of a 404
 * @returns {T}
 */
export function asToolError(fn, message) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw new ToolError(message);
    throw error;
  }
}

/**
 * @param {ToolContext} ctx
 * @param {string} id
 * @returns {any}
 */
export function getOwnTask(ctx, id) {
  return asToolError(() => getEntityRecord(ctx.db, { entityName: "Task", appId: ctx.appId, user: ctx.user, id }), `No task with id "${id}".`);
}

/**
 * @param {ToolContext} ctx
 * @param {string} id
 * @returns {any}
 */
export function getOwnNote(ctx, id) {
  return asToolError(() => getEntityRecord(ctx.db, { entityName: "Note", appId: ctx.appId, user: ctx.user, id }), `No note with id "${id}".`);
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{ grant: any, user: any }} found  from requireAiGrant
 * @returns {ToolContext}
 */
export function toolContext(db, config, { grant, user }) {
  return { db, config, appId: config.appId, user, grant, timeZone: grantTimeZone(db, config.appId, grant) };
}
