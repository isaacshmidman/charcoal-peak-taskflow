// @ts-check
/**
 * One-shot backfill: push existing Zephyrly tasks to the user's default
 * calendar integration so deletes can later round-trip.
 *
 * Why this exists:
 *   The `is_default` flag on calendar_integrations gates whether a
 *   newly-created task gets pushed outbound to a connected provider. Before
 *   the flag existed, an existing integration row had `is_default = 0` after
 *   the column migration, so any tasks created locally during that window
 *   never produced an `external_event_map` row. With no map row, a later
 *   delete in Zephyrly has no remote event to delete on Google/Apple — the
 *   delete looks successful locally but never propagates.
 *
 *   db.js now backfills `is_default = 1` for the user's oldest active
 *   integration on boot, but that fixes the FUTURE only. This script fixes
 *   the PAST: it walks every (now-default) active integration, finds every
 *   eligible local task that has no map row on that integration, and
 *   enqueues a one-time upsert push. The push handler then creates the
 *   remote event and writes the missing map row.
 *
 * Eligibility filter (matches push.js's runPush):
 *   - parent_id IS NULL          (subtasks aren't on calendars)
 *   - due_date is set            (no calendar event without a date)
 *   - source_writable != false   (don't push back to read-only imports)
 *   - no existing map row on this integration
 *
 * Safety:
 *   - Idempotent. If an event already exists in the user's calendar (e.g. the
 *     user already touched a task post-fix), the create will succeed once and
 *     the second backfill run skips it because a map row now exists.
 *   - Rate-limited via push.js's existing per-integration queue (4 pushes/sec).
 *
 * Usage:
 *   Stop the dev server first (so we don't double-write the SQLite WAL),
 *   then run:
 *     node backend/scripts/backfill-pushes.js
 *   Restart the dev server when the script reports "Done."
 */

import { getDatabase } from "../db.js";
import { backendConfig } from "../config.js";
import { enqueueTaskPush } from "../push.js";

async function main() {
  if (!backendConfig.integrationsEnabled) {
    console.error(
      "[backfill] integrations are disabled in config — nothing to do."
    );
    process.exit(0);
  }

  const db = getDatabase(backendConfig);

  const integrations = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM calendar_integrations
         WHERE status = 'active' AND is_default = 1
           AND provider IN ('google', 'apple')`
      )
      .all()
  );

  if (integrations.length === 0) {
    console.log("[backfill] no active default integrations found.");
    process.exit(0);
  }

  let totalEnqueued = 0;

  for (const integration of integrations) {
    const tasks = /** @type {any[]} */ (
      db
        .prepare(
          `SELECT t.* FROM tasks t
           WHERE t.app_id = ?
             AND t.created_by_id = ?
             AND (t.parent_id IS NULL OR t.parent_id = '')
             AND t.due_date IS NOT NULL AND t.due_date != ''
             AND (t.source_writable IS NULL OR t.source_writable = 1)
             AND NOT EXISTS (
               SELECT 1 FROM external_event_map m
               WHERE m.task_id = t.id AND m.integration_id = ?
             )`
        )
        .all(integration.app_id, integration.user_id, integration.id)
    );

    console.log(
      `[backfill] integration=${integration.id} provider=${integration.provider} eligible_tasks=${tasks.length}`
    );

    for (const task of tasks) {
      enqueueTaskPush(db, backendConfig, {
        op: "upsert",
        appId: integration.app_id,
        taskSnapshot: task,
      });
      totalEnqueued++;
    }
  }

  if (totalEnqueued === 0) {
    console.log("[backfill] no eligible tasks — already in sync. Done.");
    process.exit(0);
  }

  // push.js debounces upserts by 350ms then drains at ~4 pushes/sec across all
  // integrations. Wait long enough for the queue to flush, with a generous
  // floor for network latency.
  const drainSeconds = Math.max(10, Math.ceil(totalEnqueued / 4) + 4);
  console.log(
    `[backfill] enqueued ${totalEnqueued} pushes — waiting ${drainSeconds}s for queue to drain…`
  );
  await new Promise((r) => setTimeout(r, drainSeconds * 1000));
  console.log("[backfill] Done. Restart the dev server.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
