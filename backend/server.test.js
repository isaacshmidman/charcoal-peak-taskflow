/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase } from "./db.js";
import { createRequestHandler } from "./server.js";

let tempDir = "";
let db;
let handler;

function createMockRequest({ method = "GET", url = "/", headers = {}, body }) {
  const payload = body == null ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
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
    end(chunk = "") {
      if (ended) return;
      ended = true;
      body += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      resolveDone();
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
  const config = {
    host: "127.0.0.1",
    port: 0,
    appId: "test-app",
    appName: "Taskflow Test",
    publicAppUrl: "http://127.0.0.1:4173",
    dbFile: join(tempDir, "taskflow.sqlite"),
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
