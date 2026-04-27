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
    googleMode: "disabled",
    googleCalendarClientId: "",
    googleCalendarClientSecret: "",
    hasGoogleCalendarCredentials: false,
    integrationsEnabled: false,
    syncIntervalMs: 300000,
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
