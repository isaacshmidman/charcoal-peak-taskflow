/* @vitest-environment node */
/**
 * What connected calendars must never do to a task, and what must not get
 * lost on the way to them. Each case here was a way the two used to drift
 * apart or, worse, a way a calendar could damage a task.
 *
 * Google and iCloud are stood in for by a fake `fetch` that answers the
 * addresses the sync really calls.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "./crypto.js";
import { createDatabase } from "./db.js";
import { listIntegrationsForUser } from "./integrations.js";
import { fetchWithTimeout } from "./lib/net.js";
import { enqueueTaskPush, pushIsWaiting, retryDuePushes, waitForPushIdle } from "./push.js";
import { asChangeToExistingEvent } from "./push/google.js";
import { RETRY_DELAYS_MS, failPush, rememberPush } from "./push/outbox.js";
import { inboundUpdateFor } from "./sync/shared.js";
import { syncIntegration } from "./sync.js";

const APP = "test-app";
const GCAL = "primary@example.com";
const ACAL = "https://caldav.icloud.com/calendars/user/work/";
let tempDir = "";
let config;
let db;

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const taskRow = (id) => db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
const mapRow = (taskId) => db.prepare(`SELECT * FROM external_event_map WHERE task_id = ?`).get(taskId);
const outbox = () => db.prepare(`SELECT * FROM push_outbox ORDER BY task_id`).all();
const integration = (id) => db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(id);
/** Make everything waiting in the outbox due now. */
const makeDue = () => db.prepare(`UPDATE push_outbox SET next_attempt_at = ?`).run(iso(Date.now() - 1000));
const settle = () => waitForPushIdle({ timeoutMs: 5000, pollMs: 5 });

function seedIntegration(provider, { syncToken = "cursor-1", windowListedAt = iso() } = {}) {
  const id = `intg_${provider}`;
  const calendarId = provider === "google" ? GCAL : ACAL;
  db.prepare(
    `INSERT INTO calendar_integrations (
       id, app_id, user_id, provider, external_account_id, external_account_email,
       access_token_enc, refresh_token_enc, token_expires_at, scopes,
       primary_calendar_id, primary_calendar_timezone, status, is_default, created_date, updated_date
     ) VALUES (?, ?, 'user_1', ?, 'acct', 'isaac@example.com', ?, ?, ?, 'x', ?, 'America/New_York', 'active', 1, ?, ?)`
  ).run(id, APP, provider, encryptSecret("access-token", id), encryptSecret(provider === "apple" ? "app-password" : "refresh-token", id), iso(Date.now() + 3_600_000), calendarId, iso(), iso());
  db.prepare(
    `INSERT INTO integration_calendars (
       id, app_id, integration_id, external_calendar_id, summary, time_zone, color_hex, access_role,
       primary_flag, sync_enabled, sync_token, window_listed_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, 'Primary', 'America/New_York', '#3174ad', 'owner', 1, 1, ?, ?, ?, ?)`
  ).run(`cal_${id}`, APP, id, calendarId, syncToken, windowListedAt, iso(), iso());
  return { id, calendarId };
}

function insertTask(id, fields = {}) {
  const row = {
    title: "My task", status: "todo", due_date: "2026-05-04", task_time: "", description: "", description_json: "",
    completed_at: "", parent_id: "", priority_id: "", source_provider: "", source_kind: "", source_calendar_id: "", source_writable: 1,
    ...fields,
  };
  db.prepare(
    `INSERT INTO tasks (
       id, app_id, title, status, task_type, recurrence, recurrence_days_json, due_date, task_time, description,
       description_json, completed_at, parent_id, priority_id, tags_json, created_date, updated_date, created_by_id, created_by,
       source_provider, source_kind, source_calendar_id, source_writable
     ) VALUES (?, ?, ?, ?, 'one_time', 'none', '[]', ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'user_1', 'isaac@example.com', ?, ?, ?, ?)`
  ).run(
    id, APP, row.title, row.status, row.due_date, row.task_time, row.description, row.description_json, row.completed_at,
    row.parent_id, row.priority_id, iso(), iso(), row.source_provider, row.source_kind, row.source_calendar_id, row.source_writable
  );
  return taskRow(id);
}

