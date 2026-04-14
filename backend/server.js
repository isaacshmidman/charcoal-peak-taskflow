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
      email_password: true,
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

  return {
    server,
    db,
    requestHandler,
    start() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          console.log(`Taskflow backend listening on http://${config.host}:${config.port}`);
          resolve(server);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
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
        sendJson(
          response,
          201,
          createEntityRecord(db, {
            entityName,
            appId,
            user,
            input: body,
            config,
          })
        );
        return;
      }

      if (request.method === "PUT" && entityName && entityId) {
        const body = (await readJsonBody(request)) || {};
        sendJson(response, 200, updateEntityRecord(db, { entityName, appId, user, id: entityId, input: body }));
        return;
      }

      if (request.method === "DELETE" && entityName && entityId) {
        sendJson(response, 200, deleteEntityRecord(db, { entityName, appId, user, id: entityId }));
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
