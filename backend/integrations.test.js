/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "./crypto.js";
import { createDatabase } from "./db.js";
import {
  connectApple,
  disconnectIntegration,
  setEnabledCalendars,
  setPrimaryCalendar,
} from "./integrations.js";
import { exchangeCode as exchangeGoogleCode } from "./providers/google-calendar.js";
import {
  mapVEventToTaskInput,
  parseVEvent,
  putEvent as putAppleEvent,
} from "./providers/apple-calendar.js";
import { backfillGoogleEventMetadata } from "./google-metadata-backfill.js";
import { enqueueTaskPush, taskToEventBody, waitForPushIdle } from "./push.js";
import { mapGoogleEventToTaskInput, syncIntegration } from "./sync.js";

let tempDir = "";
let config;
let db;

function makeConfig(dbFile) {
  return {
    host: "127.0.0.1",
    port: 0,
    appId: "test-app",
    appName: "Zephyrly Test",
    publicAppUrl: "http://127.0.0.1:4173",
    dbFile,
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
    integrationsEnabled: true,
    syncIntervalMs: 60000,
  };
}

function testUser() {
  return {
    id: "user_1",
    email: "isaac@example.com",
    role: "admin",
    auth_provider: "local",
  };
}

function seedUser() {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, app_id, email, role, auth_provider, created_date, updated_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("user_1", "test-app", "isaac@example.com", "admin", "local", now, now);
}

function seedAppleIntegration({ integrationId = "intg_apple", calendarId = "https://caldav.example.com/cal/1/" } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO calendar_integrations (
       id, app_id, user_id, provider, external_account_id, external_account_email,
       refresh_token_enc, scopes, primary_calendar_id, primary_calendar_timezone, status, is_default,
       created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    integrationId,
    "test-app",
    "user_1",
    "apple",
    "isaac@example.com",
    "isaac@example.com",
    encryptSecret("app-password", integrationId),
    "caldav",
    calendarId,
    "America/New_York",
    "active",
    1,
    now,
    now
  );
  db.prepare(
    `INSERT INTO integration_calendars (
       id, app_id, integration_id, external_calendar_id, summary, time_zone,
       color_hex, access_role, primary_flag, sync_enabled, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `cal_${integrationId}`,
    "test-app",
    integrationId,
    calendarId,
    "Work",
    "America/New_York",
    "#3174ad",
    "owner",
    1,
    1,
    now,
    now
  );
  return { integrationId, calendarId };
}

function seedGoogleIntegration({ integrationId = "intg_google", calendarId = "primary@example.com" } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO calendar_integrations (
       id, app_id, user_id, provider, external_account_id, external_account_email,
       access_token_enc, refresh_token_enc, token_expires_at, scopes,
       primary_calendar_id, primary_calendar_timezone, status, is_default,
       created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    integrationId,
    "test-app",
    "user_1",
    "google",
    "google-subject",
    "isaac@example.com",
    encryptSecret("access-token", integrationId),
    encryptSecret("refresh-token", integrationId),
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    "https://www.googleapis.com/auth/calendar.events",
    calendarId,
    "America/New_York",
    "active",
    1,
    now,
    now
  );
  db.prepare(
    `INSERT INTO integration_calendars (
       id, app_id, integration_id, external_calendar_id, summary, time_zone,
       color_hex, access_role, primary_flag, sync_enabled, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `cal_${integrationId}`,
    "test-app",
    integrationId,
    calendarId,
    "Primary",
    "America/New_York",
    "#3174ad",
    "owner",
    1,
    1,
    now,
    now
  );
  return { integrationId, calendarId };
}

function insertTask({
  id,
  title,
  dueDate = "",
  sourceProvider = "",
  sourceKind = "",
  sourceCalendarId = "",
  sourceCalendarName = "",
  sourceColorHex = "",
  sourceWritable = 1,
  sourceRecurrenceRule = "",
}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
       id, app_id, title, status, task_type, recurrence, recurrence_days_json,
       due_date, tags_json, created_date, updated_date, created_by_id, created_by,
       source_provider, source_kind, source_calendar_id, source_calendar_name,
       source_color_hex, source_writable, source_recurrence_rule
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    "test-app",
    title,
    "todo",
    "one_time",
    "none",
    "[]",
    dueDate,
    "[]",
    now,
    now,
    "user_1",
    "isaac@example.com",
    sourceProvider,
    sourceKind,
    sourceCalendarId,
    sourceCalendarName,
    sourceColorHex,
    sourceWritable,
    sourceRecurrenceRule
  );
}

