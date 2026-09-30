// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, rmSync, readFileSync, existsSync, promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "./plans.js";
import sharp from "sharp";
import { createDatabase } from "./db.js";
import {
  createAttachment,
  deleteAttachment,
  deleteAttachmentsForTasks,
  getAttachment,
  holdAttachmentsForTasks,
  releaseHeldAttachments,
  getStorageOverview,
  getUserStorageBytes,
  listAttachmentsForTask,
  MAX_FILE_BYTES,
} from "./attachments.js";
import { createEntityRecord, deleteEntityRecord } from "./store.js";

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

function seedTask(database, { id = TASK_ID, title = "Test task" } = {}) {
  const now = new Date().toISOString();
  database.prepare(
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

  it("cascade: deleteAttachmentsForTasks wipes rows AND files", async () => {
    const file = {
      filename: "doc.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf"),
    };
    const created = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file });
    const { absolutePath } = getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id });
    expect(existsSync(absolutePath)).toBe(true);

    deleteAttachmentsForTasks(db, config, { appId: APP_ID, taskIds: [TASK_ID] });

    expect(existsSync(absolutePath)).toBe(false);
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: TASK_ID })).toHaveLength(0);
  });

  it("a task deleted for good (calendar sync) takes its subtasks' files with its own — none are left behind", async () => {
    const sub = createEntityRecord(db, { entityName: "Task", appId: APP_ID, user: USER, input: { title: "Sub", parent_id: TASK_ID }, config });
    const file = (name) => ({ filename: name, mimeType: "application/pdf", data: Buffer.from(name) });
    const paths = [];
    for (const [taskId, name] of [[TASK_ID, "own.pdf"], [sub.id, "sub.pdf"]]) {
      const created = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId, file: file(name) });
      paths.push(getAttachment(db, config, { appId: APP_ID, user: USER, id: created.id }).absolutePath);
    }

    deleteEntityRecord(db, { entityName: "Task", appId: APP_ID, user: USER, id: TASK_ID, config });

    expect(paths.map((path) => existsSync(path))).toEqual([false, false]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM task_attachments").get().n).toBe(0);
    expect(getUserStorageBytes(db, { appId: APP_ID, userId: USER.id })).toBe(0);
  });

  it("a file still uploading when its task is deleted is held with it, not left on a task that's gone", async () => {
    const write = fsPromises.writeFile;
    vi.spyOn(fsPromises, "writeFile").mockImplementationOnce(async (...args) => {
      // The task goes into Recently Deleted while the bytes are being written.
      db.prepare("DELETE FROM tasks WHERE id = ?").run(TASK_ID);
      holdAttachmentsForTasks(db, { appId: APP_ID, taskIds: [TASK_ID] });
      return write(...args);
    });
    const created = await createAttachment(db, config, {
      appId: APP_ID, user: USER, taskId: TASK_ID, file: { filename: "late.pdf", mimeType: "application/pdf", data: Buffer.from("late") },
    });
    vi.restoreAllMocks();

    expect(db.prepare("SELECT task_deleted_at FROM task_attachments WHERE id = ?").get(created.id).task_deleted_at).toBeTruthy();
    // So restoring the task brings it back like the rest.
    seedTask(db, { id: "task-restored" });
    expect(releaseHeldAttachments(db, { appId: APP_ID, userId: USER.id, fromTaskIds: [TASK_ID], toTaskId: "task-restored" })).toBe(1);
    expect(listAttachmentsForTask(db, { appId: APP_ID, user: USER, taskId: "task-restored" }).map((a) => a.filename)).toEqual(["late.pdf"]);
  });

  it("removing a task's files never takes another task's out of a shared folder", async () => {
    const file = (name) => ({ filename: name, mimeType: "application/pdf", data: Buffer.from(name) });
    // A file restored onto another task keeps the path it was stored under.
    const moved = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file("moved.pdf") });
    db.prepare("DELETE FROM tasks WHERE id = ?").run(TASK_ID);
    holdAttachmentsForTasks(db, { appId: APP_ID, taskIds: [TASK_ID] });
    seedTask(db, { id: "task-copy" });
    releaseHeldAttachments(db, { appId: APP_ID, userId: USER.id, fromTaskIds: [TASK_ID], toTaskId: "task-copy" });
    // The original comes back under its old id (a restore from an export) with a file of its own, in the same folder.
    seedTask(db, { id: TASK_ID });
    const own = await createAttachment(db, config, { appId: APP_ID, user: USER, taskId: TASK_ID, file: file("own.pdf") });
    const movedPath = getAttachment(db, config, { appId: APP_ID, user: USER, id: moved.id }).absolutePath;
    const ownPath = getAttachment(db, config, { appId: APP_ID, user: USER, id: own.id }).absolutePath;

    deleteAttachmentsForTasks(db, config, { appId: APP_ID, taskIds: ["task-copy"] });

    expect(existsSync(movedPath)).toBe(false);
    expect(readFileSync(ownPath, "utf8")).toBe("own.pdf");
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
    // A Basic account's room (backend/plans.js).
    expect(usage.max_bytes).toBe(LIMITS.basic.storageBytes);
    expect(usage.biggest_tasks).toHaveLength(2);
    expect(usage.biggest_tasks[0].task_id).toBe(TASK_ID);
    expect(usage.biggest_tasks[0].total_bytes).toBe(3000);
    expect(usage.biggest_tasks[0].file_count).toBe(2);
    expect(usage.biggest_tasks[1].task_id).toBe("task-2");
  });
});
