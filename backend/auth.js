// @ts-check
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.js";
import { ensureDefaultPrioritiesForUser, findUserByEmail } from "./store.js";
import { getGoogleRedirectUrl } from "./config.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, hash] = storedHash.split(":");
  const derived = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, "hex"), derived);
}

function parseCookies(header = "") {
  return header.split(/;\s*/).reduce((cookies, part) => {
    if (!part) return cookies;
    const index = part.indexOf("=");
    if (index < 0) return cookies;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, /** @type {Record<string, string>} */ ({}));
}

function serializeCookie(name, value, { maxAge = 0, httpOnly = true } = {}) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];

  if (httpOnly) attributes.push("HttpOnly");
  return attributes.join("; ");
}

function buildUserPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    full_name: row.full_name || "",
    email: row.email,
    role: row.role || "user",
    auth_provider: row.auth_provider || "local",
    avatar_url: row.avatar_url || "",
    preferences: row.preferences_json ? JSON.parse(row.preferences_json) : {},
  };
}

function getRequestIpAddress(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "";
}

export function clearSessionCookie(config) {
  return serializeCookie(config.sessionCookieName, "", { maxAge: 0 });
}

export function purgeExpiredAuthRecords(db) {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(now);
}

export function getAuthorizedSession(db, config, request, appId) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const cookies = parseCookies(request.headers.cookie || "");
  const sessionToken = cookies[config.sessionCookieName] || "";

  const accessTokenHash = token ? sha256(token) : "";
  const sessionTokenHash = sessionToken ? sha256(sessionToken) : "";
  if (!accessTokenHash && !sessionTokenHash) return null;

  const session = db
    .prepare(
      `
        SELECT
          sessions.*,
          users.id AS user_id,
          users.created_date AS user_created_date,
          users.updated_date AS user_updated_date,
          users.full_name AS user_full_name,
          users.email AS user_email,
          users.role AS user_role,
          users.auth_provider AS user_auth_provider,
          users.avatar_url AS user_avatar_url,
          users.preferences_json AS user_preferences_json
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.app_id = ?
          AND sessions.expires_at > ?
          AND (
            (? != '' AND sessions.access_token_hash = ?)
            OR (? != '' AND sessions.session_token_hash = ?)
          )
        ORDER BY sessions.updated_date DESC
        LIMIT 1
      `
    )
    .get(
      appId,
      new Date().toISOString(),
      accessTokenHash,
      accessTokenHash,
      sessionTokenHash,
      sessionTokenHash
    );

  if (!session) return null;

  return {
    session,
    user: {
      id: session.user_id,
      created_date: session.user_created_date,
      updated_date: session.user_updated_date,
      full_name: session.user_full_name,
      email: session.user_email,
      role: session.user_role,
      auth_provider: session.user_auth_provider,
      avatar_url: session.user_avatar_url,
      preferences_json: session.user_preferences_json,
    },
  };
}

export function requireAuthenticatedUser(db, config, request, appId) {
  const authorized = getAuthorizedSession(db, config, request, appId);
  if (!authorized?.user) {
    throw new HttpError(401, "Authentication required.", "auth_required");
  }
  return buildUserPayload(authorized.user);
}

export function destroySession(db, config, request, appId) {
  const authorized = getAuthorizedSession(db, config, request, appId);
  if (!authorized?.session) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(authorized.session.id);
}

