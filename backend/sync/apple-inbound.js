// @ts-check
/**
 * @file Apple iCloud inbound sync. Mirrors google-inbound.js structurally
 * but uses CalDAV's listEventsIncremental (returns href/etag/ICS triples)
 * + parseVEvent → mapVEventToTaskInput pipeline.
 */
import { randomUUID } from "node:crypto";
import {
  listEventsIncremental as listAppleEventsIncremental,
  listEventsInWindow as listAppleEventsInWindow,
  parseVEvent,
  mapVEventToTaskInput,
} from "../providers/apple-calendar.js";
import {
  getAppleCredentials,
  refreshIntegrationCalendars,
  markSyncResult,
  markCalendarSyncResult,
  clearCalendarSyncToken,
} from "../integrations.js";
import { buildUserForSync } from "../sync-user.js";
import { createEntityRecord, updateEntityRecord } from "../store.js";
import { pushIsWaiting } from "../push.js";
import { log } from "../log.js";
import { markWindowRead, windowIsDue } from "./window.js";
import {
  findZephyrlyTaskForProviderEvent,
  inboundUpdateFor,
  markSyncOutcome,
  removeTaskForCalendarDelete,
  storedTask,
  insertExternalEventMap,
} from "./shared.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

export async function syncAppleIntegration(db, config, integrationRow) {
  // Re-discover calendars so newly-added shared calendars appear in Configure.
  try {
    await refreshIntegrationCalendars(db, config, integrationRow);
  } catch (err) {
    log.warn(
      `[sync] apple refresh calendars for integration ${integrationRow.id} failed: ${err.message}`
    );
  }

  const user = buildUserForSync(db, integrationRow);
  if (!user) {
    markSyncResult(db, integrationRow.id, { error: "Owner user not found" });
    return;
  }

  const calendars = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM integration_calendars WHERE integration_id = ? AND sync_enabled = 1`
      )
      .all(integrationRow.id)
  );
  if (calendars.length === 0) {
    markSyncResult(db, integrationRow.id, {});
    return;
  }

  let creds;
  try {
    creds = getAppleCredentials(db, integrationRow);
  } catch (err) {
    markSyncResult(db, integrationRow.id, { error: err.message });
    throw err;
  }

  let failed = 0;
  let firstError = "";
  for (const cal of calendars) {
    try {
      await syncOneAppleCalendar(db, config, {
        integration: integrationRow,
        creds,
        user,
        calendarRow: cal,
      });
    } catch (err) {
      failed += 1;
      firstError = firstError || String(err.message || "sync failed");
      markCalendarSyncResult(db, integrationRow.id, cal.external_calendar_id, {
        error: err.message,
      });
      log.warn(
        `[sync] apple calendar ${cal.external_calendar_id} on integration ${integrationRow.id}: ${err.message}`
      );
    }
  }

  markSyncOutcome(db, integrationRow.id, { calendars: calendars.length, failed, firstError });
}

async function syncOneAppleCalendar(db, config, { integration, creds, user, calendarRow }) {
  const externalCalendarId = calendarRow.external_calendar_id; // absolute calendar URL
  const result = await listAppleEventsIncremental(creds, externalCalendarId, calendarRow.sync_token);

  if (result.fullResync) {
    clearCalendarSyncToken(db, integration.id, externalCalendarId);
    return;
  }

  const apply = async (/** @type {Array<{ href: string, etag: string, ics: string, deleted: boolean }>} */ changes) => {
    for (const change of changes) {
      try {
        await applyAppleChangeToTasks(db, config, {
          integration,
          user,
          calendarRow,
          change,
        });
      } catch (err) {
        log.warn(
          `[sync] apple event ${change.href || "?"} on integration ${integration.id}: ${err.message}`
        );
      }
    }
  };
  await apply(result.changes);

  markCalendarSyncResult(db, integration.id, externalCalendarId, {
    syncToken: result.nextSyncToken || null,
  });

  // As for Google (sync/window.js): once a day, read the whole window too.
  if (!calendarRow.sync_token) {
    markWindowRead(db, integration.id, externalCalendarId);
  } else if (windowIsDue(calendarRow)) {
    const windowed = await listAppleEventsInWindow(creds, externalCalendarId);
    await apply(windowed);
    markWindowRead(db, integration.id, externalCalendarId);
  }
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{
 *   integration: any,
 *   user: any,
 *   calendarRow: any,
 *   change: { href: string, etag: string, ics: string, deleted: boolean },
 * }} ctx
 */
async function applyAppleChangeToTasks(db, config, { integration, user, calendarRow, change }) {
  // We key external_event_map.external_event_id off the event's full href —
  // it's stable, unique within the calendar, and is what we need to PUT/DELETE
  // back to. (UID would also work; href is what CalDAV calls us back with so
  // it's friction-free here.)
  const existing = db
    .prepare(
      `SELECT * FROM external_event_map WHERE integration_id = ? AND external_event_id = ?`
    )
    .get(integration.id, change.href);

  if (change.deleted) {
    if (existing) {
      removeTaskForCalendarDelete(db, config, { integration, user, taskId: existing.task_id });
      db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
    }
    return;
  }

  // Skip override-instance VEVENTs (RECURRENCE-ID set) — we represent the
  // master series as one task, same as Google's `recurringEventId` filter.
  const ev = parseVEvent(change.ics);
  if (!ev) return;
  if (ev.recurrenceId) return;
  if (ev.status === "CANCELLED") {
    if (existing) {
      removeTaskForCalendarDelete(db, config, { integration, user, taskId: existing.task_id });
      db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
    }
    return;
  }

  const mapped = mapVEventToTaskInput(ev, calendarRow);
  if (!mapped) return;

  const now = new Date().toISOString();

  if (existing) {
    if (change.etag && existing.etag === change.etag) return;
    // A change made here is still on its way to the calendar: what the
    // calendar holds is the older copy, about to be replaced. Leave ours.
    if (pushIsWaiting(db, existing.task_id)) return;
    const task = storedTask(db, integration.app_id, existing.task_id);
    if (!task) {
      // Deleted here since. Forget the link so we stop trying; the event
      // stays at the calendar.
      db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
      return;
    }
    try {
      updateEntityRecord(db, {
        entityName: "Task",
        appId: integration.app_id,
        user,
        id: existing.task_id,
        input: inboundUpdateFor(mapped, task),
      });
    } catch (err) {
      if (/not found/i.test(err.message)) {
        db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
        return;
      }
      throw err;
    }
    db.prepare(
      `UPDATE external_event_map SET etag = ?, last_synced_at = ?, updated_date = ? WHERE id = ?`
    ).run(change.etag || null, now, now, existing.id);
    return;
  }

  const linkedTask = findZephyrlyTaskForProviderEvent(db, {
    integration,
    user,
    taskId: appleZephyrlyTaskId(ev.uid),
  });
  if (linkedTask) {
    updateEntityRecord(db, {
      entityName: "Task",
      appId: integration.app_id,
      user,
      id: linkedTask.id,
      input: inboundUpdateFor(mapped, linkedTask),
    });
    insertExternalEventMap(db, {
      appId: integration.app_id,
      integrationId: integration.id,
      taskId: linkedTask.id,
      externalEventId: change.href,
      externalCalendarId: calendarRow.external_calendar_id,
      etag: change.etag || null,
      now,
    });
    return;
  }

  const task = createEntityRecord(db, {
    entityName: "Task",
    appId: integration.app_id,
    user,
    input: mapped,
    config,
  });

  // Stash the VEVENT UID alongside the href so push.js can rebuild PUT
  // bodies that match what iCloud expects on update.
  db.prepare(
    `INSERT INTO external_event_map (
       id, app_id, integration_id, task_id, external_event_id,
       external_calendar_id, etag, last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `emap_${randomUUID()}`,
    integration.app_id,
    integration.id,
    task.id,
    change.href,
    calendarRow.external_calendar_id,
    change.etag || null,
    now,
    now,
    now
  );
}

function appleZephyrlyTaskId(uid) {
  const match = /^zephyrly-(.+)@zephyrly$/i.exec(String(uid || ""));
  return match?.[1] || "";
}
