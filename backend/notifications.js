// @ts-check
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fromZonedTime } from "date-fns-tz";
import { HttpError } from "./http.js";
import { log } from "./log.js";

const require = createRequire(import.meta.url);
/** @type {any} */
const webpush = require("web" + "-push");

const DEFAULT_SETTINGS = {
  enabled: false,
  timeZone: "UTC",
  timedOffsetMinutes: 0,
  allDayEnabled: true,
  allDayTime: "9:00AM",
  includeExternalEvents: false,
  missedGraceMinutes: 120,
};

const MAX_OFFSET_MINUTES = 7 * 24 * 60;
const MAX_GRACE_MINUTES = 24 * 60;
const MINUTE_MS = 60 * 1000;

/** @type {NodeJS.Timeout | null} */
let intervalHandle = null;
/** @type {NodeJS.Timeout | null} */
let initialTimeoutHandle = null;
let loopRunning = false;
let configuredVapidKey = "";

export function isNotificationsConfigured(config) {
  return Boolean(config?.vapidPublicKey && config?.vapidPrivateKey);
}

export function getNotificationAvailability(config) {
  const available = isNotificationsConfigured(config);
  return {
    available,
    vapidPublicKey: available ? String(config.vapidPublicKey || "") : "",
    reason: available ? "" : "Web Push is not configured on this server.",
  };
}

export function defaultNotificationSettings(overrides = {}) {
  return sanitizeNotificationSettings(overrides);
}

export function sanitizeNotificationSettings(input = {}, existing = {}) {
  const source = { ...DEFAULT_SETTINGS, ...existing, ...input };
  return {
    enabled: Boolean(source.enabled),
    timeZone: sanitizeTimeZone(source.timeZone),
    timedOffsetMinutes: clampInteger(source.timedOffsetMinutes, -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES, 0),
    allDayEnabled: source.allDayEnabled !== false,
    allDayTime: minutesToTaskTime(parseTaskTime(source.allDayTime) ?? parseTaskTime(DEFAULT_SETTINGS.allDayTime)),
    includeExternalEvents: Boolean(source.includeExternalEvents),
    missedGraceMinutes: clampInteger(source.missedGraceMinutes, 0, MAX_GRACE_MINUTES, DEFAULT_SETTINGS.missedGraceMinutes),
  };
}

export function getUserNotificationSettings(db, { appId, userId }) {
  const row = db
    .prepare(`SELECT preferences_json FROM users WHERE app_id = ? AND id = ?`)
    .get(appId, userId);
  if (!row) throw new HttpError(404, "User not found.", "not_found");
  const preferences = parsePreferences(row.preferences_json);
  const raw = preferences.notificationSettings;
  return {
    settings: sanitizeNotificationSettings(raw || {}),
    defaulted: !raw,
  };
}

export function updateUserNotificationSettings(db, { appId, userId, input }) {
  const row = db
    .prepare(`SELECT preferences_json FROM users WHERE app_id = ? AND id = ?`)
    .get(appId, userId);
  if (!row) throw new HttpError(404, "User not found.", "not_found");
  const preferences = parsePreferences(row.preferences_json);
  const current = sanitizeNotificationSettings(preferences.notificationSettings || {});
  const next = sanitizeNotificationSettings(input || {}, current);
  preferences.notificationSettings = next;
  db.prepare(
    `UPDATE users SET preferences_json = ?, updated_date = ? WHERE app_id = ? AND id = ?`
  ).run(JSON.stringify(preferences), new Date().toISOString(), appId, userId);
  return next;
}

export function getNotificationSettingsResponse(db, config, { appId, user }) {
  const result = getUserNotificationSettings(db, { appId, userId: user.id });
  return {
    ...getNotificationAvailability(config),
    settings: result.settings,
    defaulted: result.defaulted,
  };
}

export function upsertNotificationSubscription(db, { appId, user, subscription, userAgent = "" }) {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) {
    throw new HttpError(400, "A valid PushSubscription endpoint and keys are required.", "invalid_subscription");
  }
  const now = new Date().toISOString();
  const id = `nsub_${randomUUID()}`;
  db.prepare(
    `INSERT INTO notification_subscriptions (
       id, app_id, user_id, endpoint, p256dh, auth, user_agent,
       status, last_error, last_seen_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       app_id = excluded.app_id,
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       status = 'active',
       last_error = NULL,
       last_seen_at = excluded.last_seen_at,
       updated_date = excluded.updated_date`
  ).run(id, appId, user.id, endpoint, p256dh, auth, userAgent, now, now, now);
  return db.prepare(`SELECT * FROM notification_subscriptions WHERE endpoint = ?`).get(endpoint);
}