export function createSession(db, config, request, { appId, user, provider = "local" }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  const accessToken = createOpaqueToken();
  const sessionToken = createOpaqueToken();

  db.prepare(
    `
      INSERT INTO sessions (
        id, app_id, user_id, access_token_hash, session_token_hash, auth_provider,
        user_agent, ip_address, expires_at, created_date, updated_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    `session_${randomUUID()}`,
    appId,
    user.id,
    sha256(accessToken),
    sha256(sessionToken),
    provider,
    request.headers["user-agent"] || "",
    getRequestIpAddress(request),
    expiresAt.toISOString(),
    now.toISOString(),
    now.toISOString()
  );

  return {
    accessToken,
    sessionCookie: serializeCookie(config.sessionCookieName, sessionToken, {
      maxAge: config.sessionTtlDays * 24 * 60 * 60,
    }),
    expiresAt: expiresAt.toISOString(),
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function findUserByGoogleSubject(db, appId, googleSubject) {
  if (!googleSubject) return null;
  return db.prepare("SELECT * FROM users WHERE app_id = ? AND google_subject = ?").get(appId, googleSubject);
}

export function findOrCreateUserByEmail(
  db,
  config,
  { appId, email, fullName = "", provider = "local", avatarUrl = "", googleSubject = "" }
) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new HttpError(400, "Email is required.", "email_required");
  }

  if (googleSubject) {
    const bySubject = findUserByGoogleSubject(db, appId, googleSubject);
    if (bySubject) {
      db.prepare(
        `
          UPDATE users
          SET full_name = ?, auth_provider = ?, avatar_url = ?, updated_date = ?, last_login_at = ?, email = ?
          WHERE id = ?
        `
      ).run(
        fullName || bySubject.full_name || "",
        provider,
        avatarUrl || bySubject.avatar_url || "",
        new Date().toISOString(),
        new Date().toISOString(),
        normalizedEmail,
        bySubject.id
      );
      return buildUserPayload(
        db.prepare("SELECT * FROM users WHERE id = ?").get(bySubject.id)
      );
    }
  }

  const existing = findUserByEmail(db, appId, normalizedEmail);
  if (existing) {
    db.prepare(
      `
        UPDATE users
        SET
          full_name = ?,
          auth_provider = ?,
          avatar_url = ?,
          google_subject = COALESCE(?, google_subject),
          updated_date = ?,
          last_login_at = ?
        WHERE id = ?
      `
    ).run(
      fullName || existing.full_name || "",
      provider,
      avatarUrl || existing.avatar_url || "",
      googleSubject || null,
      new Date().toISOString(),
      new Date().toISOString(),
      existing.id
    );
    const refreshed = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
    const payload = buildUserPayload(refreshed);
    ensureDefaultPrioritiesForUser(db, { appId, user: payload, config });
    return payload;
  }

  const userCount = db.prepare("SELECT COUNT(*) AS total FROM users WHERE app_id = ?").get(appId);
  const role = Number(userCount?.total || 0) === 0 ? "admin" : "user";
  const now = new Date().toISOString();
  const id = `user_${randomUUID()}`;
  const row = {
    id,
    app_id: appId,
    full_name: fullName,
    email: normalizedEmail,
    role,
    auth_provider: provider,
    password_hash: null,
    google_subject: googleSubject || null,
    avatar_url: avatarUrl,
    preferences_json: "{}",
    created_date: now,
    updated_date: now,
    last_login_at: now,
  };

  db.prepare(
    `
      INSERT INTO users (
        id, app_id, full_name, email, role, auth_provider, password_hash,
        google_subject, avatar_url, preferences_json, created_date, updated_date, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    row.id,
    row.app_id,
    row.full_name,
    row.email,
    row.role,
    row.auth_provider,
    row.password_hash,
    row.google_subject,
    row.avatar_url,
    row.preferences_json,
    row.created_date,
    row.updated_date,
    row.last_login_at
  );

  const payload = buildUserPayload(row);
  ensureDefaultPrioritiesForUser(db, { appId, user: payload, config });
  return payload;
}

export function loginWithEmailPassword(db, config, request, { appId, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new HttpError(400, "Email and password are required.", "credentials_required");
  }

  if (config.allowAnyPassword) {
    // Open-access dev mode: auto-create users, accept any password
    const user = findOrCreateUserByEmail(db, config, {
      appId,
      email: normalizedEmail,
      fullName: normalizedEmail.split("@")[0],
      provider: "local",
    });

    const session = createSession(db, config, request, { appId, user, provider: "local" });
    return {
      user,
      access_token: session.accessToken,
      expires_at: session.expiresAt,
      session_cookie: session.sessionCookie,
    };
  }

  // Strict mode: require existing user, verify password
  const existing = findUserByEmail(db, appId, normalizedEmail);
  if (!existing) {
    throw new HttpError(401, "Invalid email or password.", "invalid_credentials");
  }

  if (!existing.password_hash) {
    // User exists (e.g. via Google or import) but has no password set.
    // Reject — they must use their original auth provider or have an admin set a password.
    throw new HttpError(401, "This account does not use password login. Sign in with your original provider.", "password_not_set");
  }

  if (!verifyPassword(password, existing.password_hash)) {
    throw new HttpError(401, "Invalid email or password.", "invalid_credentials");
  }

  const user = findOrCreateUserByEmail(db, config, {
    appId,
    email: normalizedEmail,
    fullName: existing.full_name || normalizedEmail.split("@")[0],
    provider: "local",
  });

  const session = createSession(db, config, request, { appId, user, provider: "local" });
  return {
    user,
    access_token: session.accessToken,
    expires_at: session.expiresAt,
    session_cookie: session.sessionCookie,
  };
}

export function getGoogleAuthUrl(db, config, { appId, fromUrl }) {
  if (config.googleMode !== "oauth" || !config.googleClientId || !config.googleClientSecret) {
    throw new HttpError(
      503,
      "Google sign-in is not configured for this backend yet.",
      "google_not_configured"
    );
  }

  const stateId = `oauth_${randomUUID()}`;
  const codeVerifier = createOpaqueToken(48);
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(
    `
      INSERT INTO oauth_states (id, app_id, provider, from_url, code_verifier, expires_at, created_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(stateId, appId, "google", fromUrl, codeVerifier, expiresAt, new Date().toISOString());

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", getGoogleRedirectUrl(config));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", stateId);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return url.toString();
}

export async function completeGoogleLogin(db, config, request, { state, code }) {
  const stateRow = db
    .prepare("SELECT * FROM oauth_states WHERE id = ? AND provider = 'google' AND expires_at > ?")
    .get(state, new Date().toISOString());

  if (!stateRow) {
    throw new HttpError(400, "Google sign-in state is invalid or expired.", "invalid_oauth_state");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: getGoogleRedirectUrl(config),
      grant_type: "authorization_code",
      code_verifier: stateRow.code_verifier || "",
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new HttpError(502, `Google token exchange failed: ${errorBody}`, "google_token_failed");
  }

  const tokenData = await tokenResponse.json();
  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    const errorBody = await userInfoResponse.text();
    throw new HttpError(502, `Google profile lookup failed: ${errorBody}`, "google_profile_failed");
  }

  const userInfo = await userInfoResponse.json();
  const user = findOrCreateUserByEmail(db, config, {
    appId: stateRow.app_id,
    email: userInfo.email,
    fullName: userInfo.name || userInfo.given_name || "",
    provider: "google",
    avatarUrl: userInfo.picture || "",
    googleSubject: userInfo.sub || "",
  });

  db.prepare("DELETE FROM oauth_states WHERE id = ?").run(stateRow.id);
  const session = createSession(db, config, request, {
    appId: stateRow.app_id,
    user,
    provider: "google",
  });

  return {
    redirectTo: stateRow.from_url,
    user,
    accessToken: session.accessToken,
    sessionCookie: session.sessionCookie,
  };
}