function insertMap({ id, integrationId, taskId, eventId, calendarId, etag = "" }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO external_event_map (
       id, app_id, integration_id, task_id, external_event_id,
       external_calendar_id, etag, last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, "test-app", integrationId, taskId, eventId, calendarId, etag, now, now, now);
}

function multistatus(inner) {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/" xmlns:CS="http://calendarserver.org/ns/">
${inner}
</D:multistatus>`;
}

function xmlResponse(xml, status = 207, headers = {}) {
  return new Response(status === 204 || status === 304 ? null : xml, { status, headers });
}

function applePrincipalXml() {
  return multistatus(`
  <D:response>
    <D:href>/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/principal/user/</D:href></D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);
}

function appleHomeXml() {
  return multistatus(`
  <D:response>
    <D:href>/principal/user/</D:href>
    <D:propstat>
      <D:prop>
        <C:calendar-home-set><D:href>/calendars/user/</D:href></C:calendar-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);
}

function appleCalendarListXml({
  calendarPath = "/calendars/user/work/",
  displayName = "Calendar",
  color = "#ff2968ff",
  writable = true,
} = {}) {
  const privilege = writable ? "<D:privilege><D:write-content/></D:privilege>" : "<D:privilege><D:read/></D:privilege>";
  return multistatus(`
  <D:response>
    <D:href>/calendars/user/</D:href>
    <D:propstat>
      <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>${calendarPath}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${displayName}</D:displayname>
        <D:current-user-privilege-set>${privilege}</D:current-user-privilege-set>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
        <C:calendar-timezone>BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:America/New_York
END:VTIMEZONE
END:VCALENDAR</C:calendar-timezone>
        <A:calendar-color>${color}</A:calendar-color>
        <CS:getctag>ctag-1</CS:getctag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);
}

