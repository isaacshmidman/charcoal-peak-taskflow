// @ts-check
/**
 * Google Calendar API provider.
 *
 * Scopes requested:
 *   - https://www.googleapis.com/auth/calendar.events
 *       Read/write events on calendars the user owns or has been given
 *       access to. We do NOT request `calendar` (calendar list management).
 *   - https://www.googleapis.com/auth/calendar.calendars.readonly
 *   - https://www.googleapis.com/auth/calendar.calendarlist.readonly
 *       Read calendar metadata/list rows so the user can choose which
 *       calendars to sync without granting full calendar management.
 *   - openid email profile
 *       So we can identify which Google account was connected and show it
 *       to the user in Settings.
 *
 * Google treats `calendar.events` as a "sensitive" scope. For an
 * unverified app this means only users listed as test users in the Google
 * Cloud Console can consent. Production use requires a Google verification
 * process (scope justification, privacy policy URL, YouTube demo video).
 *
 * NEVER log tokens. Errors returned from this module redact them.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getGoogleCalendarRedirectUrl } from "../config.js";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_META_SCOPE = "https://www.googleapis.com/auth/calendar.calendars.readonly";
const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const IDENTITY_SCOPES = "openid email profile";
export const GOOGLE_CALENDAR_SCOPES = `${CALENDAR_SCOPE} ${CALENDAR_META_SCOPE} ${CALENDAR_LIST_SCOPE} ${IDENTITY_SCOPES}`;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const EVENTS_URL = (calId) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

/**
 * Build the consent URL and an accompanying oauth_states row payload.
 * The caller must persist the state row (with `kind='integration'` and
 * `user_id=<requesting user>`) before redirecting the browser.
 *
 * @param {import("../config.js").backendConfig} config
 * @param {{ userId: string, appId: string, fromUrl: string }} ctx
 */
export function buildAuthUrl(config, { userId, appId, fromUrl }) {
  if (!config.hasGoogleCalendarCredentials) {
    throw new Error("Google Calendar credentials are not configured");
  }

  const stateId = `intg_${randomUUID()}`;
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", config.googleCalendarClientId);
  url.searchParams.set("redirect_uri", getGoogleCalendarRedirectUrl(config));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES);
  url.searchParams.set("state", stateId);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline"); // we need a refresh token
  url.searchParams.set("prompt", "consent"); // force refresh-token re-issue
  url.searchParams.set("include_granted_scopes", "true");

  return {
    authUrl: url.toString(),
    stateRow: {
      id: stateId,
      app_id: appId,
      provider: "google",
      from_url: fromUrl,
      code_verifier: codeVerifier,
      kind: "integration",
      user_id: userId,
    },
  };
}

/**
 * Exchange the authorization code for tokens + account info.
 *
 * @param {import("../config.js").backendConfig} config
 * @param {{ code: string, codeVerifier: string }} ctx
 * @returns {Promise<{
 *   accessToken: string,
 *   refreshToken: string | null,
 *   expiresAt: string,
 *   scope: string,
 *   account: { sub: string, email: string, name: string }
 * }>}
 */
export async function exchangeCode(config, { code, codeVerifier }) {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleCalendarClientId,
      client_secret: config.googleCalendarClientSecret,
      redirect_uri: getGoogleCalendarRedirectUrl(config),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Google token exchange failed (${resp.status}): ${redact(body)}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error("Google token response missing access_token");

  const scope = String(data.scope || "");
  const grantedScopes = new Set(scope.split(/\s+/).filter(Boolean));
  const requiredScopes = [CALENDAR_SCOPE, CALENDAR_META_SCOPE, CALENDAR_LIST_SCOPE];
  const missingScopes = requiredScopes.filter((required) => !grantedScopes.has(required));
  if (missingScopes.length) {
    throw new Error(
      "User did not grant all required Google Calendar scopes — cannot sync. Ask the user to retry and accept all requested permissions."
    );
  }

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();

  // Look up identity (sub + email) so we can name the connection in Settings.
  const userResp = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (!userResp.ok) {
    const body = await userResp.text().catch(() => "");
    throw new Error(`Google userinfo failed (${userResp.status}): ${redact(body)}`);
  }
  const userInfo = await userResp.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt,
    scope,
    account: {
      sub: String(userInfo.sub || ""),
      email: String(userInfo.email || ""),
      name: String(userInfo.name || userInfo.given_name || ""),
    },
  };
}

/**
 * Use a refresh token to mint a new access token.
 *
 * @param {import("../config.js").backendConfig} config
 * @param {string} refreshToken
 * @returns {Promise<{ accessToken: string, expiresAt: string, refreshToken: string | null }>}
 */