function link(taskId, integrationId, eventId, calendarId, etag = "etag-old") {
  db.prepare(
    `INSERT INTO external_event_map (
       id, app_id, integration_id, task_id, external_event_id, external_calendar_id, etag,
       zephyrly_metadata_synced_at, last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`emap_${taskId}`, APP, integrationId, taskId, eventId, calendarId, etag, iso(), iso(), iso(), iso());
}

/**
 * Google, as far as sync is concerned. `changed` answers "what changed since
 * the cursor"; `inWindow` answers the full 30-back/90-ahead read. Writes
 * (POST/PATCH/DELETE on events) go to `onWrite`.
 */
function google({ changed = [], inWindow = [], onWrite = null, calls = [] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options = {}) => {
      const u = new URL(String(url));
      const method = String(options.method || "GET");
      calls.push(`${method} ${u.pathname}${u.searchParams.has("syncToken") ? " changes" : u.searchParams.has("timeMin") ? " window" : ""}`);
      if (u.pathname.endsWith("/users/me/calendarList")) {
        return json({ items: [{ id: GCAL, summary: "Primary", accessRole: "owner", primary: true, timeZone: "America/New_York", backgroundColor: "#3174ad" }] });
      }
      if (method === "GET" && u.pathname.endsWith("/events")) {
        if (u.searchParams.has("privateExtendedProperty")) return onWrite ? onWrite("FIND", u, options) : json({ items: [] });
        if (u.searchParams.has("syncToken")) return json({ items: changed, nextSyncToken: "cursor-2" });
        return json({ items: inWindow, nextSyncToken: "cursor-window" });
      }
      if (method === "GET") return json({ id: GCAL, timeZone: "America/New_York", summary: "Primary" });
      if (onWrite) return onWrite(method, u, options);
      throw new Error(`Unexpected call to Google: ${method} ${u.pathname}`);
    })
  );
  return calls;
}

const googleEvent = (id, fields = {}) => ({
  id,
  etag: `"etag-${id}-new"`,
  status: "confirmed",
  summary: "Moved in Google",
  start: { dateTime: "2026-05-06T09:00:00-04:00" },
  end: { dateTime: "2026-05-06T10:00:00-04:00" },
  ...fields,
});

const multistatus = (inner) => `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${inner}</D:multistatus>`;
const xml = (body) => new Response(body, { status: 207 });
function appleChange(href, { deleted = false, summary = "Moved in Apple", etag = "apple-new" } = {}) {
  if (deleted) return `<D:response><D:href>${href}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `UID:${href.split("/").pop().replace(".ics", "")}`, `SUMMARY:${summary}`, "DTSTART;VALUE=DATE:20260506", "DTEND;VALUE=DATE:20260507", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:getetag>"${etag}"</D:getetag><C:calendar-data>${ics}</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}
/** iCloud, as far as sync is concerned: discovery fails (harmless), then the changes. */
function apple({ changes = "", inWindow = "", calls = [] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options = {}) => {
      const method = String(options.method || "GET");
      const body = String(options.body || "");
      if (method === "PROPFIND") return new Response("", { status: 500 });
      if (method === "REPORT" && body.includes("calendar-query")) {
        calls.push("window");
        return xml(multistatus(inWindow));
      }
      if (method === "REPORT" && body.includes("<D:sync-token>")) {
        calls.push("changes");
        return xml(multistatus(`${changes}<D:sync-token>cursor-2</D:sync-token>`));
      }
      if (method === "REPORT") return xml(multistatus(`<D:sync-token>cursor-fresh</D:sync-token>`));
      throw new Error(`Unexpected call to iCloud: ${method}`);
    })
  );
  return calls;
}

