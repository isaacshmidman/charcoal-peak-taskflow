/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import {
  getUserNotificationSettings,
  runNotificationSweep,
  sendTestNotification,
  unsubscribeNotificationSubscription,
  updateUserNotificationSettings,
  upsertNotificationSubscription,
} from "./notifications.js";

let tempDir = "";
let db;
let config;

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
    integrationsEnabled: false,
    syncIntervalMs: 60000,
    notificationPollMs: 60000,
    vapidPublicKey: "public-key",
    vapidPrivateKey: "private-key",
    vapidSubject: "mailto:test@example.com",
  };
}

function seedUser() {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, app_id, email, role, auth_provider, preferences_json, created_date, updated_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("user_1", "test-app", "isaac@example.com", "admin", "local", "{}", now, now);
  return { id: "user_1", email: "isaac@example.com" };
}

function insertTask({
  id,
  title,
  dueDate,
  taskTime = "",
  status = "todo",
  parentId = "",
  sourceKind = "",
}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
       id, app_id, parent_id, title, status, task_type, recurrence,
       recurrence_days_json, due_date, task_time, tags_json, created_date,
       updated_date, created_by_id, created_by, source_kind
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    "test-app",
    parentId,
    title,
    status,
    "one_time",
    "none",
    "[]",
    dueDate,
    taskTime,
    "[]",
    now,
    now,
    "user_1",
    "isaac@example.com",
    sourceKind
  );
}

function fakeSubscription(endpoint = "https://push.example.com/sub-1") {
  return {
    endpoint,
    keys: {
      p256dh: "p256dh-key",
      auth: "auth-key",
    },
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "zephyrly-notifications-"));
  config = makeConfig(join(tempDir, "taskflow.sqlite"));
  db = createDatabase(config);
});

afterEach(() => {
  db?.close();
  db = null;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("notification settings and subscriptions", () => {
  it("returns defaults, sanitizes settings, and persists preferences_json", () => {
    const user = seedUser();
    expect(getUserNotificationSettings(db, { appId: "test-app", userId: user.id })).toMatchObject({
      defaulted: true,
      settings: {
        enabled: false,
        timedOffsetMinutes: 0,
        allDayTime: "9:00AM",
        missedGraceMinutes: 120,
      },
    });

    const updated = updateUserNotificationSettings(db, {
      appId: "test-app",
      userId: user.id,
      input: {
        enabled: true,
        timeZone: "Not/AZone",
        timedOffsetMinutes: -999999,
        allDayTime: "25:99PM",
        includeExternalEvents: true,
        missedGraceMinutes: 999999,
      },
    });

    expect(updated).toMatchObject({
      enabled: true,
      timeZone: "UTC",
      timedOffsetMinutes: -10080,
      allDayTime: "9:00AM",
      includeExternalEvents: true,
      missedGraceMinutes: 1440,
    });
    const stored = JSON.parse(db.prepare(`SELECT preferences_json FROM users WHERE id = ?`).get(user.id).preferences_json);
    expect(stored.notificationSettings).toEqual(updated);
  });

  it("upserts and disables subscriptions by endpoint", () => {
    const user = seedUser();
    const first = upsertNotificationSubscription(db, {
      appId: "test-app",
      user,
      subscription: fakeSubscription(),
      userAgent: "Vitest",
    });
    const second = upsertNotificationSubscription(db, {
      appId: "test-app",
      user,
      subscription: fakeSubscription(),
      userAgent: "Vitest 2",
    });

    expect(second.id).toBe(first.id);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM notification_subscriptions`).get().count).toBe(1);

    unsubscribeNotificationSubscription(db, {
      appId: "test-app",
      user,
      endpoint: fakeSubscription().endpoint,
    });
    expect(db.prepare(`SELECT status FROM notification_subscriptions WHERE id = ?`).get(first.id).status).toBe("disabled");
  });
});

describe("notification scheduler", () => {
  it("sends due timed and all-day tasks once, respecting grace and external-event settings", async () => {
    const user = seedUser();
    updateUserNotificationSettings(db, {
      appId: "test-app",
      userId: user.id,
      input: {
        enabled: true,
        timeZone: "UTC",
        timedOffsetMinutes: -10,
        allDayEnabled: true,
        allDayTime: "1:00PM",
        missedGraceMinutes: 120,
        includeExternalEvents: false,
      },
    });
    upsertNotificationSubscription(db, { appId: "test-app", user, subscription: fakeSubscription() });

    insertTask({ id: "task_timed", title: "Timed", dueDate: "2026-05-04", taskTime: "2:00PM" });
    insertTask({ id: "task_all_day", title: "All day", dueDate: "2026-05-04" });
    insertTask({ id: "task_old", title: "Old", dueDate: "2026-05-04", taskTime: "8:00AM" });
    insertTask({ id: "task_done", title: "Done", dueDate: "2026-05-04", taskTime: "2:00PM", status: "done" });
    insertTask({ id: "task_sub", title: "Sub", dueDate: "2026-05-04", taskTime: "2:00PM", parentId: "task_timed" });
    insertTask({ id: "task_event", title: "External", dueDate: "2026-05-04", taskTime: "2:00PM", sourceKind: "event" });

    const sentPayloads = [];
    const sendNotification = async (_config, _subscription, payload) => {
      sentPayloads.push(payload);
    };

    const result = await runNotificationSweep(db, config, {
      now: new Date("2026-05-04T13:50:00.000Z"),
      sendNotification,
    });

    expect(result.sent).toBe(2);
    expect(sentPayloads.map((p) => p.data.taskId).sort()).toEqual(["task_all_day", "task_timed"]);

    const again = await runNotificationSweep(db, config, {
      now: new Date("2026-05-04T13:51:00.000Z"),
      sendNotification,
    });
    expect(again.sent).toBe(0);

    updateUserNotificationSettings(db, {
      appId: "test-app",
      userId: user.id,
      input: { includeExternalEvents: true },
    });
    await runNotificationSweep(db, config, {
      now: new Date("2026-05-04T13:52:00.000Z"),
      sendNotification,
    });
    expect(sentPayloads.map((p) => p.data.taskId)).toContain("task_event");
  });

  it("marks failed deliveries and disables expired push subscriptions", async () => {
    const user = seedUser();
    updateUserNotificationSettings(db, {
      appId: "test-app",
      userId: user.id,
      input: { enabled: true, timeZone: "UTC", timedOffsetMinutes: 0 },
    });
    const subscription = upsertNotificationSubscription(db, {
      appId: "test-app",
      user,
      subscription: fakeSubscription("https://push.example.com/expired"),
    });
    insertTask({ id: "task_fail", title: "Fail", dueDate: "2026-05-04", taskTime: "2:00PM" });

    await runNotificationSweep(db, config, {
      now: new Date("2026-05-04T14:00:00.000Z"),
      sendNotification: async () => {
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      },
    });

    expect(db.prepare(`SELECT status, last_error FROM notification_subscriptions WHERE id = ?`).get(subscription.id)).toMatchObject({
      status: "disabled",
      last_error: "Gone",
    });
    expect(db.prepare(`SELECT status FROM task_notification_deliveries WHERE task_id = ?`).get("task_fail").status).toBe("failed");
  });

  it("sends immediate test notifications to active subscriptions", async () => {
    const user = seedUser();
    upsertNotificationSubscription(db, { appId: "test-app", user, subscription: fakeSubscription() });
    const result = await sendTestNotification(db, config, {
      appId: "test-app",
      user,
      sendNotification: async () => {},
    });
    expect(result).toEqual({ sent: 1, failed: 0 });
  });
});