export async function refreshAccessToken(config, refreshToken) {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleCalendarClientId,
      client_secret: config.googleCalendarClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    // 400 invalid_grant → user revoked access at Google. Caller should mark
    // integration as needs_reauth and stop retrying.
    const err = new Error(`Google refresh failed (${resp.status}): ${redact(body)}`);
    // @ts-expect-error — attach status for caller
    err.statusCode = resp.status;
    throw err;
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error("Refresh response missing access_token");

  return {
    accessToken: data.access_token,
    // Google sometimes rotates the refresh token; preserve the old one if not returned.
    refreshToken: data.refresh_token || null,
    expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(),
  };
}

/**
 * Revoke a token at Google. Best-effort — we still delete the local row
 * even if this fails (user has disconnected; they can revoke manually at
 * https://myaccount.google.com/permissions if needed).
 *
 * @param {string} token
 */
export async function revokeToken(token) {
  if (!token) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // ignore — best effort
  }
}

/**
 * Fetch events using an incremental sync token when available. Returns the
 * new sync token for the next call. If Google responds 410 Gone, caller
 * must drop the sync_token and re-fetch from scratch.
 *
 * Pagination is followed internally.
 *
 * @param {string} accessToken
 * @param {string} calendarId
 * @param {string | null | undefined} syncToken
 * @returns {Promise<{ events: any[], nextSyncToken: string | null, fullResync: boolean }>}
 */
export async function listEventsIncremental(accessToken, calendarId, syncToken) {
  const events = [];
  let pageToken = null;
  let nextSyncToken = null;
  let fullResync = false;

  // Safety cap so a pathological account can't spin forever.
  for (let page = 0; page < 50; page++) {
    const url = new URL(EVENTS_URL(calendarId));
    url.searchParams.set("maxResults", "250");
    // singleEvents=false gives us the master recurring series (with its
    // RRULE) instead of every expanded instance. Sync engine then maps
    // the master to a single Zephyrly task — see sync.js notes.
    url.searchParams.set("singleEvents", "false");
    if (syncToken && !pageToken) {
      url.searchParams.set("syncToken", syncToken);
    } else if (!syncToken && !pageToken) {
      // First-time sync: keep the window narrow so a freshly-connected
      // account doesn't dump hundreds of past events into the user's
      // task list. 30 days back, 90 forward.
      const now = new Date();
      const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (resp.status === 410) {
      // syncToken invalidated — caller should discard and re-sync.
      return { events: [], nextSyncToken: null, fullResync: true };
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const err = new Error(`Google events list failed (${resp.status}): ${redact(body)}`);
      // @ts-expect-error
      err.statusCode = resp.status;
      throw err;
    }

    const data = await resp.json();
    if (Array.isArray(data.items)) events.push(...data.items);
    pageToken = data.nextPageToken || null;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    if (!pageToken) break;
  }

  return { events, nextSyncToken, fullResync };
}

/**
 * Fetch calendar metadata (used to learn the primary calendar's timezone so
 * we can push timed events with the right tz). "primary" resolves to the
 * user's default calendar.
 *
 * @param {string} accessToken
 * @param {string} [calendarId]
 * @returns {Promise<{ id: string, timeZone: string, summary: string }>}
 */
export async function getCalendarMeta(accessToken, calendarId = "primary") {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`Google calendar meta failed (${resp.status}): ${redact(body)}`);
    // @ts-expect-error
    err.statusCode = resp.status;
    throw err;
  }
  const data = await resp.json();
  return {
    id: String(data.id || calendarId),
    timeZone: String(data.timeZone || "UTC"),
    summary: String(data.summary || ""),
  };
}

/**
 * List the user's calendars (CalendarList resource). Returns a normalized
 * shape with the bits we use (id, summary, color, accessRole, primary flag,
 * timezone). The caller decides which to enable.
 *
 * @param {string} accessToken
 * @returns {Promise<Array<{
 *   id: string,
 *   summary: string,
 *   description: string,
 *   timeZone: string,
 *   colorHex: string,
 *   accessRole: string,
 *   primary: boolean,
 * }>>}
 */
export async function listCalendarList(accessToken) {
  const url = "https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=true";
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`Google calendarList failed (${resp.status}): ${redact(body)}`);
    // @ts-expect-error
    err.statusCode = resp.status;
    throw err;
  }
  const data = await resp.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((c) => ({
    id: String(c.id || ""),
    summary: String(c.summaryOverride || c.summary || ""),
    description: String(c.description || ""),
    timeZone: String(c.timeZone || ""),
    // backgroundColor is the user's color override; foregroundColor is the
    // text color. We use background for the priority swatch.
    colorHex: String(c.backgroundColor || ""),
    accessRole: String(c.accessRole || "reader"),
    primary: Boolean(c.primary),
  }));
}