function appleEventListXml({
  href = "/calendars/user/work/zephyrly-task_native.ics",
  etag = "etag-1",
  uid = "zephyrly-task_native@zephyrly",
  summary = "Provider edit",
} = {}) {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    "DTSTART;VALUE=DATE:20260504",
    "DTEND;VALUE=DATE:20260505",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return multistatus(`
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"${etag}"</D:getetag>
        <C:calendar-data>${ics}</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);
}

function appleSyncTokenXml(token = "sync-1") {
  return multistatus(`<D:sync-token>${token}</D:sync-token>`);
}

function mockAppleDiscoveryFetch({ calendarPath = "/calendars/user/work/" } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options = {}) => {
      const method = String(options.method || "GET");
      const body = String(options.body || "");
      if (method === "PROPFIND" && body.includes("current-user-principal")) {
        return xmlResponse(applePrincipalXml());
      }
      if (method === "PROPFIND" && body.includes("calendar-home-set")) {
        return xmlResponse(appleHomeXml());
      }
      if (method === "PROPFIND" && body.includes("supported-calendar-component-set")) {
        return xmlResponse(appleCalendarListXml({ calendarPath }));
      }
      throw new Error(`Unexpected Apple discovery request: ${method} ${body.slice(0, 80)}`);
    })
  );
}

function mockAppleSyncFetch({ calendarPath = "/calendars/user/work/" } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options = {}) => {
      const method = String(options.method || "GET");
      const body = String(options.body || "");
      if (method === "PROPFIND" && body.includes("current-user-principal")) {
        return xmlResponse(applePrincipalXml());
      }
      if (method === "PROPFIND" && body.includes("calendar-home-set")) {
        return xmlResponse(appleHomeXml());
      }
      if (method === "PROPFIND" && body.includes("supported-calendar-component-set")) {
        return xmlResponse(appleCalendarListXml({ calendarPath }));
      }
      if (method === "REPORT" && body.includes("calendar-query")) {
        return xmlResponse(appleEventListXml());
      }
      if (method === "REPORT" && body.includes("sync-collection")) {
        return xmlResponse(appleSyncTokenXml());
      }
      throw new Error(`Unexpected Apple sync request: ${method} ${body.slice(0, 80)}`);
    })
  );
}

beforeEach(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "a".repeat(64);
  tempDir = mkdtempSync(join(tmpdir(), "zephyrly-integrations-"));
  config = makeConfig(join(tempDir, "taskflow.sqlite"));
  db = createDatabase(config);
  seedUser();
});

afterEach(() => {
  db?.close();
  db = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("connectApple", () => {
  it("verifies credentials and seeds discovered calendars", async () => {
    mockAppleDiscoveryFetch();

    const result = await connectApple(db, config, {
      user: testUser(),
      appId: "test-app",
      email: "ISAAC@EXAMPLE.COM",
      password: "abcd efgh ijkl mnop",
    });

    expect(result.integrationId).toMatch(/^intg_/);
    const integration = db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(result.integrationId);
    expect(integration).toMatchObject({
      provider: "apple",
      external_account_id: "isaac@example.com",
      external_account_email: "isaac@example.com",
      primary_calendar_id: "https://caldav.icloud.com/calendars/user/work/",
      primary_calendar_timezone: "America/New_York",
      status: "active",
      is_default: 1,
    });
    expect(integration.refresh_token_enc).toMatch(/^v1:/);
    expect(integration.refresh_token_enc).not.toContain("abcdefghijklmnop");

    const calendars = db.prepare(`SELECT * FROM integration_calendars WHERE integration_id = ?`).all(result.integrationId);
    expect(calendars).toHaveLength(1);
    expect(calendars[0]).toMatchObject({
      external_calendar_id: "https://caldav.icloud.com/calendars/user/work/",
      summary: "Calendar",
      time_zone: "America/New_York",
      color_hex: "#ff2968",
      access_role: "writer",
      primary_flag: 1,
      sync_enabled: 1,
    });
  });
});

describe("setEnabledCalendars", () => {
  it("disables and re-enables without dropping non-event mappings", () => {
    const { integrationId, calendarId } = seedAppleIntegration();
    db.prepare(
      `UPDATE integration_calendars SET sync_token = ? WHERE integration_id = ? AND external_calendar_id = ?`
    ).run("sync-token", integrationId, calendarId);
    insertTask({
      id: "task_event",
      title: "Imported holiday",
      sourceProvider: "apple",
      sourceKind: "event",
      sourceCalendarId: calendarId,
      sourceWritable: 0,
    });
    insertTask({
      id: "task_provider",
      title: "Provider task",
      sourceProvider: "apple",
      sourceKind: "task",
      sourceCalendarId: calendarId,
    });
    insertTask({ id: "task_native", title: "Native task" });
    insertMap({ id: "map_event", integrationId, taskId: "task_event", eventId: "event_1", calendarId });
    insertMap({ id: "map_provider", integrationId, taskId: "task_provider", eventId: "event_2", calendarId });
    insertMap({ id: "map_native", integrationId, taskId: "task_native", eventId: "event_3", calendarId });

    setEnabledCalendars(db, integrationId, { [calendarId]: false });

    expect(db.prepare(`SELECT id FROM tasks WHERE id = ?`).get("task_event")).toBeUndefined();
    expect(db.prepare(`SELECT id FROM external_event_map WHERE id = ?`).get("map_event")).toBeUndefined();
    expect(db.prepare(`SELECT id FROM external_event_map WHERE id = ?`).get("map_provider")).toBeTruthy();
    expect(db.prepare(`SELECT id FROM external_event_map WHERE id = ?`).get("map_native")).toBeTruthy();
    const disabled = db
      .prepare(`SELECT sync_enabled, sync_token FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`)
      .get(integrationId, calendarId);
    expect(disabled).toMatchObject({ sync_enabled: 0, sync_token: null });

    setEnabledCalendars(db, integrationId, { [calendarId]: true });
    const enabled = db
      .prepare(`SELECT sync_enabled FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`)
      .get(integrationId, calendarId);
    expect(enabled.sync_enabled).toBe(1);
  });
});

describe("setPrimaryCalendar", () => {
  it("rejects read-only calendars as primary destinations", () => {
    const { integrationId, calendarId } = seedAppleIntegration();
    const readOnlyCalendarId = "https://caldav.example.com/cal/readonly/";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO integration_calendars (
         id, app_id, integration_id, external_calendar_id, summary, time_zone,
         color_hex, access_role, primary_flag, sync_enabled, created_date, updated_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "cal_readonly",
      "test-app",
      integrationId,
      readOnlyCalendarId,
      "Holidays",
      "America/New_York",
      "#94a3b8",
      "reader",
      0,
      1,
      now,
      now
    );

    expect(() =>
      setPrimaryCalendar(db, {
        appId: "test-app",
        userId: "user_1",
        integrationId,
        externalCalendarId: readOnlyCalendarId,
      })
    ).toThrow(/Primary calendar must be writable/);

    const integration = db.prepare(`SELECT primary_calendar_id FROM calendar_integrations WHERE id = ?`).get(integrationId);
    expect(integration.primary_calendar_id).toBe(calendarId);
    const rows = db.prepare(`SELECT external_calendar_id, primary_flag FROM integration_calendars WHERE integration_id = ?`).all(integrationId);
    expect(rows.find((row) => row.external_calendar_id === calendarId)?.primary_flag).toBe(1);
    expect(rows.find((row) => row.external_calendar_id === readOnlyCalendarId)?.primary_flag).toBe(0);
  });
});

describe("disconnectIntegration", () => {
  it("removes imported events and localizes kept provider-origin tasks", async () => {
    const { integrationId, calendarId } = seedAppleIntegration();
    insertTask({
      id: "task_event",
      title: "Imported holiday",
      sourceProvider: "apple",
      sourceKind: "event",
      sourceCalendarId: calendarId,
      sourceCalendarName: "Work",
      sourceColorHex: "#3174ad",
      sourceWritable: 0,
    });
    insertTask({
      id: "task_provider",
      title: "Provider task to keep",
      sourceProvider: "apple",
      sourceKind: "task",
      sourceCalendarId: calendarId,
      sourceCalendarName: "Work",
      sourceColorHex: "#3174ad",
      sourceRecurrenceRule: "RRULE:FREQ=WEEKLY",
    });
    insertTask({ id: "task_native", title: "Native task" });
    insertMap({ id: "map_event", integrationId, taskId: "task_event", eventId: "event_1", calendarId });
    insertMap({ id: "map_provider", integrationId, taskId: "task_provider", eventId: "event_2", calendarId });
    insertMap({ id: "map_native", integrationId, taskId: "task_native", eventId: "event_3", calendarId });

    await disconnectIntegration(db, {
      appId: "test-app",
      userId: "user_1",
      id: integrationId,
    });

    expect(db.prepare(`SELECT id FROM tasks WHERE id = ?`).get("task_event")).toBeUndefined();
    const localized = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get("task_provider");
    expect(localized).toMatchObject({
      source_provider: "",
      source_kind: "",
      source_calendar_id: "",
      source_calendar_name: "",
      source_color_hex: "",
      source_writable: 1,
      source_recurrence_rule: "",
    });
    expect(db.prepare(`SELECT id FROM tasks WHERE id = ?`).get("task_native")).toBeTruthy();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM external_event_map`).get().count).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM integration_calendars`).get().count).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM calendar_integrations`).get().count).toBe(0);
  });
});

