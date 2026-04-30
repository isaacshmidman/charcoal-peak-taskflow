// @ts-check
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backendConfig, projectRoot } from "./config.js";
import { closeDatabase, getDatabase } from "./db.js";
import { HttpError, getRequestUrl, readJsonBody, redirect, sendError, sendJson } from "./http.js";
import {
  clearSessionCookie,
  completeGoogleLogin,
  destroySession,
  getGoogleAuthUrl,
  loginWithEmailPassword,
  purgeExpiredAuthRecords,
  requireAuthenticatedUser,
} from "./auth.js";
import {
  createEntityRecord,
  deleteEntityRecord,
  getEntityRecord,
  listEntityRecords,
  updateEntityRecord,
} from "./store.js";
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
  setDefaultIntegration,
  setPrimaryCalendar,
  setCalendarColor,
} from "./integrations.js";
import { startSyncLoop, syncIntegration } from "./sync.js";
import { enqueueTaskPush } from "./push.js";

const distRoot = resolve(projectRoot, "dist");
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function parsePath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  return segments;
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseQueryFilter(searchParams) {
  const raw = searchParams.get("q");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "The q parameter must be valid JSON.", "invalid_query");
  }
}

function getPublicSettings(config) {
  return {
    id: `public-settings-${config.appId}`,
    app_id: config.appId,
    name: config.appName,
    auth_providers: {
      // Email/password login is only meaningful when open-access mode is on,
      // since there is no real signup flow — accounts are auto-created on login.
      // When allowAnyPassword is false, the frontend hides the form and the
      // backend rejects attempts (no user has a password_hash set).
      email_password: config.allowAnyPassword === true,
      google: config.googleMode === "oauth",
    },
    deleted_task_retention_days: config.deletedTaskRetentionDays,
  };
}

function ensureAppId(appId, config) {
  if (appId !== config.appId) {
    throw new HttpError(404, "Unknown app id.", "unknown_app");
  }
}

function resolveStaticFile(requestPathname) {
  if (!existsSync(distRoot)) return null;

  const pathname = decodeURIComponent(requestPathname || "/");
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(distRoot, `.${requestedPath}`);

  if (!candidate.startsWith(distRoot)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  if (!extname(pathname)) {
    const spaEntry = resolve(distRoot, "index.html");
    if (existsSync(spaEntry)) {
      return spaEntry;
    }
  }

  return null;
}

function getCacheControl(filePath) {
  const base = filePath.split("/").pop() || "";
  // Service worker and HTML must never be cached — browsers need fresh copies
  // to detect SW updates and pick up new app versions.
  if (base === "sw.js" || base === "registerSW.js" || base.endsWith(".html")) {
    return "no-store";
  }
  return "public, max-age=31536000, immutable";
}

function serveStaticFile(response, filePath) {
  const extension = extname(filePath);
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": getCacheControl(filePath),
  });
  createReadStream(filePath).pipe(response);
}

/**
 * @param {import("./config.js").backendConfig} [config]
 */
export function createTaskflowServer(config = backendConfig) {
  const db = getDatabase(config);
  const requestHandler = createRequestHandler(config, db);
  const server = http.createServer(requestHandler);
  /** @type {{ stop: () => void } | null} */
  let syncHandle = null;

  return {
    server,
    db,
    requestHandler,
    start() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          console.log(`Zephyrly backend listening on http://${config.host}:${config.port}`);
          syncHandle = startSyncLoop(db, config);
          resolve(server);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        syncHandle?.stop();
        syncHandle = null;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          closeDatabase();
          resolve(undefined);
        });
      });
    },
  };
}

