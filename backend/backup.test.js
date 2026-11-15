// @ts-nocheck
/* @vitest-environment node */
/**
 * Backups (backup.js) and the rehearsal of putting one back
 * (backup-rehearsal.js), on a database and files made for the test.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";
import { backupsRoot, checkBackup, describeBackup, listBackups, makeBackup, startBackupLoop } from "./backup.js";
import { rehearseRestore } from "./backup-rehearsal.js";

const APP = "test-app";
let tempDir = "";
let db;
let config;
const iso = () => new Date().toISOString();

function addTask(id, userId = "user_1") {
  db.prepare(
    `INSERT INTO tasks (id, app_id, title, status, task_type, recurrence, recurrence_days_json, due_date, tags_json, created_date, updated_date, created_by_id, created_by)
     VALUES (?, ?, 'A task', 'todo', 'one_time', 'none', '[]', '2026-11-20', '[]', ?, ?, ?, ?)`
  ).run(id, APP, iso(), iso(), userId, userId === "user_1" ? "someone@example.com" : "other@example.com");
}

function addFile(id, taskId, contents, { thumb = false } = {}) {
  const relPath = join(APP, "user_1", taskId, `${id}_photo.jpg`);
  const abs = join(tempDir, "attachments", relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
  if (thumb) writeFileSync(`${abs}.thumb.webp`, "thumb");
  db.prepare(
    `INSERT INTO task_attachments (id, app_id, user_id, task_id, filename, mime_type, size_bytes, storage_path, thumb_path, is_image, created_date)
     VALUES (?, ?, 'user_1', ?, 'photo.jpg', 'image/jpeg', ?, ?, ?, 1, ?)`
  ).run(id, APP, taskId, Buffer.byteLength(contents), relPath, thumb ? `${relPath}.thumb.webp` : null, iso());
  return { relPath, abs };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "zephyrly-backup-"));
  config = {
    host: "127.0.0.1", port: 0, appId: APP, appName: "Zephyrly Test", publicAppUrl: "http://127.0.0.1:4173",
    dbFile: join(tempDir, "taskflow.sqlite"), sessionCookieName: "s", sessionTtlDays: 30, deletedTaskRetentionDays: 7,
    allowAnyPassword: false, googleMode: "disabled", integrationsEnabled: false, syncIntervalMs: 60000,
  };
  db = createDatabase(config);
  db.prepare(`INSERT INTO users (id, app_id, email, role, auth_provider, created_date, updated_date) VALUES ('user_1', ?, 'someone@example.com', 'admin', 'local', ?, ?)`).run(APP, iso(), iso());
  db.prepare(`INSERT INTO users (id, app_id, email, role, auth_provider, created_date, updated_date) VALUES ('user_2', ?, 'other@example.com', 'user', 'local', ?, ?)`).run(APP, iso(), iso());
});

afterEach(() => {
  try { db?.close(); } catch { /* closed in the test */ }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("making a backup", () => {
  it("holds the database as it was and every file it refers to, and says what is in it", async () => {
    addTask("task_1");
    addTask("task_2");
    addTask("task_3", "user_2");
    const file = addFile("att_1", "task_1", "the photo's bytes", { thumb: true });
    // A file on disk the database knows nothing of is not part of the data.
    writeFileSync(join(tempDir, "attachments", "stray.bin"), "stray");

    const made = await makeBackup(config, { db, now: new Date("2026-11-15T03:12:40Z") });

    expect(made.name).toBe("2026-11-15_03-12-40");
    expect(made.folder).toBe(join(tempDir, "backups", "2026-11-15_03-12-40"));
    expect(made.manifest.tables).toMatchObject({ users: 2, tasks: 3, task_attachments: 1 });
    expect(made.manifest.files).toMatchObject({ count: 2, missing_count: 0 });
    expect(made.manifest.database.integrity).toBe("ok");
    expect(describeBackup(made.manifest)).toMatch(/^2 people, 3 tasks, 0 notes, 2 files, /);
    expect(readFileSync(join(made.folder, "attachments", file.relPath), "utf8")).toBe("the photo's bytes");
    expect(existsSync(join(made.folder, "attachments", `${file.relPath}.thumb.webp`))).toBe(true);
    expect(existsSync(join(made.folder, "attachments", "stray.bin"))).toBe(false);

    // What happens on the server afterwards doesn't reach the backup.
    db.prepare(`DELETE FROM tasks`).run();
    unlinkSync(file.abs);
    const kept = new DatabaseSync(join(made.folder, "taskflow.sqlite"), { readOnly: true });
    expect(kept.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n).toBe(3);
    kept.close();
    expect(readFileSync(join(made.folder, "attachments", file.relPath), "utf8")).toBe("the photo's bytes");
    expect((await checkBackup(made.folder)).ok).toBe(true);
  });

  it("works on a database the server has open, reading it only", async () => {
    addTask("task_1");
    // No connection handed over: the script's way, beside a running server.
    const made = await makeBackup(config, { now: new Date("2026-11-15T03:12:40Z") });
    expect(made.manifest.tables.tasks).toBe(1);
  });

  it("names a file the server had already lost, and still makes the backup", async () => {
    addTask("task_1");
    const file = addFile("att_1", "task_1", "bytes");
    unlinkSync(file.abs);

    const made = await makeBackup(config, { db });
    expect(made.manifest.files).toMatchObject({ count: 0, missing_count: 1, missing: [file.relPath] });
    const checked = await checkBackup(made.folder);
    expect(checked.ok).toBe(false);
    expect(checked.problems).toEqual(["1 file was already missing from the server when this backup was made."]);
  });

  it("keeps the newest few and removes the rest, touching nothing else in the folder", async () => {
    const root = backupsRoot(config);
    mkdirSync(join(root, "my-own-folder"), { recursive: true });
    for (let day = 1; day <= 5; day += 1) {
      await makeBackup(config, { db, keep: 3, now: new Date(`2026-11-0${day}T03:00:00Z`) });
    }
    expect((await listBackups(root)).map((backup) => backup.name)).toEqual(["2026-11-05_03-00-00", "2026-11-04_03-00-00", "2026-11-03_03-00-00"]);
    expect(readdirSync(root).sort()).toEqual(["2026-11-03_03-00-00", "2026-11-04_03-00-00", "2026-11-05_03-00-00", "my-own-folder"]);
  });

  it("a backup cut short is never listed as one, and is cleared away a day later", async () => {
    const root = backupsRoot(config);
    mkdirSync(join(root, "2026-11-01_03-00-00.partial"), { recursive: true });
    writeFileSync(join(root, "2026-11-01_03-00-00.partial", "taskflow.sqlite"), "half");
    expect(await listBackups(root)).toEqual([]);

    await makeBackup(config, { db, now: new Date("2026-11-03T03:00:00Z") });
    expect(readdirSync(root)).toEqual(["2026-11-03_03-00-00"]);
  });

  it("keeps them where the settings say", async () => {
    const elsewhere = join(tempDir, "other-drive");
    const made = await makeBackup({ ...config, backupDir: elsewhere }, { db });
    expect(made.folder.startsWith(elsewhere)).toBe(true);
  });
});