export function unsubscribeNotificationSubscription(db, { appId, user, endpoint }) {
  const ep = String(endpoint || "").trim();
  if (!ep) throw new HttpError(400, "endpoint is required.", "invalid_request");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE notification_subscriptions
     SET status = 'disabled', updated_date = ?
     WHERE app_id = ? AND user_id = ? AND endpoint = ?`
  ).run(now, appId, user.id, ep);
  return { success: true };
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{ appId: string, user: any, sendNotification?: (config: any, subscription: any, payload: any) => Promise<any> }} opts
 */
export async function sendTestNotification(db, config, opts) {
  const { appId, user, sendNotification = defaultSendNotification } = opts;
  if (!isNotificationsConfigured(config) && sendNotification === defaultSendNotification) {
    throw new HttpError(503, "Web Push is not configured on this server.", "notifications_unavailable");
  }
  const subscriptions = listActiveSubscriptions(db, appId, user.id);
  if (subscriptions.length === 0) {
    throw new HttpError(404, "This account has no active notification subscriptions.", "no_notification_subscriptions");
  }
  const payload = {
    title: "Zephyrly",
    body: "Notifications are working on this device.",
    icon: "/zephyrly-logo.png",
    badge: "/zephyrly-logo.png",
    tag: `zephyrly-test-${Date.now()}`,
    data: { url: "/Settings#notifications", test: true },
  };
  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    try {
      await sendNotification(config, subscriptionToPushObject(subscription), payload);
      sent += 1;
      markSubscriptionOk(db, subscription.id);
    } catch (err) {
      failed += 1;
      handleSubscriptionSendError(db, subscription, err);
    }
  }
  return { sent, failed };
}

export function startNotificationLoop(db, config, opts = {}) {
  if (!isNotificationsConfigured(config) && !opts.sendNotification) {
    return { stop() {} };
  }
  if (intervalHandle) return { stop: stopNotificationLoop };

  const pollMs = Math.max(15_000, Number(config.notificationPollMs || 60_000));
  const run = () => {
    if (loopRunning) return;
    loopRunning = true;
    runNotificationSweep(db, config, opts)
      .catch((err) => log.warn("[notifications] sweep failed:", err.message))
      .finally(() => {
        loopRunning = false;
      });
  };

  initialTimeoutHandle = setTimeout(run, Math.min(5_000, pollMs));
  initialTimeoutHandle.unref?.();
  intervalHandle = setInterval(run, pollMs);
  intervalHandle.unref?.();
  return { stop: stopNotificationLoop };
}

export function stopNotificationLoop() {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export async function runNotificationSweep(
  db,
  config,
  { now = new Date(), sendNotification = defaultSendNotification } = {}
) {
  if (!isNotificationsConfigured(config) && sendNotification === defaultSendNotification) {
    return { sent: 0, skipped: 0, failed: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const users = db
    .prepare(
      `SELECT DISTINCT u.*
       FROM users u
       JOIN notification_subscriptions ns
         ON ns.app_id = u.app_id AND ns.user_id = u.id
       WHERE u.app_id = ? AND ns.status = 'active'`
    )
    .all(config.appId);

  for (const user of users) {
    const preferences = parsePreferences(user.preferences_json);
    const settings = sanitizeNotificationSettings(preferences.notificationSettings || {});
    if (!settings.enabled) continue;

    const subscriptions = listActiveSubscriptions(db, config.appId, user.id);
    if (subscriptions.length === 0) continue;

    const tasks = listNotificationCandidateTasks(db, config.appId, user);
    for (const task of tasks) {
      if (task.source_kind === "event" && !settings.includeExternalEvents) {
        skipped += 1;
        continue;
      }
      const scheduledAt = getTaskNotificationTime(task, settings);
      if (!scheduledAt) {
        skipped += 1;
        continue;
      }
      const ageMs = now.getTime() - scheduledAt.getTime();
      if (ageMs < 0 || ageMs > settings.missedGraceMinutes * MINUTE_MS) {
        skipped += 1;
        continue;
      }
      const scheduledFor = scheduledAt.toISOString();
      const payload = buildTaskNotificationPayload(task, scheduledFor);
      for (const subscription of subscriptions) {
        const inserted = insertPendingDelivery(db, {
          appId: config.appId,
          userId: user.id,
          subscriptionId: subscription.id,
          taskId: task.id,
          scheduledFor,
        });
        if (!inserted) {
          skipped += 1;
          continue;
        }
        try {
          await sendNotification(config, subscriptionToPushObject(subscription), payload);
          markDelivery(db, { subscription, task, scheduledFor, status: "sent" });
          sent += 1;
        } catch (err) {
          markDelivery(db, {
            subscription,
            task,
            scheduledFor,
            status: "failed",
            error: errorMessage(err),
          });
          handleSubscriptionSendError(db, subscription, err);
          failed += 1;
        }
      }
    }
  }
  return { sent, skipped, failed };
}

function listActiveSubscriptions(db, appId, userId) {
  return db
    .prepare(
      `SELECT * FROM notification_subscriptions
       WHERE app_id = ? AND user_id = ? AND status = 'active'`
    )
    .all(appId, userId);
}

function listNotificationCandidateTasks(db, appId, user) {
  return db
    .prepare(
      `SELECT *
       FROM tasks
       WHERE app_id = ?
         AND COALESCE(parent_id, '') = ''
         AND COALESCE(due_date, '') != ''
         AND COALESCE(status, 'todo') != 'done'
         AND (
           (created_by_id = ? AND created_by_id != '')
           OR LOWER(created_by) = ?
         )`
    )
    .all(appId, user.id, String(user.email || "").toLowerCase());
}

function getTaskNotificationTime(task, settings) {
  const taskTimeMins = parseTaskTime(task.task_time);
  if (taskTimeMins != null) {
    return zonedDateTimeToDate(task.due_date, taskTimeMins + settings.timedOffsetMinutes, settings.timeZone);
  }
  if (!settings.allDayEnabled) return null;
  const allDayMins = parseTaskTime(settings.allDayTime);
  if (allDayMins == null) return null;
  return zonedDateTimeToDate(task.due_date, allDayMins, settings.timeZone);
}

function zonedDateTimeToDate(ymd, minutes, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 0, minutes));
  const pad = (n) => String(n).padStart(2, "0");
  const wall = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00`;
  const zoned = fromZonedTime(wall, sanitizeTimeZone(timeZone));
  return Number.isNaN(zoned.getTime()) ? null : zoned;
}