/**
 * Set a calendar's color for the current user. Uses Google's RGB color
 * format (`colorRgbFormat=true`), which lets us send arbitrary `#RRGGBB`
 * hex instead of being limited to the 24 fixed `colorId` palette. The
 * `foregroundColor` is required when `colorRgbFormat` is on; we send a
 * dark text color which Google contrasts against light/dark
 * backgrounds reasonably well.
 *
 * The color override is stored on `calendarList` (per-user), not on the
 * calendar itself — so it only changes what THIS user sees, leaving
 * other share recipients unaffected.
 *
 * @param {string} accessToken
 * @param {string} calendarId
 * @param {string} hex — "#RRGGBB"
 */
export async function setCalendarColor(accessToken, calendarId, hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    const err = /** @type {any} */ (new Error(`Invalid hex color: ${hex}`));
    err.statusCode = 400;
    throw err;
  }
  const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}?colorRgbFormat=true`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      backgroundColor: hex,
      foregroundColor: "#1f2937", // slate-800 — readable on most pastel backgrounds
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = /** @type {any} */ (new Error(`Google calendarList color update failed (${resp.status}): ${redact(body)}`));
    err.statusCode = resp.status;
    throw err;
  }
}

/**
 * Fetch a single event so callers can merge nested fields before patching.
 *
 * @param {string} accessToken
 * @param {string} calendarId
 * @param {string} eventId
 * @returns {Promise<any & { status: number }>}
 */
export async function getEvent(accessToken, calendarId, eventId) {
  const url = `${EVENTS_URL(calendarId)}/${encodeURIComponent(eventId)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 404 || resp.status === 410) {
    return { id: eventId, etag: "", status: resp.status };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`Google event fetch failed (${resp.status}): ${redact(body)}`);
    // @ts-expect-error
    err.statusCode = resp.status;
    throw err;
  }
  const data = await resp.json();
  return { ...data, status: resp.status };
}

/**
 * Create an event on the given calendar.
 *
 * @param {string} accessToken
 * @param {string} calendarId
 * @param {any} eventBody — Google Calendar event resource
 * @returns {Promise<{ id: string, etag: string }>}
 */
export async function createEvent(accessToken, calendarId, eventBody) {
  const resp = await fetch(EVENTS_URL(calendarId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(eventBody),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`Google event create failed (${resp.status}): ${redact(body)}`);
    // @ts-expect-error
    err.statusCode = resp.status;
    throw err;
  }
  const data = await resp.json();
  return { id: String(data.id), etag: String(data.etag || "") };
}

/**
 * Patch an event. Uses If-Match on etag when provided to detect conflicts.
 * On 404 the event was removed at Google — caller should delete its mapping
 * and, optionally, re-create.
 *
 * @param {string} accessToken
 * @param {string} calendarId
 * @param {string} eventId
 * @param {any} patch
 * @param {string} [etag]
 * @returns {Promise<{ id: string, etag: string, status: number }>}
 */
export async function updateEvent(accessToken, calendarId, eventId, patch, etag) {
  const url = `${EVENTS_URL(calendarId)}/${encodeURIComponent(eventId)}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (etag) headers["If-Match"] = etag;
  const resp = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch),
  });
  if (resp.status === 404 || resp.status === 410) {
    return { id: eventId, etag: "", status: resp.status };
  }
  if (resp.status === 412) {
    // etag mismatch — someone else edited the event. Retry without If-Match
    // so the user's latest Zephyrly edit still lands. (We still win; inbound
    // sync will reconcile anyway.)
    return updateEvent(accessToken, calendarId, eventId, patch, undefined);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`Google event update failed (${resp.status}): ${redact(body)}`);
    // @ts-expect-error
    err.statusCode = resp.status;
    throw err;
  }
  const data = await resp.json();
  return { id: String(data.id), etag: String(data.etag || ""), status: 200 };
}

/**
 * Delete an event. Returns quietly on 404/410 (already gone).
 *
 * @param {string} accessToken
 * @param {string} calendarId
 * @param {string} eventId
 */
export async function deleteEvent(accessToken, calendarId, eventId) {
  const url = `${EVENTS_URL(calendarId)}/${encodeURIComponent(eventId)}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 404 || resp.status === 410 || resp.status === 204 || resp.status === 200) {
    return;
  }
  const body = await resp.text().catch(() => "");
  const err = new Error(`Google event delete failed (${resp.status}): ${redact(body)}`);
  // @ts-expect-error
  err.statusCode = resp.status;
  throw err;
}

/**
 * Lightly mask token-looking strings in error bodies before they hit logs.
 * Not a substitute for not-logging — it's a second line of defense.
 */
function redact(text) {
  return String(text || "")
    .replace(/ya29\.[A-Za-z0-9_-]+/g, "ya29.<redacted>")
    .replace(/1\/\/[A-Za-z0-9_-]+/g, "1//<redacted>")
    .slice(0, 500); // cap length
}
