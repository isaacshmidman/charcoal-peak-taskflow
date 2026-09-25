/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { closeDatabase, createDatabase } from "./db.js";
import { readZip } from "./test-support/readZip.js";
import { createRequestHandler } from "./server.js";

let tempDir = "";
let db;
let handler;
/** @type {any} */
let config;

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

