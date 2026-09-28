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
 *   GET    /api/apps/:appId/ai/connect/:id          consent page: what's asking
 *   POST   /api/apps/:appId/ai/connect/:id          { approve, can_write, time_zone }
 *
 *   "Sign in with Zephyrly" (backend/ai/oauth.js), no credentials:
 *   GET    /.well-known/oauth-protected-resource[/api/mcp]
 *   GET    /.well-known/oauth-authorization-server
 *   POST   /api/oauth/register                      dynamic client registration
 *   GET    /api/oauth/authorize                     → the consent page
 *   POST   /api/oauth/token
 *   POST   /api/oauth/revoke
 *
 * The halves use different credentials on purpose: /api/mcp takes only
 * AI tokens, and the Settings and consent routes only a signed-in session,
 * so an AI app can never manage its own access.
 */
import { HttpError, publicOrigin, readFormBody, readJsonBody, redirect, sendError, sendJson } from "../http.js";
import { getRequestIpAddress, requireAuthenticatedUser } from "../auth.js";
import { MAX_AI_BODY_BYTES } from "../limits.js";
import { createPersonalToken, listGrants, requireAiGrant, revokeGrant, setGrantCanWrite } from "../ai/grants.js";
import { listActivity, undoActivity } from "../ai/activity.js";
import { PARSE_ERROR_REPLY, PROTOCOL_VERSIONS, answerMcpBody, rpcError } from "../ai/mcp.js";
import { REQUESTS_PER_MINUTE, takeSlot } from "../ai/rate-limit.js";
import {
  AuthorizeError,
  OAuthError,
  authorizationServerMetadata,
  bearerChallenge,
  decideRequest,
  describeRequest,
  exchangeToken,
  issuer,
  protectedResourceMetadata,
  registerClient,
  revokeToken,
  startAuthorization,
} from "../ai/oauth.js";

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
  if (url.pathname.startsWith("/.well-known/") || url.pathname.startsWith("/api/oauth/")) {
    await handleOAuth(request, response, { config, db, url });
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
  if (resource === "connect" && id && !action) {
    if (request.method === "GET") {
      sendJson(response, 200, describeRequest(db, config, { id }));
      return true;
    }
    if (request.method === "POST") {
      const body = (await readJsonBody(request)) || {};
      const decision = decideRequest(db, config, {
        id,
        user,
        approve: body.approve === true,
        canWrite: body.can_write === true,
        timeZone: typeof body.time_zone === "string" ? body.time_zone : undefined,
      });
      sendJson(response, 200, decision);
      return true;
    }
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
      const presented = String(request.headers.authorization || "").startsWith("Bearer ");
      sendJson(
        response,
        401,
        { message: error.message, code: error.code },
        { "WWW-Authenticate": `${bearerChallenge(config)}${presented ? ', error="invalid_token"' : ""}` }
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

/**
 * Metadata is public and read by apps' own code, sometimes from a browser.
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} data
 */
function sendMetadata(response, data) {
  sendJson(response, 200, data, { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" });
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} error
 */
function sendOAuthError(response, error) {
  if (error instanceof OAuthError) {
    sendJson(response, error.status, { error: error.error, error_description: error.message }, { Pragma: "no-cache" });
    return;
  }
  sendError(response, error);
}

/** @param {string} text */
const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);

/**
 * A sign-in link that can't be sent back to the app it came from (unknown
 * app, or an address it never registered) ends on this page instead.
 * @param {import("node:http").ServerResponse} response
 * @param {string} message
 */
function sendAuthorizeErrorPage(response, message) {
  response.writeHead(400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Zephyrly</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 15vh auto; padding: 0 1rem; color: #0f172a">
<h1 style="font-size: 1.1rem">This sign-in link can't be used</h1>
<p>${escapeHtml(message)}</p>
<p style="color: #64748b">Go back to the app you came from and try connecting Zephyrly again.</p>
</body></html>`);
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL }} env
 */
async function handleOAuth(request, response, { config, db, url }) {
  const path = url.pathname;
  const ip = getRequestIpAddress(request);
  try {
    if (request.method === "GET" && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/api/mcp")) {
      sendMetadata(response, protectedResourceMetadata(config));
      return;
    }
    if (request.method === "GET" && path === "/.well-known/oauth-authorization-server") {
      sendMetadata(response, authorizationServerMetadata(config));
      return;
    }
    if (request.method === "POST" && path === "/api/oauth/register") {
      const body = await readJsonBody(request);
      sendJson(response, 201, registerClient(db, { body, ip }));
      return;
    }
    if (request.method === "GET" && path === "/api/oauth/authorize") {
      try {
        const id = startAuthorization(db, config, { query: url.searchParams, ip });
        redirect(response, `${publicOrigin(config)}/connect/${encodeURIComponent(id)}`);
      } catch (error) {
        if (!(error instanceof AuthorizeError)) throw error;
        if (!error.redirect) {
          sendAuthorizeErrorPage(response, error.message);
          return;
        }
        const back = new URL(error.redirect.redirectUri);
        back.searchParams.set("error", error.error);
        back.searchParams.set("error_description", error.message);
        if (error.redirect.state != null) back.searchParams.set("state", error.redirect.state);
        back.searchParams.set("iss", issuer(config));
        redirect(response, back.toString());
      }
      return;
    }
    if (request.method === "POST" && path === "/api/oauth/token") {
      const form = await readFormBody(request);
      sendJson(response, 200, exchangeToken(db, config, { form, ip }), { Pragma: "no-cache" });
      return;
    }
    if (request.method === "POST" && path === "/api/oauth/revoke") {
      revokeToken(db, { form: await readFormBody(request) });
      response.writeHead(200, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    sendJson(response, 404, { message: "Route not found.", code: "not_found" });
  } catch (error) {
    sendOAuthError(response, error);
  }
}
