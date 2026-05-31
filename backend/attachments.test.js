// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import {
  createAttachment,
  deleteAttachment,
  deleteAttachmentsForTask,
  getAttachment,
  getUserStorageBytes,
  listAttachmentsForTask,
  MAX_FILE_BYTES,
} from "./attachments.js";

let tempDir = "";
let db;
let config;
const APP_ID = "test-app";
const USER = { id: "user-1", email: "user@example.com" };
const TASK_ID = "task-1";

function makeConfig(dbFile) {
  return {
    appId: APP_ID,
    appName: "Zephyrly Test",
    publicAppUrl: "http://127.0.0.1:4173",
    dbFile,
    sessionCookieName: "taskflow_test_session",
    sessionTtlDays: 30,
    deletedTaskRetentionDays: 7,
    allowAnyPassword: true,
  };
}

function seedTask(db) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
      id, app_id, title, status, task_type, recurrence, recurrence_days_json,
      tags_json, created_date, updated_date, created_by_id, created_by, is_sample
    ) VALUES (?, ?, ?, 'todo', 'one_time', 'none', '[]', '[]', ?, ?, ?, ?, 0)`
  ).run(TASK_ID, APP_ID, "Test task", now, now, USER.id, USER.email);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "attachments-test-"));
  config = makeConfig(join(tempDir, "taskflow.sqlite"));
  db = createDatabase(config);
  seedTask(db);
});

afterEach(() => {
  if (db) db.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("attachments", () => {
  it("upload → list → get → delete round-trip", () => {
    const file = {
      filename: "screenshot.png",
      mimeType: "image/png",
      data: Buffer.from("fake-png-bytes"),
    };
    const created = createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    expect(created.id).toMatch(/^att_/);
    expect(created.filename).toBe("screenshot.png");
    expect(created.is_image).toBe(true);
    expect(created.size_bytes).toBe(file.data.length);

    const list = listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const { absolutePath, row } = getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(row.filename).toBe("screenshot.png");
    expect(existsSync(absolutePath)).toBe(true);
    expect(readFileSync(absolutePath).equals(file.data)).toBe(true);

    deleteAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(existsSync(absolutePath)).toBe(false);
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID })).toHaveLength(0);
  });

  it("bumps and decrements the task's attachment_count column", () => {
    const file = (n) => ({
      filename: `file-${n}.txt`,
      mimeType: "text/plain",
      data: Buffer.from("x".repeat(10 * n)),
    });
    createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(1) });
    createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(2) });

    let row = db.prepare("SELECT attachment_count FROM tasks WHERE id = ?").get(TASK_ID);
    expect(row.attachment_count).toBe(2);

    const list = listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID });
    deleteAttachment(db, config, { appId: APP_ID, user: USER, id: list[0].id });

    row = db.prepare("SELECT attachment_count FROM tasks WHERE id = ?").get(TASK_ID);
    expect(row.attachment_count).toBe(1);
  });

  it("rejects files past the size limit", () => {
    const file = {
      filename: "huge.bin",
      mimeType: "application/octet-stream",
      data: Buffer.alloc(MAX_FILE_BYTES + 1),
    };
    expect(() =>
      createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file })
    ).toThrowError(/too large/i);
  });

  it("rejects blocked extensions", () => {
    const file = {
      filename: "evil.exe",
      mimeType: "application/octet-stream",
      data: Buffer.from("MZ"),
    };
    expect(() =>
      createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file })
    ).toThrowError(/not allowed/i);
  });

  it("denies cross-user access on get + delete", () => {
    const file = {
      filename: "secret.txt",
      mimeType: "text/plain",
      data: Buffer.from("secret"),
    };
    const created = createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    const intruder = { id: "user-2", email: "intruder@example.com" };
    expect(() =>
      getAttachment(db, config, { appId: APP_ID, user: intruder, id: created.id })
    ).toThrowError(/not your attachment|forbidden/i);
    expect(() =>
      deleteAttachment(db, config, { appId: APP_ID, user: intruder, id: created.id })
    ).toThrowError(/not your attachment|forbidden/i);
  });

  it("tracks per-user storage bytes", () => {
    const file = (size) => ({
      filename: `f-${size}.txt`,
      mimeType: "text/plain",
      data: Buffer.alloc(size, "a"),
    });
    createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(100) });
    createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(200) });
    expect(getUserStorageBytes(db, { appId: APP_ID, userId: USER.id })).toBe(300);
  });

  it("cascade: deleteAttachmentsForTask wipes rows AND files", () => {
    const file = {
      filename: "doc.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf"),
    };
    const created = createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    const { absolutePath } = getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(existsSync(absolutePath)).toBe(true);

    deleteAttachmentsForTask(db, config, { appId: APP_ID, taskId: TASK_ID });

    expect(existsSync(absolutePath)).toBe(false);
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID })).toHaveLength(0);
  });
});
