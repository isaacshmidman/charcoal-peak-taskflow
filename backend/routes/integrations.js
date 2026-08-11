// @ts-check
/**
 * @file Integration routes — Google connect/callback, Apple connect,
 * disconnect, manual sync, calendar list/enable/primary/color/set-default.
 *
 * All routes under /api/apps/:appId/integrations/* except the Google
 * OAuth callback are gated by `requireAuthenticatedUser`. The callback
 * itself still requires a session match (enforced inside
 * completeGoogleConnect against the oauth_states row's user_id).
 */
import { HttpError, readJsonBody, redirect, sendJson } from "../http.js";
import { requireAuthenticatedUser } from "../auth.js";
import {
  completeGoogleConnect,
  connectApple,
  disconnectIntegration,
  getIntegrationForUser,
  listIntegrationsForUser,
  startGoogleConnect,
  refreshIntegrationCalendars,
  listIntegrationCalendars,
  setEnabledCalendars,
  setCalendarItemKind,
  setDefaultIntegration,
  setPrimaryCalendar,
  setCalendarColor,
} from "../integrations.js";
import { syncIntegration } from "../sync.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleIntegrationsRoute(request, response, { config, db, url, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps") return false;
  const appId = segments[2];
  if (!appId || appId !== config.appId) return false;
  if (segments[3] !== "integrations") return false;

  // Google OAuth callback is the only integration route allowed to
  // run WITHOUT a matching session — it's a browser redirect from
  // Google. We still require that the current browser session
  // belongs to the user_id recorded in oauth_states (enforced in
  // completeGoogleConnect).
  if (
    request.method === "GET" &&
    segments[4] === "google" &&
    segments[5] === "callback"
  ) {
    const user = requireAuthenticatedUser(db, config, request, appId);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      const back = new URL("/Settings", config.publicAppUrl);
      back.searchParams.set("integration_error", errorParam);
      redirect(response, back.toString());
      return true;
    }
    if (!state || !code) {
      throw new HttpError(400, "Missing state or code.", "invalid_callback");
    }
    const { redirectTo } = await completeGoogleConnect(db, config, { user, state, code });
    const redirectUrl = new URL(redirectTo || "/Settings", config.publicAppUrl);
    if (!redirectUrl.hash) redirectUrl.hash = "calendar-integrations";
    redirect(response, redirectUrl.toString());
    return true;
  }

  // All other integration routes require an authenticated user.
  const user = requireAuthenticatedUser(db, config, request, appId);

  // GET /api/apps/:appId/integrations
  if (request.method === "GET" && segments.length === 4) {
    sendJson(response, 200, {
      integrations: listIntegrationsForUser(db, { appId, userId: user.id }),
    });
    return true;
  }

  // GET /api/apps/:appId/integrations/google/connect
  if (
    request.method === "GET" &&
    segments[4] === "google" &&
    segments[5] === "connect"
  ) {
    const fromUrl = url.searchParams.get("from_url") || "/Settings";
    const { authUrl } = startGoogleConnect(db, config, { user, appId, fromUrl });
    const wantsJson = (request.headers.accept || "").includes("application/json");
    if (wantsJson) {
      sendJson(response, 200, { redirect_url: authUrl });
    } else {
      redirect(response, authUrl);
    }
    return true;
  }

  // POST /api/apps/:appId/integrations/apple/connect
  if (
    request.method === "POST" &&
    segments[4] === "apple" &&
    segments[5] === "connect"
  ) {
    const body = (await readJsonBody(request)) || {};
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    await connectApple(db, config, { user, appId, email, password });
    sendJson(response, 200, { success: true });
    return true;
  }

  // DELETE /api/apps/:appId/integrations/:id
  if (request.method === "DELETE" && segments[4] && !segments[5]) {
    await disconnectIntegration(db, { appId, userId: user.id, id: segments[4] });
    sendJson(response, 200, { success: true });
    return true;
  }

  // POST /api/apps/:appId/integrations/:id/sync
  if (request.method === "POST" && segments[4] && segments[5] === "sync") {
    const row = getIntegrationForUser(db, { appId, userId: user.id, id: segments[4] });
    if (!row) throw new HttpError(404, "Integration not found.", "not_found");
    await syncIntegration(db, config, row);
    sendJson(response, 200, { success: true });
    return true;
  }

  // GET /api/apps/:appId/integrations/:id/calendars
  if (request.method === "GET" && segments[4] && segments[5] === "calendars") {
    const row = getIntegrationForUser(db, { appId, userId: user.id, id: segments[4] });
    if (!row) throw new HttpError(404, "Integration not found.", "not_found");
    let calendars;
    try {
      calendars = await refreshIntegrationCalendars(db, config, row);
    } catch (err) {
      calendars = listIntegrationCalendars(db, row.id);
      if (!calendars.length) throw err;
    }
    sendJson(response, 200, { calendars });
    return true;
  }

  // PUT /api/apps/:appId/integrations/:id/calendars
  if (request.method === "PUT" && segments[4] && segments[5] === "calendars") {
    const row = getIntegrationForUser(db, { appId, userId: user.id, id: segments[4] });
    if (!row) throw new HttpError(404, "Integration not found.", "not_found");
    const body = (await readJsonBody(request)) || {};
    const updates = (body && typeof body.updates === "object" && body.updates) || {};
    /** @type {Record<string, boolean>} */
    const sanitized = {};
    for (const [k, v] of Object.entries(updates)) {
      if (typeof v === "boolean") sanitized[k] = v;
    }
    setEnabledCalendars(db, row.id, sanitized);

    // Tasks/Events choice rides the same PUT so one Save in the Configure
    // modal writes both. Applied AFTER the enable/disable pass, which
    // deletes imported events when a calendar is switched off — running it
    // first would re-stamp rows that are about to disappear.
    const itemKinds = (body && typeof body.item_kinds === "object" && body.item_kinds) || {};
    for (const [extId, kind] of Object.entries(itemKinds)) {
      if (kind !== "task" && kind !== "event") continue;
      const result = setCalendarItemKind(db, row.id, extId, kind);
      if (!result.ok && result.reason === "read_only") {
        throw new HttpError(
          400,
          "Read-only calendars can't hold tasks — Zephyrly can't write changes back to them.",
          "invalid_request"
        );
      }
    }

    sendJson(response, 200, { calendars: listIntegrationCalendars(db, row.id) });
    return true;
  }

  // POST /api/apps/:appId/integrations/:id/set-default
  if (request.method === "POST" && segments[4] && segments[5] === "set-default") {
    setDefaultIntegration(db, { appId, userId: user.id, integrationId: segments[4] });
    sendJson(response, 200, {
      integrations: listIntegrationsForUser(db, { appId, userId: user.id }),
    });
    return true;
  }

  // POST /api/apps/:appId/integrations/:id/primary-calendar
  if (request.method === "POST" && segments[4] && segments[5] === "primary-calendar") {
    const body = (await readJsonBody(request)) || {};
    const externalCalendarId = String(body.external_calendar_id || "");
    if (!externalCalendarId) {
      throw new HttpError(400, "external_calendar_id is required.", "invalid_request");
    }
    setPrimaryCalendar(db, {
      appId,
      userId: user.id,
      integrationId: segments[4],
      externalCalendarId,
    });
    sendJson(response, 200, {
      calendars: listIntegrationCalendars(db, segments[4]),
      integrations: listIntegrationsForUser(db, { appId, userId: user.id }),
    });
    return true;
  }

  // POST /api/apps/:appId/integrations/:id/calendar-color
  if (request.method === "POST" && segments[4] && segments[5] === "calendar-color") {
    const body = (await readJsonBody(request)) || {};
    const externalCalendarId = String(body.external_calendar_id || "");
    const colorHex = String(body.color_hex || "");
    if (!externalCalendarId) {
      throw new HttpError(400, "external_calendar_id is required.", "invalid_request");
    }
    await setCalendarColor(db, config, {
      appId,
      userId: user.id,
      integrationId: segments[4],
      externalCalendarId,
      colorHex,
    });
    sendJson(response, 200, { calendars: listIntegrationCalendars(db, segments[4]) });
    return true;
  }

  throw new HttpError(404, "Route not found.", "not_found");
}
