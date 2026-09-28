// @ts-check
/**
 * @file Routes for AI apps.
 *
 *   POST   /api/mcp                                 MCP (Streamable HTTP), AI token
 *   GET    /api/apps/:appId/ai/grants               connected apps, signed-in user
 *   POST   /api/apps/:appId/ai/tokens               new personal token (shown once)
 *   PUT    /api/apps/:appId/ai/grants/:id           { can_write }
 *   DELETE /api/apps/:appId/ai/grants/:id           revoke
 *   GET    /api/apps/:appId/ai/activity             what AI apps changed
 *   POST   /api/apps/:appId/ai/activity/:id/undo
 *
 * The two halves use different credentials on purpose: /api/mcp takes
 * only AI tokens, and the Settings routes only a signed-in session, so
 * an AI app can never manage its own access.
 */
import { HttpError, publicOrigin, readJsonBody, sendError, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import { MAX_AI_BODY_BYTES } from "../limits.js";
import { createPersonalToken, listGrants, requireAiGrant, revokeGrant, setGrantCanWrite } from "../ai/grants.js";
import { listActivity, undoActivity } from "../ai/activity.js";
import { PARSE_ERROR_REPLY, PROTOCOL_VERSIONS, answerMcpBody, rpcError } from "../ai/mcp.js";
import { REQUESTS_PER_MINUTE, takeSlot } from "../ai/rate-limit.js";

/**
 * @param {any} config
 */
export function mcpUrl(config) {
  return `${publicOrigin(config)}/api/mcp`;
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleAiRoute(request, response, { config, db, url, segments }) {
  if (url.pathname === "/api/mcp") {
    await handleMcp(request, response, { config, db });
    return true;
  }
  if (segments[0] !== "api" || segments[1] !== "apps" || segments[2] !== config.appId || segments[3] !== "ai") return false;

  const appId = config.appId;
  const user = requireAuthenticatedUser(db, config, request, appId);
  const [resource, id, action] = segments.slice(4);

  if (request.method === "GET" && resource === "grants" && !id) {
    sendJson(response, 200, { grants: listGrants(db, { appId, userId: user.id }), mcp_url: mcpUrl(config) });
    return true;
  }
  if (request.method === "POST" && resource === "tokens" && !id) {
    const body = (await readJsonBody(request)) || {};
    const created = createPersonalToken(db, { appId, user, label: body.label, canWrite: body.can_write, timeZone: body.time_zone });
    sendJson(response, 201, { ...created, mcp_url: mcpUrl(config) });
    return true;
  }
  if (resource === "grants" && id && !action) {
    if (request.method === "PUT") {
      const body = (await readJsonBody(request)) || {};
      sendJson(response, 200, setGrantCanWrite(db, { appId, userId: user.id, grantId: id, canWrite: body.can_write }));
      return true;
    }
    if (request.method === "DELETE") {
      sendJson(response, 200, revokeGrant(db, { appId, userId: user.id, grantId: id }));
      return true;
    }
  }
  if (request.method === "GET" && resource === "activity" && !id) {
    sendJson(response, 200, { activity: listActivity(db, { appId, userId: user.id }) });
    return true;
  }
  if (request.method === "POST" && resource === "activity" && id && action === "undo") {
    sendJson(response, 200, undoActivity(db, config, { appId, user, activityId: id }));
    return true;
  }
  throw new HttpError(404, "Route not found.", "not_found");
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any }} env
 */
async function handleMcp(request, response, { config, db }) {
  // A web page can't be used to drive this with someone's token: browsers
  // send Origin, and only Zephyrly's own is accepted (MCP asks servers to
  // check it, against DNS rebinding). AI apps call from their servers or
  // from native code, which send none.
  const origin = request.headers.origin;
  if (origin && origin !== publicOrigin(config)) {
    sendJson(response, 403, { message: "Requests from web pages aren't accepted here.", code: "forbidden_origin" });
    return;
  }
  if (request.method !== "POST") {
    // No server-sent event stream and no sessions to end.
    response.writeHead(405, { Allow: "POST", "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ message: "Use POST.", code: "method_not_allowed" }));
    return;
  }
  const version = request.headers["mcp-protocol-version"];
  if (typeof version === "string" && !PROTOCOL_VERSIONS.includes(version)) {
    sendJson(response, 400, { message: `Unsupported MCP protocol version ${version}.`, code: "unsupported_protocol_version" });
    return;
  }

  /** @type {{ grant: any, user: any }} */
  let found;
  try {
    found = requireAiGrant(db, config, request);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      sendJson(
        response,
        401,
        { message: error.message, code: error.code },
        { "WWW-Authenticate": `Bearer error="invalid_token", error_description="A Zephyrly token for AI apps is required"` }
      );
      return;
    }
    throw error;
  }

  const slot = takeSlot(`request:${found.grant.id}`, REQUESTS_PER_MINUTE, 60_000);
  if (!slot.ok) {
    sendJson(
      response,
      429,
      { message: "Too many requests; slow down.", code: "rate_limited" },
      { "Retry-After": String(Math.ceil(slot.retryAfterMs / 1000)) }
    );
    return;
  }

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: MAX_AI_BODY_BYTES });
  } catch (error) {
    if (error instanceof HttpError && error.code === "invalid_json") {
      sendJson(response, 400, PARSE_ERROR_REPLY);
      return;
    }
    sendError(response, error);
    return;
  }

  if (!body || typeof body !== "object") {
    sendJson(response, 400, rpcError(null, -32600, "Send a JSON-RPC message."));
    return;
  }
  const reply = await answerMcpBody(body, { db, config, found });
  if (!reply) {
    response.writeHead(202, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  sendJson(response, 200, reply);
}
