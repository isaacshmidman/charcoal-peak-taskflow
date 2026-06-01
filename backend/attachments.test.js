// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createDatabase } from "./db.js";
import {
  createAttachment,
  deleteAttachment,
  deleteAttachmentsForTask,
  getAttachment,
  getStorageOverview,
  getUserStorageBytes,
  listAttachmentsForTask,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES_PER_USER,
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

function seedTask(db, { id = TASK_ID, title = "Test task" } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
      id, app_id, title, status, task_type, recurrence, recurrence_days_json,
      tags_json, created_date, updated_date, created_by_id, created_by, is_sample
    ) VALUES (?, ?, ?, 'todo', 'one_time', 'none', '[]', '[]', ?, ?, ?, ?, 0)`
  ).run(id, APP_ID, title, now, now, USER.id, USER.email);
}

/** Generate a real, tiny PNG that sharp can decode. */
async function realPng({ width = 20, height = 20 } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
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
  it("upload → list → get → delete round-trip", async () => {
    const file = {
      filename: "screenshot.png",
      mimeType: "image/png",
      data: Buffer.from("fake-png-bytes"),
    };
    const created = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
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

    await deleteAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(existsSync(absolutePath)).toBe(false);
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID })).toHaveLength(0);
  });

  it("bumps and decrements the task's attachment_count column", async () => {
    const file = (n) => ({
      filename: `file-${n}.txt`,
      mimeType: "text/plain",
      data: Buffer.from("x".repeat(10 * n)),
    });
    await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(1) });
    await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(2) });

    let row = db.prepare("SELECT attachment_count FROM tasks WHERE id = ?").get(TASK_ID);
    expect(row.attachment_count).toBe(2);

    const list = listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID });
    await deleteAttachment(db, config, { appId: APP_ID, user: USER, id: list[0].id });

    row = db.prepare("SELECT attachment_count FROM tasks WHERE id = ?").get(TASK_ID);
    expect(row.attachment_count).toBe(1);
  });

  it("rejects files past the size limit", async () => {
    const file = {
      filename: "huge.bin",
      mimeType: "application/octet-stream",
      data: Buffer.alloc(MAX_FILE_BYTES + 1),
    };
    await expect(
      createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file })
    ).rejects.toThrow(/too large/i);
  });

  it("rejects blocked extensions", async () => {
    const file = {
      filename: "evil.exe",
      mimeType: "application/octet-stream",
      data: Buffer.from("MZ"),
    };
    await expect(
      createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file })
    ).rejects.toThrow(/not allowed/i);
  });

  it("denies cross-user access on get + delete", async () => {
    const file = {
      filename: "secret.txt",
      mimeType: "text/plain",
      data: Buffer.from("secret"),
    };
    const created = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    const intruder = { id: "user-2", email: "intruder@example.com" };
    // getAttachment is synchronous → toThrow works directly.
    expect(() =>
      getAttachment(db, config, { appId: APP_ID, user: intruder, id: created.id })
    ).toThrowError(/not your attachment|forbidden/i);
    // deleteAttachment is async → use .rejects.toThrow so the failure
    // is observed inside the test rather than firing as an unhandled
    // rejection after db.close().
    await expect(
      deleteAttachment(db, config, { appId: APP_ID, user: intruder, id: created.id })
    ).rejects.toThrow(/not your attachment|forbidden/i);
  });

  it("tracks per-user storage bytes", async () => {
    const file = (size) => ({
      filename: `f-${size}.txt`,
      mimeType: "text/plain",
      data: Buffer.alloc(size, "a"),
    });
    await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(100) });
    await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file(200) });
    expect(getUserStorageBytes(db, { appId: APP_ID, userId: USER.id })).toBe(300);
  });

  it("cascade: deleteAttachmentsForTask wipes rows AND files", async () => {
    const file = {
      filename: "doc.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf"),
    };
    const created = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    const { absolutePath } = getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(existsSync(absolutePath)).toBe(true);

    deleteAttachmentsForTask(db, config, { appId: APP_ID, taskId: TASK_ID });

    expect(existsSync(absolutePath)).toBe(false);
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID })).toHaveLength(0);
  });

  it("generates a thumbnail for valid PNGs and serves it on ?thumb=1", async () => {
    const pngBytes = await realPng({ width: 800, height: 600 });
    const file = {
      filename: "photo.png",
      mimeType: "image/png",
      data: pngBytes,
    };
    const created = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    expect(created.has_thumb).toBe(true);

    // Default get → original file
    const orig = getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(orig.servingThumb).toBe(false);
    expect(readFileSync(orig.absolutePath).length).toBe(pngBytes.length);

    // ?thumb=1 → smaller WebP buffer
    const thumb = getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id, thumb: true });
    expect(thumb.servingThumb).toBe(true);
    expect(existsSync(thumb.absolutePath)).toBe(true);
    expect(readFileSync(thumb.absolutePath).length).toBeLessThan(pngBytes.length);

    // Cleanup also removes the thumbnail file on disk.
    await deleteAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(existsSync(thumb.absolutePath)).toBe(false);
  });

  it("falls back to original when thumbnail generation fails on a fake-image MIME", async () => {
    const file = {
      filename: "broken.png",
      mimeType: "image/png",
      data: Buffer.from("not actually a png"),
    };
    const created = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    expect(created.has_thumb).toBe(false);

    // ?thumb=1 should still resolve to the original when no thumb exists.
    const thumb = getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id, thumb: true });
    expect(thumb.servingThumb).toBe(false);
  });

  it("getStorageOverview returns used bytes + largest tasks", async () => {
    // Second task to verify grouping.
    seedTask(db, { id: "task-2", title: "Second task" });

    const file = (name, size) => ({
      filename: name,
      mimeType: "text/plain",
      data: Buffer.alloc(size, "a"),
    });

    await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file("a.txt", 1000) });
    await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file("b.txt", 2000) });
    await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: "task-2", file: file("c.txt", 500) });

    const usage = getStorageOverview(db, { appId: APP_ID, user: USER });
    expect(usage.used_bytes).toBe(3500);
    expect(usage.max_bytes).toBe(MAX_TOTAL_BYTES_PER_USER);
    expect(usage.biggest_tasks).toHaveLength(2);
    expect(usage.biggest_tasks[0].task_id).toBe(TASK_ID);
    expect(usage.biggest_tasks[0].total_bytes).toBe(3000);
    expect(usage.biggest_tasks[0].file_count).toBe(2);
    expect(usage.biggest_tasks[1].task_id).toBe("task-2");
  });
});