describe("database calendar-provenance cleanup", () => {
  it("localizes provider-origin task orphans on boot", () => {
    const calendarId = "https://caldav.example.com/orphan/";
    insertTask({
      id: "task_provider_orphan",
      title: "Old imported task",
      sourceProvider: "apple",
      sourceKind: "task",
      sourceCalendarId: calendarId,
      sourceCalendarName: "Old Work",
      sourceColorHex: "#3174ad",
      sourceRecurrenceRule: "RRULE:FREQ=DAILY",
    });
    insertTask({
      id: "task_event_orphan",
      title: "Old imported event",
      sourceProvider: "apple",
      sourceKind: "event",
      sourceCalendarId: calendarId,
      sourceCalendarName: "Old Work",
      sourceColorHex: "#3174ad",
      sourceWritable: 0,
    });

    db.close();
    db = createDatabase(config);

    const localized = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get("task_provider_orphan");
    expect(localized).toMatchObject({
      source_provider: "",
      source_kind: "",
      source_calendar_id: "",
      source_calendar_name: "",
      source_color_hex: "",
      source_writable: 1,
      source_recurrence_rule: "",
    });
    expect(db.prepare(`SELECT id FROM tasks WHERE id = ?`).get("task_event_orphan")).toBeUndefined();
  });
});