function buildTaskNotificationPayload(task, scheduledFor) {
  const title = String(task.title || "Untitled task").slice(0, 120);
  const isTimed = parseTaskTime(task.task_time) != null;
  const params = new URLSearchParams({
    date: task.due_date,
    task: task.id,
    view: "day",
  });
  return {
    title,
    body: isTimed
      ? `Due ${task.task_time}`
      : "All-day task due today",
    icon: "/zephyrly-logo.png",
    badge: "/zephyrly-logo.png",
    tag: `zephyrly-${task.id}-${scheduledFor}`,
    data: {
      url: `/Calendar?${params.toString()}`,
      taskId: task.id,
      dueDate: task.due_date,
      scheduledFor,
    },
  };
}

function insertPendingDelivery(db, { appId, userId, subscriptionId, taskId, scheduledFor }) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO task_notification_deliveries (
         id, app_id, user_id, subscription_id, task_id, scheduled_for,
         status, created_date, updated_date
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(`ndel_${randomUUID()}`, appId, userId, subscriptionId, taskId, scheduledFor, now, now);
  return Number(result.changes || 0) > 0;
}

function markDelivery(db, { subscription, task, scheduledFor, status, error = "" }) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE task_notification_deliveries
     SET status = ?, delivered_at = CASE WHEN ? = 'sent' THEN ? ELSE delivered_at END,
         error = ?, updated_date = ?
     WHERE subscription_id = ? AND task_id = ? AND scheduled_for = ?`
  ).run(status, status, now, String(error || "").slice(0, 500), now, subscription.id, task.id, scheduledFor);
  if (status === "sent") markSubscriptionOk(db, subscription.id);
}

function markSubscriptionOk(db, subscriptionId) {
  db.prepare(
    `UPDATE notification_subscriptions
     SET last_error = NULL, last_seen_at = ?, updated_date = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), new Date().toISOString(), subscriptionId);
}

function handleSubscriptionSendError(db, subscription, err) {
  const status = Number(err?.statusCode || err?.status || 0);
  const permanent = status === 404 || status === 410;
  db.prepare(
    `UPDATE notification_subscriptions
     SET status = CASE WHEN ? THEN 'disabled' ELSE status END,
         last_error = ?,
         updated_date = ?
     WHERE id = ?`
  ).run(permanent ? 1 : 0, errorMessage(err), new Date().toISOString(), subscription.id);
}

async function defaultSendNotification(config, subscription, payload) {
  configureWebPush(config);
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

function configureWebPush(config) {
  const key = `${config.vapidSubject}|${config.vapidPublicKey}|${config.vapidPrivateKey}`;
  if (configuredVapidKey === key) return;
  webpush.setVapidDetails(
    String(config.vapidSubject || "mailto:notifications@localhost"),
    String(config.vapidPublicKey || ""),
    String(config.vapidPrivateKey || "")
  );
  configuredVapidKey = key;
}

function subscriptionToPushObject(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

function parsePreferences(raw) {
  try {
    const parsed = raw ? JSON.parse(String(raw)) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeTimeZone(value) {
  const tz = String(value || DEFAULT_SETTINGS.timeZone).trim() || DEFAULT_SETTINGS.timeZone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_SETTINGS.timeZone;
  }
}

function clampInteger(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseTaskTime(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (h < 1 || h > 12 || mm < 0 || mm > 59) return null;
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  return h * 60 + mm;
}

function minutesToTaskTime(mins) {
  const normalized = ((Number(mins || 0) % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const mm = normalized % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
}

function errorMessage(err) {
  return String(err?.message || err || "notification_failed").slice(0, 500);
}
