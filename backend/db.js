// @ts-check
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateHighlightJson } from "./lib/highlight-migration.js";
import { repairLatin1Filename } from "./lib/filename-encoding.js";
import { backendConfig } from "./config.js";

/** @type {DatabaseSync | null} */
let cachedDb = null;

/**
 * @param {import("./config.js").backendConfig} [config]
 */
export function createDatabase(config = backendConfig) {
  mkdirSync(dirname(config.dbFile), { recursive: true });

  const db = new DatabaseSync(config.dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = OFF;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS app_settings (
      app_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      deleted_task_retention_days INTEGER NOT NULL DEFAULT 7,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      full_name TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      auth_provider TEXT NOT NULL DEFAULT 'local',
      password_hash TEXT,
      google_subject TEXT,
      avatar_url TEXT,
      preferences_json TEXT NOT NULL DEFAULT '{}',
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      last_login_at TEXT,
      UNIQUE(app_id, email),
      UNIQUE(app_id, google_subject)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      access_token_hash TEXT NOT NULL UNIQUE,
      session_token_hash TEXT NOT NULL UNIQUE,
      auth_provider TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      expires_at TEXT NOT NULL,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      from_url TEXT NOT NULL,
      code_verifier TEXT,
      expires_at TEXT NOT NULL,
      created_date TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'login',
      user_id TEXT
    );

    -- Per-user calendar provider connection. Tokens are encrypted at rest
    -- with AES-256-GCM (see backend/crypto.js). One row per (user, provider,
    -- external_account). Disconnecting deletes the row + any rows in
    -- external_event_map that reference it.
    CREATE TABLE IF NOT EXISTS calendar_integrations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,                  -- 'google' | 'apple'
      external_account_id TEXT NOT NULL,       -- Google sub or iCloud email
      external_account_email TEXT NOT NULL,
      access_token_enc TEXT,                   -- encrypted; nullable for apple (no access tokens)
      refresh_token_enc TEXT,                  -- encrypted
      token_expires_at TEXT,                   -- ISO string; nullable for apple
      scopes TEXT NOT NULL DEFAULT '',
      primary_calendar_id TEXT,                -- provider-side calendar id we sync with
      primary_calendar_timezone TEXT,          -- IANA tz of the primary calendar (for pushing timed events)
      sync_token TEXT,                         -- Google-incremental-sync cursor
      last_synced_at TEXT,
      last_error TEXT,                         -- diagnostic only, never contains tokens
      status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'needs_reauth' | 'revoked'
      is_default INTEGER NOT NULL DEFAULT 0,   -- only the default integration receives pushes for new tasks
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      UNIQUE(app_id, user_id, provider, external_account_id)
    );

    -- Maps a Zephyrly task to an external calendar event. One row per
    -- (integration, task). Used for idempotent upserts and deletes.
    CREATE TABLE IF NOT EXISTS external_event_map (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      external_calendar_id TEXT NOT NULL,
      etag TEXT,
      zephyrly_metadata_synced_at TEXT,
      last_synced_at TEXT NOT NULL,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      UNIQUE(integration_id, external_event_id),
      UNIQUE(integration_id, task_id)
    );

    -- Per-integration per-calendar sync preferences. The user picks which of
    -- their provider calendars to actually pull into Zephyrly through the
    -- "Configure" modal in Settings. Calendars discovered but not yet
    -- configured default to disabled (sync_enabled=0). Each row also tracks
    -- its own sync_token so adding/removing a calendar doesn't blow away
    -- another's incremental cursor.
    CREATE TABLE IF NOT EXISTS integration_calendars (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      external_calendar_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      description TEXT,
      time_zone TEXT,
      color_hex TEXT,                        -- e.g. "#9fc6e7"; null when unknown
      access_role TEXT,                      -- 'owner' | 'writer' | 'reader' | 'freeBusyReader'
      primary_flag INTEGER NOT NULL DEFAULT 0,
      sync_enabled INTEGER NOT NULL DEFAULT 0,
      -- 'event' | 'task' — does this calendar hold appointments or to-dos?
      -- Defaults to 'event': a calendar is an event source unless the user
      -- opts it in, so meetings can never masquerade as overdue tasks.
      item_kind TEXT NOT NULL DEFAULT 'event',
      sync_token TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      UNIQUE(integration_id, external_calendar_id)
    );

    CREATE TABLE IF NOT EXISTS notification_subscriptions (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_error TEXT,
      last_seen_at TEXT,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      UNIQUE(endpoint)
    );

    CREATE TABLE IF NOT EXISTS task_notification_deliveries (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      delivered_at TEXT,
      error TEXT,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      UNIQUE(subscription_id, task_id, scheduled_for)
    );

    CREATE TABLE IF NOT EXISTS priorities (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'slate',
      sort_order INTEGER,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      created_by_id TEXT,
      created_by TEXT,
      is_sample INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS saved_tags (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      created_by_id TEXT,
      created_by TEXT,
      is_sample INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      schedule_json TEXT NOT NULL DEFAULT '',
      tags_json TEXT,
      priority_id TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      created_by_id TEXT,
      created_by TEXT,
      is_sample INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS deleted_notes (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      note_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      schedule_json TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      priority_id TEXT NOT NULL DEFAULT '',
      deleted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      created_by_id TEXT,
      created_by TEXT,
      is_sample INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_deleted_notes_expiry ON deleted_notes(expires_at);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      parent_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority_id TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      task_type TEXT NOT NULL DEFAULT 'one_time',
      recurrence TEXT NOT NULL DEFAULT 'none',
      recurrence_days_json TEXT NOT NULL DEFAULT '[]',
      recurrence_end_date TEXT,
      due_date TEXT,
      task_time TEXT,
      task_end_time TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      completed_at TEXT,
      sort_order REAL,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      created_by_id TEXT,
      created_by TEXT,
      is_sample INTEGER NOT NULL DEFAULT 0,
      -- Calendar provenance (null for native Zephyrly tasks):
      source_provider TEXT,                  -- 'google' | 'apple' | null
      source_kind TEXT,                      -- 'task' | 'event' | null
      source_calendar_id TEXT,               -- provider calendar id
      source_calendar_name TEXT,
      source_color_hex TEXT,                 -- for the priority-style swatch
      source_writable INTEGER NOT NULL DEFAULT 1,
      source_recurrence_rule TEXT            -- raw RRULE for first-instance
    );

    CREATE TABLE IF NOT EXISTS deleted_tasks (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority_id TEXT,
      priority_color TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      task_type TEXT NOT NULL DEFAULT 'one_time',
      recurrence TEXT NOT NULL DEFAULT 'none',
      recurrence_days_json TEXT NOT NULL DEFAULT '[]',
      recurrence_end_date TEXT,
      due_date TEXT,
      task_time TEXT,
      task_end_time TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      completed_at TEXT,
      deleted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      was_completed INTEGER NOT NULL DEFAULT 0,
      subtasks_json TEXT NOT NULL DEFAULT '[]',
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      created_by_id TEXT,
      created_by TEXT,
      is_sample INTEGER NOT NULL DEFAULT 0,
      is_completion_record INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_users_app_email ON users(app_id, email);
    CREATE INDEX IF NOT EXISTS idx_sessions_app_user ON sessions(app_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_app_owner ON tasks(app_id, created_by_id, created_by);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_deleted_tasks_owner ON deleted_tasks(app_id, created_by_id, created_by);
    CREATE INDEX IF NOT EXISTS idx_deleted_tasks_expiry ON deleted_tasks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_priorities_owner ON priorities(app_id, created_by_id, created_by);
    CREATE INDEX IF NOT EXISTS idx_saved_tags_owner ON saved_tags(app_id, created_by_id, created_by);
    CREATE INDEX IF NOT EXISTS idx_integrations_user ON calendar_integrations(app_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_integrations_status ON calendar_integrations(status);
    CREATE INDEX IF NOT EXISTS idx_event_map_integration ON external_event_map(integration_id);
    CREATE INDEX IF NOT EXISTS idx_event_map_task ON external_event_map(task_id);
    CREATE INDEX IF NOT EXISTS idx_integration_calendars_integration ON integration_calendars(integration_id);
    CREATE INDEX IF NOT EXISTS idx_notification_subscriptions_user ON notification_subscriptions(app_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_task_notification_deliveries_due ON task_notification_deliveries(app_id, user_id, scheduled_for, status);

    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      filename TEXT NOT NULL,            -- original filename (preserved for download UX)
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,        -- relative path under attachments dir
      is_image INTEGER NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      created_date TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(app_id, task_id);
    CREATE INDEX IF NOT EXISTS idx_task_attachments_user ON task_attachments(app_id, user_id);

    -- Restore from an export (restore.js): which record an exported id
    -- became when it had to take a fresh id, so restoring the same export
    -- again recognises it instead of adding a second copy.
    CREATE TABLE IF NOT EXISTS restored_ids (
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      source_id TEXT NOT NULL,
      local_id TEXT NOT NULL,
      PRIMARY KEY (app_id, user_id, entity, source_id)
    );

    -- AI apps (backend/ai/). A grant is one connected app for one user —
    -- a personal token, or later an OAuth sign-in. can_write is read on
    -- every request, so changing it in Settings takes effect at once.
    -- Revoked grants are kept so the activity log can still name them.
    CREATE TABLE IF NOT EXISTS ai_grants (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,                -- 'token' | 'oauth'
      label TEXT NOT NULL,               -- the token's name, or the app's
      client_id TEXT,                    -- oauth only
      can_write INTEGER NOT NULL DEFAULT 0,
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      created_date TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_grants_user ON ai_grants(app_id, user_id);

    -- Secrets are never stored, only their sha256.
    CREATE TABLE IF NOT EXISTS ai_tokens (
      token_hash TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      kind TEXT NOT NULL,                -- 'personal' | 'access' | 'refresh'
      expires_at TEXT,                   -- NULL: until revoked
      created_date TEXT NOT NULL,
      used_at TEXT                       -- refresh: when it was exchanged
    );
    CREATE INDEX IF NOT EXISTS idx_ai_tokens_grant ON ai_tokens(grant_id);

    -- Every change an AI app makes, with what Undo needs to reverse it.
    CREATE TABLE IF NOT EXISTS ai_activity (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      summary TEXT NOT NULL,
      undo_json TEXT,                    -- NULL: not undoable from the log
      created_date TEXT NOT NULL,
      undone_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_activity_user ON ai_activity(app_id, user_id, created_date);

    -- Zephyrly Plus (backend/plans.js): one row per account that has it.
    -- Written only by a payment Stripe confirmed, the owner's gift script,
    -- or the launch grant below; never by an API route.
    CREATE TABLE IF NOT EXISTS entitlements (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      plan TEXT NOT NULL,                -- 'plus'
      source TEXT NOT NULL,              -- 'stripe' | 'gift' | 'founding'
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      amount_total INTEGER,              -- in the smallest unit (cents)
      currency TEXT,
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_reason TEXT                -- 'refund' | 'dispute' | 'owner'
    );
    CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(app_id, user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_session ON entitlements(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

    -- Stripe events already handled, so a replayed or repeated one does nothing twice.
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,               -- Stripe's event id
      type TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    -- One-time things done at boot.
    CREATE TABLE IF NOT EXISTS app_flags (
      name TEXT PRIMARY KEY,
      set_at TEXT NOT NULL
    );

    -- "Sign in with Zephyrly" (backend/ai/oauth.js). Apps register
    -- themselves (RFC 7591); only public clients using PKCE, so no secrets.
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      redirect_uris_json TEXT NOT NULL,
      created_date TEXT NOT NULL,
      last_used_at TEXT
    );

    -- One sign-in in progress: made by /api/oauth/authorize, shown on the
    -- consent page, then holds the one-time code until it's exchanged.
    CREATE TABLE IF NOT EXISTS oauth_requests (
      id TEXT PRIMARY KEY,               -- opaque; in the consent page's URL
      app_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      state TEXT,
      code_challenge TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      resource TEXT,
      user_id TEXT,                      -- set on approval
      grant_id TEXT,                     -- set on approval
      code_hash TEXT UNIQUE,             -- set on approval
      code_used_at TEXT,
      expires_at TEXT NOT NULL,
      created_date TEXT NOT NULL
    );
  `);

  // Migration: add task_end_time to existing databases.
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN task_end_time TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE deleted_tasks ADD COLUMN task_end_time TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE calendar_integrations ADD COLUMN primary_calendar_timezone TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE calendar_integrations ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
  // Denormalized attachment count on tasks so TaskCard can show a
  // paperclip + count without an N+1 fetch. Maintained by attachments.js.
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN attachment_count INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
  // Optional thumbnail path for image attachments. Generated by
  // attachments.js on upload; reads use the `?thumb=1` route variant.
  // Null for non-images, files that failed thumbnail generation, and
  // pre-Pri-2 rows (which serve their original on thumb requests).
  try {
    db.exec(`ALTER TABLE task_attachments ADD COLUMN thumb_path TEXT`);
  } catch {
    // Column already exists — ignore
  }
  // When the file's task was deleted. Set, the file is held for Recently
  // Deleted: kept, and counted toward storage, but on no live task until
  // the task is restored or leaves Recently Deleted (attachments.js).
  try {
    db.exec(`ALTER TABLE task_attachments ADD COLUMN task_deleted_at TEXT`);
  } catch {
    // Column already exists — ignore
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_attachments_held ON task_attachments(task_deleted_at) WHERE task_deleted_at IS NOT NULL`
  );
  try {
    db.exec(`ALTER TABLE external_event_map ADD COLUMN zephyrly_metadata_synced_at TEXT`);
  } catch {
    // Column already exists — ignore
  }
  // Rich-text description: ProseMirror/TipTap JSON (stringified). The
  // existing `description` column is kept as a plaintext mirror so
  // notifications/search/restore stay plaintext with no rich-text deps.
  // Null on pre-richtext rows → the editor hydrates from plaintext.
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN description_json TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE deleted_tasks ADD COLUMN description_json TEXT`);
  } catch {
    // Column already exists — ignore
  }
  // Per-task reminder override (backend/reminders.js). Empty/null = use the
  // account's notification settings, so existing tasks behave as before.
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN reminder TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE deleted_tasks ADD COLUMN reminder TEXT`);
  } catch {
    // Column already exists — ignore
  }
  // Notes gained tags + a shared priority (Tasks and Notes share both).
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN tags_json TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN priority_id TEXT`);
  } catch {
    // Column already exists — ignore
  }
  // A note can be a schedule (backend/lib/schedule.js); '' = never was.
  for (const table of ["notes", "deleted_notes"]) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN schedule_json TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists — ignore
    }
  }

  // Backfill: for any (app_id, user_id) that has active integrations but no
  // current default, promote the oldest active one. Without this, users who
  // connected Google/Apple before the is_default flag existed would have
  // is_default=0 everywhere — meaning new locally-created tasks never push
  // outbound, and therefore never get an external_event_map row, and therefore
  // never delete remotely either. Idempotent: only runs when a user has zero
  // defaults but ≥1 active integration.
  try {
    const orphans = /** @type {any[]} */ (
      db
        .prepare(
          `SELECT app_id, user_id FROM calendar_integrations
           WHERE status = 'active'
           GROUP BY app_id, user_id
           HAVING SUM(is_default) = 0`
        )
        .all()
    );
    const promote = db.prepare(
      `UPDATE calendar_integrations SET is_default = 1, updated_date = ?
       WHERE id = (
         SELECT id FROM calendar_integrations
         WHERE app_id = ? AND user_id = ? AND status = 'active'
         ORDER BY created_date ASC LIMIT 1
       )`
    );
    const now = new Date().toISOString();
    for (const o of orphans) promote.run(now, o.app_id, o.user_id);
  } catch {
    // Best-effort — old DBs without the column already errored out above.
  }

  // Boot-time cleanup: orphan imported events. Before
  // disconnectIntegration learned to delete imported tasks (commit
  // 0000be7), users who disconnected Google or Apple were left with
  // events in their tasks table whose source calendar/integration no
  // longer existed — they showed up in /Calendar and Settings →
  // Calendar Order with no UI path to remove them.
  //
  // Self-healing query: delete any imported-event task whose
  // (source_provider, source_calendar_id) doesn't currently match a
  // live integration_calendars row scoped to the same app. Restricted
  // to source_kind='event' so user-authored tasks pushed outbound
  // (which carry source_provider but NOT source_kind='event') stay
  // safe. Idempotent — once orphans are gone, the DELETE is a no-op.
  try {
    db.prepare(
      `DELETE FROM tasks
       WHERE source_kind = 'event'
         AND COALESCE(source_provider, '') != ''
         AND NOT EXISTS (
           SELECT 1 FROM integration_calendars ic
           JOIN calendar_integrations ci ON ci.id = ic.integration_id
           WHERE ci.app_id = tasks.app_id
             AND ci.provider = tasks.source_provider
             AND ic.external_calendar_id = tasks.source_calendar_id
         )`
    ).run();
    // Provider-origin tasks from writable calendars are kept on disconnect,
    // but old versions left their source_* fields pointing at integration
    // rows that no longer exist. Localize those stale tasks so they behave and
    // render like normal Zephyrly tasks after boot.
    db.prepare(
      `UPDATE tasks
       SET source_provider = '',
           source_kind = '',
           source_calendar_id = '',
           source_calendar_name = '',
           source_color_hex = '',
           source_writable = 1,
           source_recurrence_rule = '',
           updated_date = ?
       WHERE COALESCE(source_provider, '') != ''
         AND COALESCE(source_kind, '') != 'event'
         AND NOT EXISTS (
           SELECT 1 FROM integration_calendars ic
           JOIN calendar_integrations ci ON ci.id = ic.integration_id
           WHERE ci.app_id = tasks.app_id
             AND ci.provider = tasks.source_provider
             AND ic.external_calendar_id = tasks.source_calendar_id
         )`
    ).run(new Date().toISOString());
    // Same idea for external_event_map rows pointing at integrations
    // that were already torn down — leftover map rows occasionally
    // cause push.js to retry against a no-longer-existing integration.
    db.prepare(
      `DELETE FROM external_event_map
       WHERE NOT EXISTS (
         SELECT 1 FROM calendar_integrations
         WHERE calendar_integrations.id = external_event_map.integration_id
       )`
    ).run();
  } catch {
    // Old DBs without the source_* columns or the integrations tables
    // can't run this — fail silently and let the column-add migration
    // below set things up for next boot.
  }

  // Migration: add source_* provenance columns to tasks for calendar imports.
  for (const stmt of [
    `ALTER TABLE tasks ADD COLUMN source_provider TEXT`,
    `ALTER TABLE tasks ADD COLUMN source_kind TEXT`,
    `ALTER TABLE tasks ADD COLUMN source_calendar_id TEXT`,
    `ALTER TABLE tasks ADD COLUMN source_calendar_name TEXT`,
    `ALTER TABLE tasks ADD COLUMN source_color_hex TEXT`,
    `ALTER TABLE tasks ADD COLUMN source_writable INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE tasks ADD COLUMN source_recurrence_rule TEXT`,
    `ALTER TABLE integration_calendars ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'event'`,
  ]) {
    try { db.exec(stmt); } catch { /* exists — ignore */ }
  }

  // Source-provenance index has to be created AFTER the ALTER migrations
  // above — older DBs don't have source_provider/source_kind columns yet.
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_provider, source_kind)`);
  } catch {
    // ignore — columns might still be missing on a partial migration; not fatal.
  }

  // Backfill: imported calendar items that were classified as tasks by the
  // old rule (which called anything on a WRITABLE calendar a task) get
  // re-stamped as events unless their calendar is now explicitly marked
  // item_kind='task'. Without this, every meeting and appointment already
  // in the table keeps claiming to be a task — inbound sync is incremental
  // (syncToken), so those rows are never revisited on their own.
  //
  // Zephyrly's own tasks are structurally safe here: sync/shared.js strips
  // every source_* field from a round-tripped native task, so native tasks
  // always have an empty source_provider and can't match this WHERE clause.
  //
  // Runs on every boot and is idempotent — once the rows are correct it
  // updates nothing. Toggling a calendar to Tasks re-stamps its rows via
  // setCalendarItemKind, which is why this doesn't fight the user's choice.
  try {
    db.prepare(
      `UPDATE tasks
          SET source_kind = 'event',
              updated_date = ?
        WHERE COALESCE(source_provider, '') != ''
          AND source_kind = 'task'
          AND source_calendar_id NOT IN (
            SELECT external_calendar_id FROM integration_calendars
             WHERE item_kind = 'task'
          )`
    ).run(new Date().toISOString());
  } catch {
    // Partial migration (columns not present yet) — next boot picks it up.
  }

  // Backfill: retire the pale-yellow highlight (#fef08a) that used to be
  // offered in the rich-text picker. The note↔task link now paints a
  // reserved yellow meaning "a task exists for this span", so a hand-made
  // yellow would be indistinguishable from a real link.
  //
  // Only the highlight mark's colour changes — text, every other mark, and
  // taskLink anchors are left byte-identical (see lib/highlight-migration.js,
  // which returns null when a row needs no rewrite so we skip the write).
  // Idempotent: once converted, later boots match nothing.
  for (const [table, column] of [
    ["notes", "content_json"],
    ["deleted_notes", "content_json"],
    ["tasks", "description_json"],
    ["deleted_tasks", "description_json"],
  ]) {
    try {
      const rows = db
        .prepare(`SELECT id, ${column} AS body FROM ${table} WHERE ${column} LIKE '%fef08a%' COLLATE NOCASE`)
        .all();
      if (!rows.length) continue;
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
      for (const row of rows) {
        const next = migrateHighlightJson(row.body);
        if (next) update.run(next, row.id);
      }
    } catch {
      // Table missing on an older DB — next boot picks it up.
    }
  }

  // Backfill: attachment names uploaded before the upload parser read
  // them as UTF-8 were stored mangled — "Résumé.pdf" as "RÃ©sumÃ©.pdf"
  // (see lib/filename-encoding.js). Only names that decode cleanly change.
  // Idempotent: a repaired name doesn't pass the check again.
  try {
    const rows = db.prepare(`SELECT id, filename FROM task_attachments`).all();
    const update = db.prepare(`UPDATE task_attachments SET filename = ? WHERE id = ?`);
    for (const row of rows) {
      const repaired = repairLatin1Filename(row.filename);
      if (repaired) update.run(repaired, row.id);
    }
  } catch {
    // Never fatal to boot — the next boot tries again.
  }

  // Migration: older DBs have oauth_states without kind/user_id — add them.
  try {
    db.exec(`ALTER TABLE oauth_states ADD COLUMN kind TEXT NOT NULL DEFAULT 'login'`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE oauth_states ADD COLUMN user_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add is_completion_record column to existing databases
  try {
    db.exec(`ALTER TABLE deleted_tasks ADD COLUMN is_completion_record INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: snapshot the priority color onto deleted tasks so the Recently Deleted
  // card keeps its color even if the priority is later renamed or deleted in Settings.
  try {
    db.exec(`ALTER TABLE deleted_tasks ADD COLUMN priority_color TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }

  grantFoundingMembersOnce(db);
  ensureAppSettings(db, config);
  return db;
}

/**
 * Plus launched with everyone already using Zephyrly as a founding member
 * (Isaac's call, 2026-09-30): the first boot with Plus gives it to every
 * account there is, once. Accounts made after that start on Basic.
 * @param {DatabaseSync} db
 */
function grantFoundingMembersOnce(db) {
  if (db.prepare(`SELECT 1 FROM app_flags WHERE name = 'plus_founding_members'`).get()) return;
  const now = new Date().toISOString();
  withTransaction(db, () => {
    const users = db.prepare(`SELECT id, app_id FROM users`).all();
    const insert = db.prepare(`INSERT INTO entitlements (id, app_id, user_id, plan, source, granted_at) VALUES (?, ?, ?, 'plus', 'founding', ?)`);
    for (const user of users) insert.run(`ent_${randomUUID()}`, user.app_id, user.id, now);
    db.prepare(`INSERT INTO app_flags (name, set_at) VALUES ('plus_founding_members', ?)`).run(now);
  });
}

/**
 * @param {import("./config.js").backendConfig} [config]
 */
export function getDatabase(config = backendConfig) {
  if (!cachedDb) {
    cachedDb = createDatabase(config);
  }
  return cachedDb;
}

/**
 * @param {DatabaseSync} db
 * @param {import("./config.js").backendConfig} config
 */
export function ensureAppSettings(db, config) {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO app_settings (app_id, name, deleted_task_retention_days, created_date, updated_date)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET
        name = excluded.name,
        deleted_task_retention_days = excluded.deleted_task_retention_days,
        updated_date = excluded.updated_date
    `
  ).run(config.appId, config.appName, config.deletedTaskRetentionDays, now, now);
}

/**
 * @param {DatabaseSync} db
 * @param {() => unknown} fn
 */
export function withTransaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function closeDatabase() {
  if (!cachedDb) return;
  cachedDb.close();
  cachedDb = null;
}
