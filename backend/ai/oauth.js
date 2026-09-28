// @ts-check
/**
 * @file "Sign in with Zephyrly": the OAuth 2.1 authorization server that
 * claude.ai, ChatGPT and Gemini use to connect to /api/mcp, as the MCP
 * authorization spec lays out.
 *
 *   1. The app registers itself (RFC 7591), giving its redirect URIs.
 *   2. It sends the person to /api/oauth/authorize with a PKCE challenge.
 *      That stores the request and shows Zephyrly's consent page.
 *   3. The person signs in if needed, sees which app and where it will
 *      send them back, and allows it, with changes only if they tick it.
 *   4. The app trades the one-time code (plus the PKCE verifier) for an
 *      access token (1 hour) and a refresh token (90 days, replaced on
 *      every use).
 *
 * Public clients only: PKCE (S256) is required and there are no client
 * secrets. The only place Zephyrly redirects outside itself is back to a
 * redirect URI the app registered, matched exactly.
 *
 * Every URL here comes from config.publicAppUrl, never the Host header,
 * so it stays right behind a tunnel or proxy.
 */
import { createHash } from "node:crypto";
import { HttpError, publicOrigin } from "../http.js";
import { createOpaqueToken, sha256 } from "../auth.js";
import { aiAccessAllowed, createGrant, issueToken, revokeGrantById } from "./grants.js";
import { takeSlot } from "./rate-limit.js";

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const UNUSED_CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCOPES = ["tasks.read", "tasks.write"];
const MAX_REDIRECT_URIS = 5;
const MAX_URI_CHARS = 500;
const MAX_CLIENT_NAME_CHARS = 100;

/** An OAuth error for the token, register and revoke endpoints. */
export class OAuthError extends Error {
  /**
   * @param {number} status
   * @param {string} error  the RFC 6749 error code
   * @param {string} description
   */
  constructor(status, error, description) {
    super(description);
    this.status = status;
    this.error = error;
  }
}

/**
 * A bad /authorize request. `redirect` says whether it's safe to send the
 * person back to the app with the error (the client and redirect URI
 * checked out), or it must be shown on a Zephyrly page instead.
 */
export class AuthorizeError extends Error {
  /**
   * @param {string} error
   * @param {string} description
   * @param {{ redirectUri: string, state: string | null } | null} redirect
   */
  constructor(error, description, redirect = null) {
    super(description);
    this.error = error;
    this.redirect = redirect;
  }
}

/** @param {any} config */
export const issuer = (config) => publicOrigin(config);
/** @param {any} config */
export const resourceUrl = (config) => `${publicOrigin(config)}/api/mcp`;

/**
 * RFC 9728: where an MCP client learns who signs it in.
 * @param {any} config
 */
export function protectedResourceMetadata(config) {
  return {
    resource: resourceUrl(config),
    authorization_servers: [issuer(config)],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Zephyrly",
  };
}

/**
 * RFC 8414.
 * @param {any} config
 */
