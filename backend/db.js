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
      created_date TEXT NOT NULL
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
      tags_json TEXT NOT NULL DEFAULT '[]',
      completed_at TEXT,
      sort_order REAL,
      created_date TEXT NOT NULL,
      updated_date TEXT NOT NULL,
      created_by_id TEXT,
      created_by TEXT,
      is_sample INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS deleted_tasks (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
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
  `);

  // Migration: add is_completion_record column to existing databases
  try {
    db.exec(`ALTER TABLE deleted_tasks ADD COLUMN is_completion_record INTEGER NOT NULL DEFAULT 0`);
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