export function createRequestHandler(config = backendConfig, db = getDatabase(config)) {
  return async (request, response) => {
    const requestOrigin = request.headers.origin || "";
    const allowedOrigin = requestOrigin || config.publicAppUrl || "*";
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-App-Id, X-Origin-URL");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const requestUrl = getRequestUrl(request);
      const segments = parsePath(requestUrl.pathname);

      if (!requestUrl.pathname.startsWith("/api")) {
        const staticFile = resolveStaticFile(requestUrl.pathname);
        if (staticFile) {
          serveStaticFile(response, staticFile);
          return;
        }
      }

      if (requestUrl.pathname === "/health" || requestUrl.pathname === "/api/health") {
        purgeExpiredAuthRecords(db);
        sendJson(response, 200, { ok: true, app_id: config.appId });
        return;
      }

      if (
        request.method === "GET" &&
        segments[0] === "api" &&
        segments[1] === "apps" &&
        segments[2] === "public" &&
        segments[3] === "prod" &&
        segments[4] === "public-settings" &&
        segments[5] === "by-id"
      ) {
        const appId = segments[6];
        ensureAppId(appId, config);
        sendJson(response, 200, getPublicSettings(config));
        return;
      }

      if (request.method === "POST" && segments[0] === "api" && segments[1] === "apps" && segments[3] === "auth" && segments[4] === "login") {
        const appId = segments[2];
        ensureAppId(appId, config);
        const body = (await readJsonBody(request)) || {};
        const result = loginWithEmailPassword(db, config, request, {
          appId,
          email: body.email,
          password: body.password,
        });

        sendJson(
          response,
          200,
          { access_token: result.access_token, user: result.user, expires_at: result.expires_at },
          { "Set-Cookie": result.session_cookie }
        );
        return;
      }

      if (
        request.method === "GET" &&
        segments[0] === "api" &&
        segments[1] === "apps" &&
        segments[2] === "auth" &&
        ((segments.length === 4 && segments[3] === "login") ||
          (segments.length === 5 && segments[3] === "google" && segments[4] === "login"))
      ) {
        const appId = requestUrl.searchParams.get("app_id") || config.appId;
        ensureAppId(appId, config);
        const fromUrl = requestUrl.searchParams.get("from_url") || `${config.publicAppUrl}/Today`;
        const wantsJson = (request.headers.accept || "").includes("application/json");
        try {
          const authUrl = getGoogleAuthUrl(db, config, { appId, fromUrl });
          if (wantsJson) {
            sendJson(response, 200, { redirect_url: authUrl });
          } else {
            redirect(response, authUrl);
          }
        } catch (error) {
          if (error instanceof HttpError && error.code === "google_not_configured") {
            const loginUrl = new URL("/login", config.publicAppUrl);
            const resolvedFromUrl = new URL(fromUrl, config.publicAppUrl);
            loginUrl.searchParams.set("next", resolvedFromUrl.searchParams.get("next") || `${resolvedFromUrl.pathname}${resolvedFromUrl.search}`);
            loginUrl.searchParams.set("auth_error", error.code);
            loginUrl.searchParams.set("auth_error_message", error.message);
            redirect(response, loginUrl.toString());
            return;
          }
          throw error;
        }
        return;
      }

      if (
        request.method === "GET" &&
        segments[0] === "api" &&
        segments[1] === "apps" &&
        segments[2] === "auth" &&
        segments[3] === "google" &&
        segments[4] === "callback"
      ) {
        const state = requestUrl.searchParams.get("state");
        const code = requestUrl.searchParams.get("code");
        if (!state || !code) {
          throw new HttpError(400, "Google sign-in callback is missing state or code.", "invalid_google_callback");
        }

        const result = await completeGoogleLogin(db, config, request, { state, code });
        const redirectUrl = new URL(result.redirectTo, config.publicAppUrl);
        redirect(response, redirectUrl.toString(), { "Set-Cookie": result.sessionCookie });
        return;
      }

      if (
        request.method === "GET" &&
        segments[0] === "api" &&
        segments[1] === "apps" &&
        segments[2] === "auth" &&
        segments[3] === "logout"
      ) {
        destroySession(db, config, request, config.appId);
        const fromUrl = requestUrl.searchParams.get("from_url");
        if (fromUrl) {
          redirect(response, fromUrl, { "Set-Cookie": clearSessionCookie(config) });
          return;
        }
        sendJson(response, 200, { success: true }, { "Set-Cookie": clearSessionCookie(config) });
        return;
      }

      if (segments[0] !== "api" || segments[1] !== "apps") {
        throw new HttpError(404, "Route not found.", "not_found");
      }

      const appId = segments[2];
      ensureAppId(appId, config);

      // ---- Calendar integrations ---------------------------------------
      if (segments[3] === "integrations") {
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
          const state = requestUrl.searchParams.get("state");
          const code = requestUrl.searchParams.get("code");
          const errorParam = requestUrl.searchParams.get("error");
          if (errorParam) {
            // User declined consent. Redirect back to Settings with a flag.
            const back = new URL("/Settings", config.publicAppUrl);
            back.searchParams.set("integration_error", errorParam);
            redirect(response, back.toString());
            return;
          }
          if (!state || !code) {
            throw new HttpError(400, "Missing state or code.", "invalid_callback");
          }
          const { redirectTo } = await completeGoogleConnect(db, config, {
            user,
            state,
            code,
          });
          const redirectUrl = new URL(redirectTo || "/Settings", config.publicAppUrl);
          // Drop hash-fragment for safety; re-apply the calendar-integrations anchor.
          if (!redirectUrl.hash) redirectUrl.hash = "calendar-integrations";
          redirect(response, redirectUrl.toString());
          return;
        }

        // All other integration routes require an authenticated user.
        const user = requireAuthenticatedUser(db, config, request, appId);

        if (request.method === "GET" && segments.length === 4) {
          sendJson(response, 200, {
            integrations: listIntegrationsForUser(db, { appId, userId: user.id }),
          });
          return;
        }

        if (
          request.method === "GET" &&
          segments[4] === "google" &&
          segments[5] === "connect"
        ) {
          const fromUrl = requestUrl.searchParams.get("from_url") || "/Settings";
          const { authUrl } = startGoogleConnect(db, config, {
            user,
            appId,
            fromUrl,
          });
          const wantsJson = (request.headers.accept || "").includes("application/json");
          if (wantsJson) {
            sendJson(response, 200, { redirect_url: authUrl });
          } else {
            redirect(response, authUrl);
          }
          return;
        }

        // POST /api/apps/:appId/integrations/apple/connect
        // Body: { email, password }  (the Apple ID + an app-specific password
        // generated by the user at appleid.apple.com). We probe CalDAV
        // synchronously — invalid credentials throw 401 before any row is
        // written. The password is encrypted-at-rest with the integration id
        // as AAD; we never log it and never echo it back.
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
          return;
        }

        if (request.method === "DELETE" && segments[4] && !segments[5]) {
          await disconnectIntegration(db, {
            appId,
            userId: user.id,
            id: segments[4],
          });
          sendJson(response, 200, { success: true });
          return;
        }

        if (
          request.method === "POST" &&
          segments[4] &&
          segments[5] === "sync"
        ) {
          const row = getIntegrationForUser(db, {
            appId,
            userId: user.id,
            id: segments[4],
          });
          if (!row) throw new HttpError(404, "Integration not found.", "not_found");
          await syncIntegration(db, config, row);
          sendJson(response, 200, { success: true });
          return;
        }

        // GET /api/apps/:appId/integrations/:id/calendars
        // Returns the calendar list for this integration. Refreshes from the
        // provider on every call so newly-shared calendars appear.
        if (
          request.method === "GET" &&
          segments[4] &&
          segments[5] === "calendars"
        ) {
          const row = getIntegrationForUser(db, {
            appId,
            userId: user.id,
            id: segments[4],
          });
          if (!row) throw new HttpError(404, "Integration not found.", "not_found");
          let calendars;
          try {
            calendars = await refreshIntegrationCalendars(db, config, row);
          } catch (err) {
            // Fall back to cached rows if the provider call fails (e.g. rate
            // limited). The user can still toggle previously-discovered
            // calendars without being blocked.
            calendars = listIntegrationCalendars(db, row.id);
            if (!calendars.length) throw err;
          }
          sendJson(response, 200, { calendars });
          return;
        }

        // PUT /api/apps/:appId/integrations/:id/calendars
        // Body: { updates: { [external_calendar_id]: boolean } }
        if (
          request.method === "PUT" &&
          segments[4] &&
          segments[5] === "calendars"
        ) {
          const row = getIntegrationForUser(db, {
            appId,
            userId: user.id,
            id: segments[4],
          });
          if (!row) throw new HttpError(404, "Integration not found.", "not_found");
          const body = (await readJsonBody(request)) || {};
          const updates = (body && typeof body.updates === "object" && body.updates) || {};
          // Light validation — only accept boolean values, ignore the rest.
          /** @type {Record<string, boolean>} */
          const sanitized = {};
          for (const [k, v] of Object.entries(updates)) {
            if (typeof v === "boolean") sanitized[k] = v;
          }
          setEnabledCalendars(db, row.id, sanitized);
          sendJson(response, 200, {
            calendars: listIntegrationCalendars(db, row.id),
          });
          return;
        }

        // POST /api/apps/:appId/integrations/:id/set-default
        // Marks this integration as the user's default — new locally-created
        // tasks will be pushed only to this one. Existing event mappings on
        // other integrations continue to round-trip.
        if (
          request.method === "POST" &&
          segments[4] &&
          segments[5] === "set-default"
        ) {
          setDefaultIntegration(db, {
            appId,
            userId: user.id,
            integrationId: segments[4],
          });
          sendJson(response, 200, {
            integrations: listIntegrationsForUser(db, { appId, userId: user.id }),
          });
          return;
        }

        // POST /api/apps/:appId/integrations/:id/primary-calendar
        // Body: { external_calendar_id }
        // Picks which of this integration's calendars should receive new tasks.
        if (
          request.method === "POST" &&
          segments[4] &&
          segments[5] === "primary-calendar"
        ) {
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
          return;
        }

        // POST /api/apps/:appId/integrations/:id/calendar-color
        // Body: { external_calendar_id, color_hex }
        // Updates the calendar color both on the provider (Google
        // colorRgbFormat or Apple PROPPATCH) and in our local mirror so
        // the UI repaints immediately. Provider failure aborts before
        // touching local state — see setCalendarColor in integrations.js.
        if (
          request.method === "POST" &&
          segments[4] &&
          segments[5] === "calendar-color"
        ) {
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
          sendJson(response, 200, {
            calendars: listIntegrationCalendars(db, segments[4]),
          });
          return;
        }

        throw new HttpError(404, "Route not found.", "not_found");
      }
      // ------------------------------------------------------------------

      if (segments[3] !== "entities") {
        throw new HttpError(404, "Route not found.", "not_found");
      }

      const user = requireAuthenticatedUser(db, config, request, appId);
      const entityName = segments[4];
      const entityId = segments[5];

      if (request.method === "GET" && entityName === "User" && entityId === "me") {
        sendJson(response, 200, user);
        return;
      }

      if (request.method === "GET" && entityName && !entityId) {
        sendJson(
          response,
          200,
          listEntityRecords(db, {
            entityName,
            appId,
            user,
            sort: requestUrl.searchParams.get("sort") || undefined,
            skip: parseLimit(requestUrl.searchParams.get("skip")) || 0,
            limit: parseLimit(requestUrl.searchParams.get("limit")),
            fields: requestUrl.searchParams.get("fields") || undefined,
            query: parseQueryFilter(requestUrl.searchParams),
          })
        );
        return;
      }

      if (request.method === "GET" && entityName && entityId) {
        sendJson(response, 200, getEntityRecord(db, { entityName, appId, user, id: entityId }));
        return;
      }

      if (request.method === "POST" && entityName && !entityId) {
        const body = (await readJsonBody(request)) || {};
        const created = createEntityRecord(db, {
          entityName,
          appId,
          user,
          input: body,
          config,
        });
        if (entityName === "Task") {
          enqueueTaskPush(db, config, { op: "upsert", appId, taskSnapshot: created });
        }
        sendJson(response, 201, created);
        return;
      }

      if (request.method === "PUT" && entityName && entityId) {
        const body = (await readJsonBody(request)) || {};
        const updated = updateEntityRecord(db, { entityName, appId, user, id: entityId, input: body });
        if (entityName === "Task") {
          enqueueTaskPush(db, config, { op: "upsert", appId, taskSnapshot: updated });
        }
        sendJson(response, 200, updated);
        return;
      }

      if (request.method === "DELETE" && entityName && entityId) {
        // Snapshot the Task BEFORE delete so push has data for Google DELETE.
        /** @type {any} */
        let snapshot = null;
        if (entityName === "Task") {
          try {
            snapshot = getEntityRecord(db, { entityName, appId, user, id: entityId });
          } catch {
            // Already gone; nothing to snapshot.
          }
        }
        const result = deleteEntityRecord(db, { entityName, appId, user, id: entityId });
        if (entityName === "Task" && snapshot) {
          enqueueTaskPush(db, config, { op: "delete", appId, taskSnapshot: snapshot });
        }
        sendJson(response, 200, result);
        return;
      }

      throw new HttpError(404, "Route not found.", "not_found");
    } catch (error) {
      sendError(response, error);
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const taskflowServer = createTaskflowServer();
  taskflowServer.start();
}
