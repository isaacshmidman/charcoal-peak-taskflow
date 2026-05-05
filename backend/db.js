// @ts-check
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  try {
    db.exec(`ALTER TABLE external_event_map ADD COLUMN zephyrly_metadata_synced_at TEXT`);
  } catch {
    // Column already exists — ignore
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

  ensureAppSettings(db, config);
  return db;
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