beforeEach(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "a".repeat(64);
  tempDir = mkdtempSync(join(tmpdir(), "zephyrly-calendar-"));
  config = {
    host: "127.0.0.1", port: 0, appId: APP, appName: "Zephyrly Test", publicAppUrl: "http://127.0.0.1:4173",
    dbFile: join(tempDir, "taskflow.sqlite"), sessionCookieName: "s", sessionTtlDays: 30, deletedTaskRetentionDays: 7,
    allowAnyPassword: true, googleClientId: "", googleClientSecret: "", googleMode: "disabled", googleCalendarClientId: "",
    googleCalendarClientSecret: "", hasGoogleCalendarCredentials: false, integrationsEnabled: true, syncIntervalMs: 60000,
  };
  db = createDatabase(config);
  db.prepare(
    `INSERT INTO users (id, app_id, email, role, auth_provider, created_date, updated_date) VALUES ('user_1', ?, 'isaac@example.com', 'admin', 'local', ?, ?)`
  ).run(APP, iso(), iso());
});

afterEach(async () => {
  await settle().catch(() => {});
  db?.close();
  db = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("a change at the calendar to a task made in Zephyrly", () => {
  it("moves the task but leaves it a finished Zephyrly task (Google)", async () => {
    const { id } = seedIntegration("google");
    insertTask("task_mine", { title: "Write essay", status: "done", completed_at: "2026-05-04T12:00:00.000Z" });
    link("task_mine", id, "ev1", GCAL);
    google({ changed: [googleEvent("ev1")] });

    await syncIntegration(db, config, integration(id));

    expect(taskRow("task_mine")).toMatchObject({
      title: "Moved in Google",
      due_date: "2026-05-06",
      task_time: "9:00AM",
      // It was ticked, and it stays ticked.
      status: "done",
      completed_at: "2026-05-04T12:00:00.000Z",
      // It is still a Zephyrly task, not a Google event.
      source_provider: "",
      source_kind: "",
      source_calendar_id: "",
    });
    expect(mapRow("task_mine").etag).toBe('"etag-ev1-new"');
  });

  it("moves the task but leaves it a finished Zephyrly task (Apple)", async () => {
    const { id } = seedIntegration("apple");
    const href = `${ACAL}zephyrly-task_mine.ics`;
    insertTask("task_mine", { title: "Write essay", status: "done", completed_at: "2026-05-04T12:00:00.000Z" });
    link("task_mine", id, href, ACAL);
    apple({ changes: appleChange(href) });

    await syncIntegration(db, config, integration(id));

    expect(taskRow("task_mine")).toMatchObject({
      title: "Moved in Apple",
      due_date: "2026-05-06",
      status: "done",
      completed_at: "2026-05-04T12:00:00.000Z",
      source_provider: "",
      source_kind: "",
    });
  });

  it("keeps the formatted description when the calendar's words are the same, and takes the calendar's when they aren't", () => {
    const task = { source_provider: "", description: "Bring the charger\nand the cable", description_json: '{"type":"doc"}' };
    const same = inboundUpdateFor({ title: "T", status: "todo", description: "Bring the charger\r\nand the cable\n" }, task);
    expect(same).toEqual({ title: "T" });
    const edited = inboundUpdateFor({ title: "T", status: "todo", description: "Bring the charger only" }, task);
    expect(edited).toEqual({ title: "T", description: "Bring the charger only", description_json: "" });
  });

  it("never carries 'not done' or a repeat rule Zephyrly can't express onto it", () => {
    const fromCalendar = { title: "T", status: "todo", task_type: "recurring", recurrence: "custom", recurrence_days: [], recurrence_end_date: "", source_provider: "google", source_recurrence_rule: "RRULE:FREQ=MONTHLY;BYDAY=2TU" };
    expect(inboundUpdateFor(fromCalendar, { source_provider: "", description: "" })).toEqual({ title: "T" });
    // A task that came from the calendar keeps the calendar's rule and origin, but not its "not done".
    const kept = { ...fromCalendar };
    delete kept.status;
    expect(inboundUpdateFor(fromCalendar, { source_provider: "google", description: "" })).toEqual(kept);
  });

  it("is ignored while a change made here is still on its way out", async () => {
    const { id } = seedIntegration("google");
    const task = insertTask("task_mine", { title: "Edited here a moment ago" });
    link("task_mine", id, "ev1", GCAL);
    rememberPush(db, { op: "upsert", appId: APP, taskSnapshot: task });
    expect(pushIsWaiting(db, "task_mine")).toBe(true);
    google({ changed: [googleEvent("ev1", { summary: "The older text at Google" })] });

    await syncIntegration(db, config, integration(id));

    expect(taskRow("task_mine").title).toBe("Edited here a moment ago");
  });
});

describe("an event deleted at the calendar", () => {
  it("sends a Zephyrly-made task to Recently Deleted with its subtasks, where it can be restored (Google)", async () => {
    const { id } = seedIntegration("google");
    insertTask("task_mine", { title: "Plan the trip", description: "Flights, hotel" });
    insertTask("sub_1", { title: "Book flights", parent_id: "task_mine", due_date: "" });
    link("task_mine", id, "ev1", GCAL);
    google({ changed: [{ id: "ev1", status: "cancelled" }] });

    await syncIntegration(db, config, integration(id));

    expect(taskRow("task_mine")).toBeUndefined();
    expect(taskRow("sub_1")).toBeUndefined();
    const kept = db.prepare(`SELECT * FROM deleted_tasks`).all();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ task_id: "task_mine", title: "Plan the trip", description: "Flights, hotel" });
    expect(JSON.parse(kept[0].subtasks_json)).toEqual([expect.objectContaining({ id: "sub_1", title: "Book flights" })]);
    expect(mapRow("task_mine")).toBeUndefined();
  });

  it("sends a Zephyrly-made task to Recently Deleted (Apple)", async () => {
    const { id } = seedIntegration("apple");
    const href = `${ACAL}zephyrly-task_mine.ics`;
    insertTask("task_mine", { title: "Plan the trip" });
    link("task_mine", id, href, ACAL);
    apple({ changes: appleChange(href, { deleted: true }) });

    await syncIntegration(db, config, integration(id));

    expect(taskRow("task_mine")).toBeUndefined();
    expect(db.prepare(`SELECT task_id FROM deleted_tasks`).all()).toEqual([{ task_id: "task_mine" }]);
  });

  it("leaves a subtask where it is, and simply removes an event that came from the calendar", async () => {
    const { id } = seedIntegration("google");
    insertTask("parent", { title: "Parent" });
    insertTask("sub_1", { title: "Call the bank", parent_id: "parent" });
    insertTask("imported", { title: "Dentist", source_provider: "google", source_kind: "event", source_calendar_id: GCAL });
    link("sub_1", id, "ev_sub", GCAL);
    link("imported", id, "ev_imp", GCAL);
    google({ changed: [{ id: "ev_sub", status: "cancelled" }, { id: "ev_imp", status: "cancelled" }] });

    await syncIntegration(db, config, integration(id));

    expect(taskRow("sub_1")).toMatchObject({ title: "Call the bank", parent_id: "parent" });
    expect(mapRow("sub_1")).toBeUndefined();
    expect(taskRow("imported")).toBeUndefined();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM deleted_tasks`).get().n).toBe(0);
  });
});

describe("events that were already further ahead than the first read", () => {
  it("are picked up by the daily read of the whole window, which keeps the change cursor", async () => {
    const { id } = seedIntegration("google", { windowListedAt: iso(Date.now() - 25 * 3_600_000) });
    const calls = google({ changed: [], inWindow: [googleEvent("ev_far", { summary: "Graduation" })] });

    await syncIntegration(db, config, integration(id));

    expect(calls.filter((c) => c.endsWith(" changes"))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith(" window"))).toHaveLength(1);
    expect(db.prepare(`SELECT title, source_provider FROM tasks`).all()).toEqual([{ title: "Graduation", source_provider: "google" }]);
    const calendar = db.prepare(`SELECT sync_token, window_listed_at FROM integration_calendars WHERE integration_id = ?`).get(id);
    expect(calendar.sync_token).toBe("cursor-2");
    expect(Date.now() - Date.parse(calendar.window_listed_at)).toBeLessThan(5000);

    // Not again within the day.
    calls.length = 0;
    await syncIntegration(db, config, integration(id));
    expect(calls.filter((c) => c.endsWith(" window"))).toHaveLength(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n).toBe(1);
  });

  it("the same for Apple", async () => {
    const { id } = seedIntegration("apple", { windowListedAt: null });
    const calls = apple({ inWindow: appleChange(`${ACAL}far.ics`, { summary: "Graduation" }) });

    await syncIntegration(db, config, integration(id));

    expect(calls).toEqual(["changes", "window"]);
    expect(db.prepare(`SELECT title FROM tasks`).all()).toEqual([{ title: "Graduation" }]);
    expect(db.prepare(`SELECT sync_token FROM integration_calendars WHERE integration_id = ?`).get(id).sync_token).toBe("cursor-2");
  });
});

describe("a sync round that reached no calendar", () => {
  it("says why on the connection instead of claiming it synced", async () => {
    const { id } = seedIntegration("google");
    vi.stubGlobal("fetch", vi.fn(async (url) => (String(url).includes("/events") ? json({ error: { message: "Rate Limit Exceeded" } }, 403) : json({ items: [] }))));

    await syncIntegration(db, config, integration(id));

    const row = integration(id);
    expect(row.last_error).toMatch(/Google events list failed \(403\)/);
    expect(row.last_synced_at).toBeNull();
  });
});

describe("a change on its way to a calendar", () => {
  it("is kept when the calendar can't be reached, and sent later as the task is by then", async () => {
    const { id } = seedIntegration("google");
    const task = insertTask("task_out0", { title: "First wording" });
    let down = true;
    const sent = [];
    google({
      onWrite: (method, _u, options) => {
        if (method === "FIND") return json({ items: [] });
        if (down) throw new TypeError("fetch failed");
        sent.push({ method, body: JSON.parse(String(options.body)) });
        return json({ id: "ev_new", etag: "e1" });
      },
    });

    enqueueTaskPush(db, config, { op: "upsert", appId: APP, taskSnapshot: task });
    // Written down before anything is sent: a restart here loses nothing.
    expect(outbox()).toEqual([expect.objectContaining({ task_id: "task_out0", op: "upsert", attempts: 0 })]);
    await settle();

    expect(sent).toEqual([]);
    expect(outbox()).toEqual([expect.objectContaining({ task_id: "task_out0", attempts: 1, failed_integration_id: id, last_error: "Couldn't reach Google Calendar." })]);
    expect(listIntegrationsForUser(db, { appId: APP, userId: "user_1" })[0].waiting_changes).toBe(1);
    // Not yet its turn.
    expect(retryDuePushes(db, config)).toBe(0);

    down = false;
    db.prepare(`UPDATE tasks SET title = 'Second wording' WHERE id = 'task_out0'`).run();
    makeDue();
    expect(retryDuePushes(db, config)).toBe(1);
    await settle();

    expect(sent).toEqual([expect.objectContaining({ method: "POST", body: expect.objectContaining({ summary: "Second wording" }) })]);
    expect(outbox()).toEqual([]);
    expect(mapRow("task_out0")).toMatchObject({ external_event_id: "ev_new" });
    expect(listIntegrationsForUser(db, { appId: APP, userId: "user_1" })[0].waiting_changes).toBe(0);
  }, 20_000);

  it("doesn't make a second event when the first try did arrive and only the answer was lost", async () => {
    const { id } = seedIntegration("google");
    const task = insertTask("task_out1", { title: "Once only" });
    rememberPush(db, { op: "upsert", appId: APP, taskSnapshot: task });
    makeDue();
    const sent = [];
    google({
      onWrite: (method, u) => {
        sent.push(`${method} ${u.pathname.split("/events")[1] || ""}`);
        if (method === "FIND") return json({ items: [{ id: "ev_made_earlier", etag: "e0", status: "confirmed" }] });
        return json({ id: "ev_made_earlier", etag: "e1" });
      },
    });

    retryDuePushes(db, config);
    await settle();

    expect(sent).toEqual(["FIND ", "PATCH /ev_made_earlier"]);
    expect(mapRow("task_out1")).toMatchObject({ integration_id: id, external_event_id: "ev_made_earlier", etag: "e1" });
    expect(outbox()).toEqual([]);
  });

  it("is dropped at once when the calendar says the change itself is wrong, and after the last wait otherwise", () => {
    seedIntegration("google");
    const task = insertTask("task_out2");
    const refused = Object.assign(new Error("bad"), { statusCode: 400 });
    const busy = Object.assign(new Error("busy"), { statusCode: 503 });

    let token = rememberPush(db, { op: "upsert", appId: APP, taskSnapshot: task });
    expect(failPush(db, { taskId: "task_out2", token, integrationId: "intg_google", error: refused })).toBe("dropped");
    expect(outbox()).toEqual([]);

    token = rememberPush(db, { op: "upsert", appId: APP, taskSnapshot: task });
    for (let n = 0; n < RETRY_DELAYS_MS.length; n += 1) {
      expect(failPush(db, { taskId: "task_out2", token, integrationId: "intg_google", error: busy })).toBe("waiting");
    }
    expect(outbox()[0].attempts).toBe(RETRY_DELAYS_MS.length);
    expect(failPush(db, { taskId: "task_out2", token, integrationId: "intg_google", error: busy })).toBe("dropped");
    expect(outbox()).toEqual([]);

    // An older try finishing late can't touch the row of a newer change.
    const older = rememberPush(db, { op: "upsert", appId: APP, taskSnapshot: task });
    rememberPush(db, { op: "upsert", appId: APP, taskSnapshot: task });
    expect(failPush(db, { taskId: "task_out2", token: older, integrationId: "intg_google", error: busy })).toBe("superseded");
    expect(outbox()[0].attempts).toBe(0);
  });

  it("a delete right after an edit doesn't let the edit go out afterwards and bring the event back", async () => {
    const { id } = seedIntegration("google");
    const task = insertTask("task_out3", { title: "Short-lived" });
    link("task_out3", id, "ev1", GCAL);
    const sent = [];
    google({
      onWrite: (method, u) => {
        sent.push(`${method} ${u.pathname.split("/events")[1] || ""}`);
        return method === "DELETE" ? new Response(null, { status: 204 }) : json({ id: "ev1", etag: "e2" });
      },
    });

    enqueueTaskPush(db, config, { op: "upsert", appId: APP, taskSnapshot: task });
    db.prepare(`DELETE FROM tasks WHERE id = 'task_out3'`).run();
    enqueueTaskPush(db, config, { op: "delete", appId: APP, taskSnapshot: task });
    await settle();

    expect(sent).toEqual(["DELETE /ev1"]);
    expect(mapRow("task_out3")).toBeUndefined();
    expect(outbox()).toEqual([]);
  });

  it("an edit made moments after sync touched the same task still goes out", async () => {
    const { id } = seedIntegration("google");
    insertTask("task_both", { title: "Before" });
    link("task_both", id, "ev1", GCAL);
    const sent = [];
    google({
      changed: [googleEvent("ev1")],
      onWrite: (method, _u, options) => (sent.push({ method, summary: JSON.parse(String(options.body)).summary }), json({ id: "ev1", etag: "e3" })),
    });
    await syncIntegration(db, config, integration(id));
    expect(taskRow("task_both").title).toBe("Moved in Google");

    db.prepare(`UPDATE tasks SET title = 'Renamed here straight after' WHERE id = 'task_both'`).run();
    enqueueTaskPush(db, config, { op: "upsert", appId: APP, taskSnapshot: taskRow("task_both") });
    await settle();

    expect(sent).toEqual([{ method: "PATCH", summary: "Renamed here straight after" }]);
  });

  it("writes nothing down for someone with no calendar connected", () => {
    const task = insertTask("task_out4");
    enqueueTaskPush(db, config, { op: "upsert", appId: APP, taskSnapshot: task });
    expect(outbox()).toEqual([]);
  });
});

describe("changing an event that already exists at Google", () => {
  const timed = { summary: "T", start: { dateTime: "2026-05-04T09:00:00", timeZone: "America/New_York" }, end: { dateTime: "2026-05-04T10:00:00", timeZone: "America/New_York" } };
  const allDay = { summary: "T", start: { date: "2026-05-04" }, end: { date: "2026-05-05" } };

  it("says which kind of start no longer applies, so an all-day event can be given a time and back", () => {
    expect(asChangeToExistingEvent(timed, {})).toMatchObject({ start: { ...timed.start, date: null }, end: { ...timed.end, date: null } });
    expect(asChangeToExistingEvent(allDay, {})).toMatchObject({ start: { date: "2026-05-04", dateTime: null }, end: { date: "2026-05-05", dateTime: null } });
  });

  it("says so when the task no longer repeats or has no priority colour, but leaves a calendar event's own colour alone", () => {
    expect(asChangeToExistingEvent(allDay, {})).toMatchObject({ recurrence: null, colorId: null });
    const repeating = asChangeToExistingEvent({ ...allDay, recurrence: ["RRULE:FREQ=DAILY"], colorId: "11" }, {});
    expect(repeating).toMatchObject({ recurrence: ["RRULE:FREQ=DAILY"], colorId: "11" });
    expect("colorId" in asChangeToExistingEvent(allDay, { source_provider: "google" })).toBe(false);
  });

  it("sends that form when a task with an all-day event is given a time", async () => {
    const { id } = seedIntegration("google");
    const task = insertTask("task_out7", { title: "Now at nine", task_time: "9:00AM" });
    link("task_out7", id, "ev1", GCAL);
    /** @type {any} */
    let patch = null;
    google({ onWrite: (_method, _u, options) => ((patch = JSON.parse(String(options.body))), json({ id: "ev1", etag: "e2" })) });

    enqueueTaskPush(db, config, { op: "upsert", appId: APP, taskSnapshot: task });
    await settle();

    expect(patch.start).toEqual({ dateTime: "2026-05-04T09:00:00", timeZone: "America/New_York", date: null });
    expect(patch.recurrence).toBeNull();
  });
});

describe("a calendar server that doesn't answer", () => {
  it("is given up on after the time limit, as a 'gateway timeout'", async () => {
    vi.stubGlobal("fetch", (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }));
    await expect(fetchWithTimeout("Google Calendar", "https://example.com", {}, 30)).rejects.toMatchObject({
      statusCode: 504,
      unreachable: true,
      message: "Google Calendar didn't answer within 0 seconds.",
    });
  });

  it("and one that can't be reached at all is a 503, not a refused sign-in", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchWithTimeout("iCloud Calendar", "https://example.com")).rejects.toMatchObject({ statusCode: 503, message: "Couldn't reach iCloud Calendar." });
  });
});
