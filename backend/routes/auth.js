// @ts-check
/**
 * @file Auth routes — login, Google OAuth start/callback, logout.
 *
 * Routes handled (all return `true` if matched):
 *   - POST /api/apps/:appId/auth/login
 *   - GET  /api/apps/auth/login          (Google redirect entry)
 *   - GET  /api/apps/auth/google/login   (Google redirect entry, explicit)
 *   - GET  /api/apps/auth/google/callback
 *   - GET  /api/apps/:appId/auth/logout
 */
import { HttpError, readJsonBody, redirect, sendJson } from "../http.js";
import {
  clearSessionCookie,
  completeGoogleLogin,
  destroySession,
  getGoogleAuthUrl,
  loginWithEmailPassword,
} from "../auth.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{ config: any, db: any, url: URL, segments: string[] }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleAuthRoute(request, response, { config, db, url, segments }) {
  if (segments[0] !== "api" || segments[1] !== "apps") return false;

  // POST /api/apps/:appId/auth/login
  if (
    request.method === "POST" &&
    segments[3] === "auth" &&
    segments[4] === "login"
  ) {
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
    return true;
  }

  // GET /api/apps/auth/login  OR  /api/apps/auth/google/login
  if (
    request.method === "GET" &&
    segments[2] === "auth" &&
    ((segments.length === 4 && segments[3] === "login") ||
      (segments.length === 5 && segments[3] === "google" && segments[4] === "login"))
  ) {
    const appId = url.searchParams.get("app_id") || config.appId;
    ensureAppId(appId, config);
    const fromUrl = url.searchParams.get("from_url") || `${config.publicAppUrl}/Today`;
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
        loginUrl.searchParams.set(
          "next",
          resolvedFromUrl.searchParams.get("next") ||
            `${resolvedFromUrl.pathname}${resolvedFromUrl.search}`
        );
        loginUrl.searchParams.set("auth_error", error.code);
        loginUrl.searchParams.set("auth_error_message", error.message);
        redirect(response, loginUrl.toString());
        return true;
      }
      throw error;
    }
    return true;
  }

  // GET /api/apps/auth/google/callback
  if (
    request.method === "GET" &&
    segments[2] === "auth" &&
    segments[3] === "google" &&
    segments[4] === "callback"
  ) {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || !code) {
      throw new HttpError(400, "Google sign-in callback is missing state or code.", "invalid_google_callback");
    }
    const result = await completeGoogleLogin(db, config, request, { state, code });
    const redirectUrl = new URL(result.redirectTo, config.publicAppUrl);
    redirect(response, redirectUrl.toString(), { "Set-Cookie": result.sessionCookie });
    return true;
  }

  // GET /api/apps/auth/logout  (no appId in path — uses the config default)
  if (
    request.method === "GET" &&
    segments[2] === "auth" &&
    segments[3] === "logout"
  ) {
    destroySession(db, config, request, config.appId);
    const fromUrl = url.searchParams.get("from_url");
    if (fromUrl) {
      redirect(response, fromUrl, { "Set-Cookie": clearSessionCookie(config) });
      return true;
    }
    sendJson(response, 200, { success: true }, { "Set-Cookie": clearSessionCookie(config) });
    return true;
  }

  return false;
}

function ensureAppId(appId, config) {
  if (!appId || appId !== config.appId) {
    throw new HttpError(404, "Unknown app.", "unknown_app");
  }
}