describe("calendar provider task mapping", () => {
  it("imports Google timed events in the calendar timezone with end times", () => {
    const mapped = mapGoogleEventToTaskInput(
      {
        id: "evt_1",
        summary: "Design review",
        description: "Bring notes",
        start: { dateTime: "2026-05-04T09:15:00-04:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-05-04T10:45:00-04:00", timeZone: "America/New_York" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260630T235959Z"],
      },
      {
        external_calendar_id: "primary@example.com",
        summary: "Primary",
        time_zone: "America/New_York",
        color_hex: "#3174ad",
        access_role: "owner",
      }
    );

    expect(mapped).toMatchObject({
      title: "Design review",
      description: "Bring notes",
      due_date: "2026-05-04",
      task_time: "9:15AM",
      task_end_time: "10:45AM",
      task_type: "recurring",
      recurrence: "custom_days",
      recurrence_days: [1, 3, 5],
      recurrence_end_date: "2026-06-30",
      source_provider: "google",
      source_kind: "task",
      source_recurrence_rule: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260630T235959Z",
    });
  });

  it("imports Apple timed VEVENTs with TZID and recurrence", () => {
    const event = parseVEvent([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:apple-1",
      "SUMMARY:Studio block",
      "DESCRIPTION:Sketch pass",
      "DTSTART;TZID=America/New_York:20260504T091500",
      "DTEND;TZID=America/New_York:20260504T104500",
      "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"));

    const mapped = mapVEventToTaskInput(event, {
      external_calendar_id: "https://caldav.example.com/cal/1/",
      summary: "Work",
      time_zone: "America/New_York",
      color_hex: "#3174ad",
      access_role: "owner",
    });

    expect(mapped).toMatchObject({
      title: "Studio block",
      description: "Sketch pass",
      due_date: "2026-05-04",
      task_time: "9:15AM",
      task_end_time: "10:45AM",
      task_type: "recurring",
      recurrence: "weekdays",
      recurrence_days: [],
      source_provider: "apple",
      source_kind: "task",
      source_recurrence_rule: "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
    });
  });

  it("pushes native recurrence fields and normalizes invalid timed ends", () => {
    const body = taskToEventBody(
      {
        id: "task_1",
        app_id: "test-app",
        title: "Late task",
        description: "",
        due_date: "2026-05-04",
        task_time: "11:30PM",
        task_end_time: "10:00PM",
        task_type: "recurring",
        recurrence: "weekly",
        source_recurrence_rule: "RRULE:FREQ=MONTHLY;BYDAY=1MO",
      },
      "America/New_York"
    );

    expect(body).toMatchObject({
      start: { dateTime: "2026-05-04T23:30:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-05-05T00:30:00", timeZone: "America/New_York" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
    });
  });
});

describe("Apple CalDAV provider", () => {
  it("retries PUT unconditionally after a 412 conflict", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(xmlResponse("stale", 412))
      .mockResolvedValueOnce(xmlResponse("", 204, { etag: '"fresh-etag"' }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await putAppleEvent(
      { origin: "https://caldav.example.com", email: "isaac@example.com", password: "app-password" },
      "https://caldav.example.com/calendars/user/work/zephyrly-task.ics",
      "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
      "old-etag"
    );

    expect(result).toEqual({ status: 204, etag: "fresh-etag" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers["If-Match"]).toBe("old-etag");
    expect(fetchMock.mock.calls[1][1].headers["If-Match"]).toBeUndefined();
  });
});

describe("Google Calendar OAuth", () => {
  it("rejects missing calendar metadata scopes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar.events openid email profile",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeGoogleCode({
      ...config,
      googleCalendarClientId: "client-id",
      googleCalendarClientSecret: "client-secret",
      hasGoogleCalendarCredentials: true,
    }, {
      code: "code",
      codeVerifier: "verifier",
    })).rejects.toThrow(/required Google Calendar scopes/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Google metadata backfill", () => {
  it("patches older native mapped events with Zephyrly private metadata", async () => {
    const { integrationId, calendarId } = seedGoogleIntegration();
    insertTask({ id: "task_native", title: "Native task", dueDate: "2026-05-04" });
    insertTask({
      id: "task_imported",
      title: "Imported event",
      dueDate: "2026-05-04",
      sourceProvider: "google",
      sourceKind: "task",
      sourceCalendarId: calendarId,
    });
    insertMap({
      id: "map_native",
      integrationId,
      taskId: "task_native",
      eventId: "event_native",
      calendarId,
      etag: "local-etag",
    });
    insertMap({
      id: "map_imported",
      integrationId,
      taskId: "task_imported",
      eventId: "event_imported",
      calendarId,
      etag: "imported-etag",
    });

    let patchBody = null;
    const fetchMock = vi.fn(async (url, options = {}) => {
      const method = String(options.method || "GET");
      const urlString = String(url);
      if (method === "GET" && urlString.includes("/events/event_native")) {
        return new Response(JSON.stringify({
          id: "event_native",
          etag: "remote-etag",
          extendedProperties: {
            private: {
              keepMe: "yes",
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "PATCH" && urlString.includes("/events/event_native")) {
        patchBody = JSON.parse(String(options.body || "{}"));
        expect(options.headers["If-Match"]).toBe("remote-etag");
        return new Response(JSON.stringify({ id: "event_native", etag: "patched-etag" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected Google backfill request: ${method} ${urlString}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const integration = db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(integrationId);
    const result = await backfillGoogleEventMetadata(db, {
      integration,
      accessToken: "access-token",
    });

    expect(result).toMatchObject({
      checked: 1,
      patched: 1,
      alreadyTagged: 0,
      skipped: 0,
      deleted: 0,
      errors: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(patchBody).toMatchObject({
      extendedProperties: {
        private: {
          keepMe: "yes",
          zephyrlyTaskId: "task_native",
          zephyrlyAppId: "test-app",
        },
      },
    });

    const nativeMap = db.prepare(`SELECT * FROM external_event_map WHERE id = ?`).get("map_native");
    expect(nativeMap.etag).toBe("patched-etag");
    expect(nativeMap.zephyrly_metadata_synced_at).toBeTruthy();
    const importedMap = db.prepare(`SELECT * FROM external_event_map WHERE id = ?`).get("map_imported");
    expect(importedMap.zephyrly_metadata_synced_at).toBeNull();
  });
});

describe("push backfill queue", () => {
  it("waits deterministically for debounced push jobs to drain", async () => {
    const { integrationId, calendarId } = seedGoogleIntegration();
    insertTask({ id: "task_backfill", title: "Backfill me", dueDate: "2026-05-04" });
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get("task_backfill");

    let createBody = null;
    const fetchMock = vi.fn(async (_url, options = {}) => {
      expect(String(options.method || "GET")).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer access-token");
      createBody = JSON.parse(String(options.body || "{}"));
      return new Response(JSON.stringify({ id: "event_backfill", etag: "event-etag" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    enqueueTaskPush(db, config, {
      op: "upsert",
      appId: "test-app",
      taskSnapshot: task,
    });
    await waitForPushIdle({ timeoutMs: 5000, pollMs: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createBody).toMatchObject({
      summary: "Backfill me",
      extendedProperties: {
        private: {
          zephyrlyTaskId: "task_backfill",
          zephyrlyAppId: "test-app",
        },
      },
    });
    const map = db.prepare(`SELECT * FROM external_event_map WHERE task_id = ?`).get("task_backfill");
    expect(map).toMatchObject({
      integration_id: integrationId,
      external_event_id: "event_backfill",
      external_calendar_id: calendarId,
      etag: "event-etag",
    });
    expect(map.zephyrly_metadata_synced_at).toBeTruthy();
  });

  it("pushes Apple timed events across midnight with valid ICS times", async () => {
    const { integrationId, calendarId } = seedAppleIntegration({
      calendarId: "https://caldav.example.com/cal/1/",
    });
    insertTask({ id: "task_late", title: "Late Apple task", dueDate: "2026-05-04" });
    db.prepare(
      `UPDATE tasks
       SET task_time = ?, task_end_time = ?
       WHERE id = ?`
    ).run("11:30PM", "10:00PM", "task_late");
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get("task_late");

    let icsBody = "";
    const fetchMock = vi.fn(async (_url, options = {}) => {
      expect(String(options.method || "GET")).toBe("PUT");
      icsBody = String(options.body || "");
      return new Response(null, {
        status: 204,
        headers: { etag: '"apple-etag"' },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    enqueueTaskPush(db, config, {
      op: "upsert",
      appId: "test-app",
      taskSnapshot: task,
    });
    await waitForPushIdle({ timeoutMs: 5000, pollMs: 5 });

    expect(icsBody).toContain("DTSTART;TZID=America/New_York:20260504T233000");
    expect(icsBody).toContain("DTEND;TZID=America/New_York:20260505T003000");
    expect(icsBody).not.toContain("T243000");
    const map = db.prepare(`SELECT * FROM external_event_map WHERE task_id = ?`).get("task_late");
    expect(map).toMatchObject({
      integration_id: integrationId,
      external_calendar_id: calendarId,
      etag: "apple-etag",
    });
  });
});

describe("syncIntegration relinking", () => {
  it("relinks Apple events with Zephyrly UIDs to existing native tasks", async () => {
    const { integrationId, calendarId } = seedAppleIntegration({
      calendarId: "https://caldav.icloud.com/calendars/user/work/",
    });
    insertTask({ id: "task_native", title: "Native task" });
    mockAppleSyncFetch();

    const integration = db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(integrationId);
    await syncIntegration(db, config, integration);

    const tasks = db.prepare(`SELECT * FROM tasks ORDER BY id`).all();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "task_native",
      title: "Provider edit",
      source_provider: "",
      source_kind: "",
      source_calendar_id: "",
    });
    const map = db.prepare(`SELECT * FROM external_event_map WHERE task_id = ?`).get("task_native");
    expect(map).toMatchObject({
      integration_id: integrationId,
      external_event_id: "https://caldav.icloud.com/calendars/user/work/zephyrly-task_native.ics",
      external_calendar_id: calendarId,
      etag: "etag-1",
    });
    const calendar = db.prepare(`SELECT sync_token FROM integration_calendars WHERE integration_id = ?`).get(integrationId);
    expect(calendar.sync_token).toBe("sync-1");
  });
});