export function authorizationServerMetadata(config) {
  const base = issuer(config);
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * The value WWW-Authenticate carries on a 401 from /api/mcp.
 * @param {any} config
 */
export function bearerChallenge(config) {
  return `Bearer resource_metadata="${issuer(config)}/.well-known/oauth-protected-resource", scope="tasks.read"`;
}

/**
 * https anywhere, or http on this machine (RFC 8252: native apps listen
 * on a loopback port). No fragments, nothing else.
 * @param {unknown} value
 */
function isAcceptableRedirectUri(value) {
  if (typeof value !== "string" || value.length > MAX_URI_CHARS) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

/**
 * Loopback redirect URIs may use any port (RFC 8252 §7.3); everything
 * else must match what was registered exactly.
 * @param {string} registered
 * @param {string} given
 */
function redirectUriMatches(registered, given) {
  if (registered === given) return true;
  try {
    const a = new URL(registered);
    const b = new URL(given);
    const loopback = a.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(a.hostname);
    return loopback && a.hostname === b.hostname && a.protocol === b.protocol && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/**
 * RFC 7591 dynamic client registration.
 * @param {any} db
 * @param {{ body: any, ip: string }} input
 */
export function registerClient(db, { body, ip }) {
  if (!takeSlot(`oauth-register:${ip}`, 20, 60 * 60 * 1000).ok) {
    throw new OAuthError(429, "slow_down", "Too many registrations from here; try again later.");
  }
  const input = body && typeof body === "object" ? body : {};
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris : [];
  if (!uris.length || uris.length > MAX_REDIRECT_URIS || !uris.every(isAcceptableRedirectUri)) {
    throw new OAuthError(
      400,
      "invalid_redirect_uri",
      `Give 1 to ${MAX_REDIRECT_URIS} redirect URIs, each https or http on 127.0.0.1/localhost, without a fragment.`
    );
  }
  const grantTypes = Array.isArray(input.grant_types) ? input.grant_types : ["authorization_code"];
  if (!grantTypes.every((/** @type {unknown} */ g) => g === "authorization_code" || g === "refresh_token")) {
    throw new OAuthError(400, "invalid_client_metadata", "Only authorization_code and refresh_token grants are supported.");
  }
  const name =
    String(input.client_name ?? "")
      .replace(/\p{Cc}/gu, " ")
      .trim()
      .slice(0, MAX_CLIENT_NAME_CHARS) || "An AI app";
  const clientId = `zcl_${createOpaqueToken(18)}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris_json, created_date) VALUES (?, ?, ?, ?)`).run(
    clientId,
    name,
    JSON.stringify(uris),
    now
  );
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.parse(now) / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    // Whatever was asked for: public clients with PKCE, no secret.
    token_endpoint_auth_method: "none",
  };
}

/**
 * @param {any} db
 * @param {string} clientId
 */
function getClient(db, clientId) {
  const row = db.prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`).get(String(clientId || ""));
  return row ? { ...row, redirect_uris: JSON.parse(row.redirect_uris_json) } : null;
}

/**
 * The scopes asked for, keeping only ones Zephyrly has.
 * @param {unknown} scope
 */
function parseScope(scope) {
  return String(scope || "")
    .split(/\s+/)
    .filter((s) => SCOPES.includes(s));
}

/**
 * Check an /authorize request and store it for the consent page.
 * Returns the id the consent page is opened with.
 *
 * @param {any} db
 * @param {any} config
 * @param {{ query: URLSearchParams, ip: string }} input
 */
export function startAuthorization(db, config, { query, ip }) {
  const client = getClient(db, query.get("client_id"));
  if (!client) throw new AuthorizeError("invalid_client", "This app isn't registered with Zephyrly.");
  const redirectUri = String(query.get("redirect_uri") || "");
  if (!client.redirect_uris.some((/** @type {string} */ registered) => redirectUriMatches(registered, redirectUri))) {
    throw new AuthorizeError("invalid_request", "The address this app wants to return to isn't one it registered.");
  }
  const state = query.get("state");
  const back = { redirectUri, state };
  if (!takeSlot(`oauth-authorize:${ip}`, 60, 60 * 60 * 1000).ok) {
    throw new AuthorizeError("temporarily_unavailable", "Too many sign-in attempts from here; try again later.", back);
  }
  if (query.get("response_type") !== "code") {
    throw new AuthorizeError("unsupported_response_type", "Only response_type=code is supported.", back);
  }
  const challenge = String(query.get("code_challenge") || "");
  if (query.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    throw new AuthorizeError("invalid_request", "PKCE with code_challenge_method=S256 is required.", back);
  }
  const resource = query.get("resource");
  if (resource && resource.replace(/\/$/, "") !== resourceUrl(config)) {
    throw new AuthorizeError("invalid_target", `The only resource here is ${resourceUrl(config)}.`, back);
  }
  if (state && state.length > 1000) throw new AuthorizeError("invalid_request", "state is too long.", back);

  const id = createOpaqueToken(24);
  const now = Date.now();
  db.prepare(
    `INSERT INTO oauth_requests (id, app_id, client_id, redirect_uri, state, code_challenge, scope, resource, expires_at, created_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    config.appId,
    client.client_id,
    redirectUri,
    state,
    challenge,
    parseScope(query.get("scope")).join(" "),
    resource ? resourceUrl(config) : null,
    new Date(now + REQUEST_TTL_MS).toISOString(),
    new Date(now).toISOString()
  );
  db.prepare(`UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?`).run(new Date(now).toISOString(), client.client_id);
  return id;
}

/**
 * @param {any} db
 * @param {string} appId
 * @param {string} id
 */
function getPendingRequest(db, appId, id) {
  const row = db
    .prepare(`SELECT * FROM oauth_requests WHERE id = ? AND app_id = ? AND code_hash IS NULL AND expires_at > ?`)
    .get(String(id || ""), appId, new Date().toISOString());
  if (!row) throw new HttpError(404, "This sign-in has expired or was already used. Start again from the app.", "not_found");
  return row;
}

/**
 * What the consent page shows.
 * @param {any} db
 * @param {any} config
 * @param {{ id: string }} input
 */
export function describeRequest(db, config, { id }) {
  const request = getPendingRequest(db, config.appId, id);
  const client = getClient(db, request.client_id);
  return {
    client_name: client?.client_name || "An AI app",
    redirect_host: new URL(request.redirect_uri).host,
    wants_changes: request.scope.split(" ").includes("tasks.write"),
  };
}

/**
 * @param {string} redirectUri
 * @param {Record<string, string | null | undefined>} params
 */
function withParams(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The person's answer on the consent page. Returns where to send them:
 * back to the app, with a code or with access_denied.
 *
 * @param {any} db
 * @param {any} config
 * @param {{ id: string, user: any, approve: boolean, canWrite: boolean, timeZone?: string }} input
 */
export function decideRequest(db, config, { id, user, approve, canWrite, timeZone }) {
  const request = getPendingRequest(db, config.appId, id);
  const iss = issuer(config);
  if (!approve) {
    db.prepare(`DELETE FROM oauth_requests WHERE id = ?`).run(request.id);
    return { redirect_to: withParams(request.redirect_uri, { error: "access_denied", state: request.state, iss }) };
  }
  if (!aiAccessAllowed(user)) throw new HttpError(403, "AI apps aren't available on this account.", "ai_not_allowed");
  const client = getClient(db, request.client_id);

  // Signing the same app in again updates its one connection rather than
  // listing it twice.
  const existing = db
    .prepare(`SELECT * FROM ai_grants WHERE app_id = ? AND user_id = ? AND client_id = ? AND revoked_at IS NULL`)
    .get(config.appId, user.id, request.client_id);
  let grantId = existing?.id;
  if (existing) {
    db.prepare(`UPDATE ai_grants SET can_write = ?, time_zone = COALESCE(?, time_zone) WHERE id = ?`).run(canWrite ? 1 : 0, timeZone || null, existing.id);
  } else {
    grantId = createGrant(db, {
      appId: config.appId,
      userId: user.id,
      kind: "oauth",
      label: client?.client_name || "An AI app",
      clientId: request.client_id,
      canWrite,
      timeZone,
    }).id;
  }

  const code = createOpaqueToken(32);
  db.prepare(`UPDATE oauth_requests SET user_id = ?, grant_id = ?, code_hash = ?, expires_at = ? WHERE id = ?`).run(
    user.id,
    grantId,
    sha256(code),
    new Date(Date.now() + CODE_TTL_MS).toISOString(),
    request.id
  );
  return { redirect_to: withParams(request.redirect_uri, { code, state: request.state, iss }) };
}

/**
 * @param {any} db
 * @param {string} grantId
 */
function issueTokens(db, grantId) {
  const grant = db.prepare(`SELECT can_write FROM ai_grants WHERE id = ?`).get(grantId);
  return {
    access_token: issueToken(db, { grantId, kind: "access", ttlMs: ACCESS_TOKEN_TTL_MS }),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: issueToken(db, { grantId, kind: "refresh", ttlMs: REFRESH_TOKEN_TTL_MS }),
    scope: grant?.can_write ? "tasks.read tasks.write" : "tasks.read",
  };
}

/**
 * The token endpoint.
 * @param {any} db
 * @param {any} config
 * @param {{ form: Record<string, string>, ip: string }} input
 */
export function exchangeToken(db, config, { form, ip }) {
  if (!takeSlot(`oauth-token:${ip}`, 60, 60 * 1000).ok) {
    throw new OAuthError(429, "slow_down", "Too many token requests from here; try again shortly.");
  }
  if (form.grant_type === "authorization_code") return exchangeCode(db, config, form);
  if (form.grant_type === "refresh_token") return exchangeRefresh(db, config, form);
  throw new OAuthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/**
 * @param {any} db
 * @param {any} config
 * @param {Record<string, string>} form
 */
function exchangeCode(db, config, form) {
  const bad = () => new OAuthError(400, "invalid_grant", "The code is invalid, expired or already used.");
  if (!form.code || !form.code_verifier) throw new OAuthError(400, "invalid_request", "code and code_verifier are required.");
  const request = db.prepare(`SELECT * FROM oauth_requests WHERE code_hash = ? AND app_id = ?`).get(sha256(form.code), config.appId);
  if (!request) throw bad();
  if (request.code_used_at) {
    // A code presented twice may have been stolen: end what it started.
    revokeGrantById(db, request.grant_id);
    throw bad();
  }
  db.prepare(`UPDATE oauth_requests SET code_used_at = ? WHERE id = ?`).run(new Date().toISOString(), request.id);
  if (request.expires_at <= new Date().toISOString()) throw bad();
  if (form.client_id !== request.client_id) throw bad();
  if (form.redirect_uri && form.redirect_uri !== request.redirect_uri) throw bad();
  const verifierHash = createHash("sha256").update(form.code_verifier).digest("base64url");
  if (verifierHash !== request.code_challenge) throw bad();
  if (form.resource && form.resource.replace(/\/$/, "") !== resourceUrl(config)) {
    throw new OAuthError(400, "invalid_target", `The only resource here is ${resourceUrl(config)}.`);
  }
  const grant = db.prepare(`SELECT * FROM ai_grants WHERE id = ? AND revoked_at IS NULL`).get(request.grant_id);
  if (!grant) throw bad();
  return issueTokens(db, grant.id);
}

/**
 * @param {any} db
 * @param {any} config
 * @param {Record<string, string>} form
 */
function exchangeRefresh(db, config, form) {
  const bad = () => new OAuthError(400, "invalid_grant", "The refresh token is invalid, expired or already used.");
  if (!form.refresh_token) throw new OAuthError(400, "invalid_request", "refresh_token is required.");
  const row = db
    .prepare(
      `SELECT ai_tokens.*, ai_grants.client_id, ai_grants.revoked_at, ai_grants.app_id
       FROM ai_tokens JOIN ai_grants ON ai_grants.id = ai_tokens.grant_id
       WHERE ai_tokens.token_hash = ? AND ai_tokens.kind = 'refresh'`
    )
    .get(sha256(form.refresh_token));
  if (!row || row.app_id !== config.appId || row.revoked_at) throw bad();
  if (row.used_at) {
    // Rotation: a refresh token works once. Seeing one again means two
    // parties hold it, so neither keeps access.
    revokeGrantById(db, row.grant_id);
    throw bad();
  }
  if (row.expires_at && row.expires_at <= new Date().toISOString()) throw bad();
  if (form.client_id && form.client_id !== row.client_id) throw bad();
  db.prepare(`UPDATE ai_tokens SET used_at = ? WHERE token_hash = ?`).run(new Date().toISOString(), row.token_hash);
  return issueTokens(db, row.grant_id);
}

/**
 * RFC 7009. Revoking any of a connection's tokens disconnects it — what an
 * app means when it signs out. Unknown tokens are fine (200 either way).
 * @param {any} db
 * @param {{ form: Record<string, string> }} input
 */
export function revokeToken(db, { form }) {
  if (!form.token) return;
  const row = db.prepare(`SELECT grant_id FROM ai_tokens WHERE token_hash = ?`).get(sha256(form.token));
  if (row) revokeGrantById(db, row.grant_id);
}

/**
 * Housekeeping: expired sign-ins, and registrations nobody has used for a
 * week that never became a connection.
 * @param {any} db
 */
export function purgeExpiredOAuthRecords(db) {
  const now = Date.now();
  db.prepare(`DELETE FROM oauth_requests WHERE expires_at <= ?`).run(new Date(now).toISOString());
  db.prepare(
    `DELETE FROM oauth_clients
     WHERE COALESCE(last_used_at, created_date) <= ?
       AND NOT EXISTS (SELECT 1 FROM ai_grants WHERE ai_grants.client_id = oauth_clients.client_id AND ai_grants.revoked_at IS NULL)`
  ).run(new Date(now - UNUSED_CLIENT_TTL_MS).toISOString());
}