describe("looking a backup over", () => {
  it("says what is wrong with one that was damaged afterwards", async () => {
    addTask("task_1");
    const file = addFile("att_1", "task_1", "the photo's bytes");
    const made = await makeBackup(config, { db });

    writeFileSync(join(made.folder, "attachments", file.relPath), "cut");
    let checked = await checkBackup(made.folder);
    expect(checked.ok).toBe(false);
    expect(checked.problems[0]).toContain("wrong size");

    unlinkSync(join(made.folder, "attachments", file.relPath));
    checked = await checkBackup(made.folder);
    expect(checked.problems).toEqual([`A file is missing: ${file.relPath}`]);

    const damaged = new DatabaseSync(join(made.folder, "taskflow.sqlite"));
    damaged.exec(`DELETE FROM tasks`);
    damaged.close();
    checked = await checkBackup(made.folder);
    expect(checked.problems).toContain("Table tasks holds 0; the manifest says 1.");
  });

  it("a folder that isn't a finished backup is said to be that", async () => {
    mkdirSync(join(tempDir, "backups", "nothing-here"), { recursive: true });
    const checked = await checkBackup(join(tempDir, "backups", "nothing-here"));
    expect(checked.ok).toBe(false);
    expect(checked.problems[0]).toContain("no readable manifest.json");
  });
});

describe("the daily backup", () => {
  it("makes one when there is none or the newest is over a day old, and not otherwise", async () => {
    addTask("task_1");
    const loop = startBackupLoop(db, { ...config, backups: true });
    try {
      await loop.runNow();
      const root = backupsRoot(config);
      expect(await listBackups(root)).toHaveLength(1);
      // The newest is fresh: nothing to do.
      await loop.runNow();
      expect(await listBackups(root)).toHaveLength(1);
    } finally {
      loop.stop();
    }
  });
});

describe("rehearsing putting a backup back", () => {
  it("starts the real server on a copy, gets everyone's things from it, and leaves nothing behind", async () => {
    addTask("task_1");
    addTask("task_2");
    addTask("task_3", "user_2");
    addFile("att_1", "task_1", "the photo's bytes");
    const made = await makeBackup(config, { db });
    const before = statSync(join(made.folder, "taskflow.sqlite")).mtimeMs;

    const result = await rehearseRestore(made.folder, config);

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.did).toEqual([
      expect.stringMatching(/^The backup is whole: 2 people, 3 tasks, 0 notes, 1 file, /),
      "This version of the app opened the database.",
      "The server gave every person their tasks and notes, and a stored file where they have one.",
      "The server on the copy reports healthy.",
    ]);
    // The backup itself was only read, and the copy is gone.
    expect(statSync(join(made.folder, "taskflow.sqlite")).mtimeMs).toBe(before);
    expect(readdirSync(backupsRoot(config))).toEqual([made.name]);
    // The live database got no sessions out of it.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get().n).toBe(0);
  });

  it("fails, saying why, when a stored file in the backup has been swapped", async () => {
    addTask("task_1");
    const file = addFile("att_1", "task_1", "the photo's bytes");
    const made = await makeBackup(config, { db });
    unlinkSync(join(made.folder, "attachments", file.relPath));

    const result = await rehearseRestore(made.folder, config);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("A file is missing");
    expect(readdirSync(backupsRoot(config))).toEqual([made.name]);
  });
});
