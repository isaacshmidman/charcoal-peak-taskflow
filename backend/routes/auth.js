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
import { HttpError, readJsonBody, redirect, sameOriginUrl, sendJson } from "../http.js";
import {
  clearSessionCookie,
  completeGoogleLogin,
  destroySession,
  getGoogleAuthUrl,
  getRequestIpAddress,
  loginWithEmailPassword,
} from "../auth.js";
import { takeSlot } from "../ai/rate-limit.js";

/** Sign-in attempts one address may make a minute (Google's two steps count as two). */
export const SIGN_INS_PER_MINUTE = 20;

/**
 * Slows down anyone trying sign-in after sign-in. Refuses with 429 once an
 * address is over the limit.
 * @param {import("node:http").IncomingMessage} request
 */
function limitSignIns(request) {
  const slot = takeSlot(`sign-in:${getRequestIpAddress(request)}`, SIGN_INS_PER_MINUTE, 60_000);
  if (!slot.ok) {
    throw new HttpError(429, "Too many sign-in attempts. Wait a minute and try again.", "too_many_attempts");
  }
}

/**
 * Back to the login page with what went wrong, by code: the page shows its
 * own words for each, never text from the link (which anyone could write).
 * @param {import("node:http").ServerResponse} response
 * @param {any} config
 * @param {string} code
 * @param {string} [next]
 */
function backToLogin(response, config, code, next) {
  const loginUrl = new URL("/login", config.publicAppUrl);
  if (next) loginUrl.searchParams.set("next", next);
  loginUrl.searchParams.set("auth_error", code);
  redirect(response, loginUrl.toString());
}

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
    limitSignIns(request);
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
    limitSignIns(request);
    // Stored with the OAuth state and followed after Google sign-in, so it
    // must stay on this app's origin (see sameOriginUrl).
    const fromUrl = sameOriginUrl(url.searchParams.get("from_url"), config.publicAppUrl, "/Today");
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
        const resolvedFromUrl = new URL(fromUrl, config.publicAppUrl);
        backToLogin(response, config, error.code, resolvedFromUrl.searchParams.get("next") || `${resolvedFromUrl.pathname}${resolvedFromUrl.search}`);
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
      // Also what Google sends when the person cancels.
      backToLogin(response, config, "google_sign_in_failed");
      return true;
    }
    let result;
    try {
      limitSignIns(request);
      result = await completeGoogleLogin(db, config, request, { state, code });
    } catch (error) {
      if (error instanceof HttpError) {
        backToLogin(response, config, error.code);
        return true;
      }
      throw error;
    }
    // Checked again here: states written before the check above existed
    // may still hold an off-site address.
    redirect(response, sameOriginUrl(result.redirectTo, config.publicAppUrl, "/Today"), {
      "Set-Cookie": result.sessionCookie,
    });
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
      redirect(response, sameOriginUrl(fromUrl, config.publicAppUrl, "/login"), {
        "Set-Cookie": clearSessionCookie(config),
      });
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
