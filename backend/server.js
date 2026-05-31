// @ts-check
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backendConfig, projectRoot } from "./config.js";
import { closeDatabase, getDatabase } from "./db.js";
import { HttpError, getRequestUrl, sendError, sendJson } from "./http.js";
import { log } from "./log.js";
import { purgeExpiredAuthRecords } from "./auth.js";
import { startSyncLoop } from "./sync.js";
import { startNotificationLoop } from "./notifications.js";
import { handleAuthRoute } from "./routes/auth.js";
import { handleIntegrationsRoute } from "./routes/integrations.js";
import { handleNotificationsRoute } from "./routes/notifications.js";
import { handleAttachmentsRoute } from "./routes/attachments.js";
import { handleEntitiesRoute } from "./routes/entities.js";

const distRoot = resolve(projectRoot, "dist");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parsePath(pathname) {
  return pathname.split("/").filter(Boolean);
}

function getPublicSettings(config) {
  return {
    id: config.appId,
    app_id: config.appId,
    name: config.appName || "Zephyrly",
    auth_providers: {
      // hasGoogleCredentials is computed in config.js from the Google
      // client id + secret env vars; surfaced here so the Login page
      // knows whether to enable the "Sign in with Google" button.
      google: !!config.hasGoogleCredentials,
      // Email/password login is gated by the same flag that actually
      // accepts the request inside loginWithEmailPassword — keeps the
      // login UI honest about what will work.
      email_password: !!config.allowAnyPassword,
    },
    deleted_task_retention_days: config.deletedTaskRetentionDays,
  };
}

function ensureAppId(appId, config) {
  if (!appId || appId !== config.appId) {
    throw new HttpError(404, "Unknown app.", "unknown_app");
  }
}

function resolveStaticFile(requestPathname) {
  // Strip leading slash; reject any traversal.
  const safe = requestPathname.replace(/^\/+/, "").replace(/\.\.\/?/g, "");
  if (!safe) {
    const indexPath = resolve(distRoot, "index.html");
    return existsSync(indexPath) ? indexPath : null;
  }
  const direct = resolve(distRoot, safe);
  if (!direct.startsWith(distRoot)) return null;
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  // SPA fallback: routes with no file extension serve index.html.
  if (!extname(safe)) {
    const indexPath = resolve(distRoot, "index.html");
    if (existsSync(indexPath)) return indexPath;
  }
  return null;
}

function getCacheControl(filePath) {
  const name = filePath.split("/").pop() || "";
  if (/sw\.js$|registerSW\.js$|\.html$/i.test(name)) {
    return "no-store";
  }
  return "public, max-age=31536000, immutable";
}

function serveStaticFile(response, filePath) {
  const ext = extname(filePath).toLowerCase();
  response.setHeader("Content-Type", CONTENT_TYPES[ext] || "application/octet-stream");
  response.setHeader("Cache-Control", getCacheControl(filePath));
  response.writeHead(200);
  createReadStream(filePath).pipe(response);
}

export function createTaskflowServer(config = backendConfig) {
  const db = getDatabase(config);
  const requestHandler = createRequestHandler(config, db);
  const server = http.createServer(requestHandler);
  /** @type {{ stop: () => void } | null} */
  let syncHandle = null;
  /** @type {{ stop: () => void } | null} */
  let notificationHandle = null;

  return {
    server,
    db,
    requestHandler,
    start() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          log.info(`backend listening on http://${config.host}:${config.port}`);
          syncHandle = startSyncLoop(db, config);
          notificationHandle = startNotificationLoop(db, config);
          resolve(server);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        syncHandle?.stop();
        syncHandle = null;
        notificationHandle?.stop();
        notificationHandle = null;
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

      // Static assets — anything not under /api hits the dist/ fallback.
      if (!requestUrl.pathname.startsWith("/api")) {
        const staticFile = resolveStaticFile(requestUrl.pathname);
        if (staticFile) {
          serveStaticFile(response, staticFile);
          return;
        }
      }

      // Healthcheck (used by Docker + uptime probes).
      if (requestUrl.pathname === "/health" || requestUrl.pathname === "/api/health") {
        purgeExpiredAuthRecords(db);
        sendJson(response, 200, { ok: true, app_id: config.appId });
        return;
      }

      // Public settings (unauth — needed before login).
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

      // Per-route dispatch. Each handler returns true if it matched.
      // Order matters: auth first (some routes are unauthenticated),
      // then per-feature handlers under /api/apps/:appId/*.
      const ctx = { config, db, url: requestUrl, segments };
      if (await handleAuthRoute(request, response, ctx)) return;
      if (await handleIntegrationsRoute(request, response, ctx)) return;
      if (await handleNotificationsRoute(request, response, ctx)) return;
      // Attachments before entities so /tasks/:id/attachments wins over
      // the generic /tasks/:id PUT/DELETE dispatch in entities.
      if (await handleAttachmentsRoute(request, response, ctx)) return;
      if (await handleEntitiesRoute(request, response, ctx)) return;

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
