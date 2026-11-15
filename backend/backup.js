// @ts-check
/**
 * @file Backups of everything the server holds: the database and the
 * files people attached.
 *
 * A backup is one folder, named for when it was made:
 *
 *   <data folder>/backups/2026-11-15_03-12-40/
 *     taskflow.sqlite    the whole database, as it was at one moment
 *     attachments/…      every file that database refers to
 *     manifest.json      what is in it: when, how many of each thing
 *
 * How it stays right while the app is in use:
 *   - The database is copied with `VACUUM INTO`, which gives one moment of
 *     it however many people are writing. Copying the .sqlite file by hand
 *     while the server runs does not (half of it is in the -wal file).
 *   - Then the files that copy refers to are taken. A stored file is
 *     written once under a name of its own and never changed, so the copy
 *     in the backup is a second name for the same file where the disk
 *     allows it (a hard link): no extra space, and deleting the original
 *     leaves the backup's intact. Where it doesn't, the file is copied.
 *   - The folder is written as `<name>.partial` and given its real name
 *     only when it is whole, so a backup cut short is never taken for one.
 *
 * The server makes one a day and keeps the last 14 (startBackupLoop).
 * `node backend/scripts/backup.js` makes, lists, checks and rehearses
 * them by hand. docs/backups.md says how to put one back.
 *
 * What a backup does NOT hold: the server's `.env`. The calendar sign-ins
 * in the database are locked with a key from that file, and it must not
 * sit beside them. Keep a copy of `.env` somewhere of its own.
 */
import { DatabaseSync } from "node:sqlite";
import { promises as fsp } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { attachmentsRoot } from "./attachments.js";
import { log } from "./log.js";

export const DATABASE_NAME = "taskflow.sqlite";
export const FILES_FOLDER = "attachments";
export const MANIFEST_NAME = "manifest.json";
/** How many backups are kept when nothing says otherwise. */
export const KEEP = 14;
/** A new one is made when the newest is older than this. */
export const EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 2 * 60 * 1000;
const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
const PARTIAL = ".partial";
/** Missing files named in the manifest; the count is always exact. */
const MISSING_NAMED = 50;

/**
 * Where backups are kept: beside the data unless the settings name
 * another folder (another drive is the point of naming one).
 * @param {{ dbFile: string, backupDir?: string }} config
 */
export function backupsRoot(config) {
  return config.backupDir ? resolve(config.backupDir) : resolve(dirname(config.dbFile), "backups");
}

/** @param {Date} when */
function nameFor(when) {
  return when.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

/** @param {string} name a backup's folder name @returns {number} */
function madeAt(name) {
  return Date.parse(`${name.slice(0, 10)}T${name.slice(11).replace(/-/g, ":")}Z`);
}

/** @param {string} path */
async function exists(path) {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Give `to` the contents of `from`: a second name for the same file where
 * the disk allows it, a copy where it doesn't.
 * @returns {Promise<"linked" | "copied">}
 */
async function linkOrCopy(from, to) {
  await fsp.mkdir(dirname(to), { recursive: true });
  try {
    await fsp.link(from, to);
    return "linked";
  } catch (error) {
    if (/** @type {any} */ (error)?.code === "ENOENT") throw error;
    await fsp.copyFile(from, to);
    return "copied";
  }
}

/**
 * How many rows each table of a database holds.
 * @param {DatabaseSync} db
 * @returns {Record<string, number>}
 */
function tableCounts(db) {
  /** @type {Record<string, number>} */
  const counts = {};
  const tables = /** @type {{ name: string }[]} */ (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
  );
  for (const { name } of tables) {
    counts[name] = Number(/** @type {any} */ (db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get()).n);
  }
  return counts;
}

/**
 * The files a database refers to: path under the files folder, and the
 * size the original should have (a thumbnail's size isn't recorded).
 * @param {DatabaseSync} db
 * @returns {{ path: string, bytes: number | null }[]}
 */
function referencedFiles(db) {
  const rows = /** @type {any[]} */ (db.prepare(`SELECT storage_path, thumb_path, size_bytes FROM task_attachments`).all());
  /** @type {{ path: string, bytes: number | null }[]} */
  const files = [];
  for (const row of rows) {
    if (row.storage_path) files.push({ path: String(row.storage_path), bytes: Number(row.size_bytes) });
    if (row.thumb_path) files.push({ path: String(row.thumb_path), bytes: null });
  }
  return files;
}

/** A path from the database that stays inside the folder it is joined to. */
function inside(root, relPath) {
  const full = resolve(root, relPath);
  return full.startsWith(resolve(root) + "/") ? full : null;
}

/**
 * The whole backups kept in a folder, newest first.
 * @param {string} root
 * @returns {Promise<{ name: string, folder: string, madeAt: number }[]>}
 */
export async function listBackups(root) {
  let names = [];
  try {
    names = await fsp.readdir(root);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    if (!BACKUP_NAME.test(name)) continue;
    const folder = join(root, name);
    if (!(await exists(join(folder, MANIFEST_NAME)))) continue;
    found.push({ name, folder, madeAt: madeAt(name) });
  }
  return found.sort((a, b) => b.madeAt - a.madeAt);
}

/** @param {string} folder */
export async function readManifest(folder) {
  return JSON.parse(await fsp.readFile(join(folder, MANIFEST_NAME), "utf8"));
}

/**
 * Make a backup now.
 *
 * @param {{ dbFile: string, backupDir?: string, backupKeep?: number, appId?: string }} config
 * @param {{ now?: Date, keep?: number, db?: DatabaseSync }} [how] `db`: a
 *   connection to use; without one the database is opened to be read only.
 * @returns {Promise<{ name: string, folder: string, manifest: any, removed: string[] }>}
 */
export async function makeBackup(config, how = {}) {
  const now = how.now || new Date();
  const keep = Math.max(1, how.keep || config.backupKeep || KEEP);
  const root = backupsRoot(config);
  const name = nameFor(now);
  const folder = join(root, name);
  const partial = folder + PARTIAL;
  if (await exists(folder)) throw new Error(`A backup named ${name} is already there.`);
  await fsp.rm(partial, { recursive: true, force: true });
  await fsp.mkdir(partial, { recursive: true });

  // 1. The database, as it is at this moment.
  const snapshotFile = join(partial, DATABASE_NAME);
  const source = how.db || new DatabaseSync(config.dbFile, { readOnly: true });
  try {
    source.exec(`VACUUM INTO '${snapshotFile.replace(/'/g, "''")}'`);
  } finally {
    if (!how.db) source.close();
  }

  // 2. What that copy holds, and whether it is sound.
  const snapshot = new DatabaseSync(snapshotFile, { readOnly: true });
  let tables;
  let files;
  let integrity;
  try {
    integrity = String(/** @type {any} */ (snapshot.prepare(`PRAGMA integrity_check`).get())?.integrity_check || "");
    tables = tableCounts(snapshot);
    files = referencedFiles(snapshot);
  } finally {
    snapshot.close();
  }
  if (integrity !== "ok") throw new Error(`The copy of the database failed its own check: ${integrity}`);

  // 3. The files it refers to.
  const from = attachmentsRoot(config);
  const to = join(partial, FILES_FOLDER);
  await fsp.mkdir(to, { recursive: true });
  let linked = 0;
  let copied = 0;
  let bytes = 0;
  /** @type {string[]} */
  const missing = [];
  for (const file of files) {
    const original = inside(from, file.path);
    const target = inside(to, file.path);
    if (!original || !target) {
      missing.push(file.path);
      continue;
    }
    try {
      const way = await linkOrCopy(original, target);
      if (way === "linked") linked += 1;
      else copied += 1;
      bytes += (await fsp.stat(target)).size;
    } catch {
      missing.push(file.path);
    }
  }

  const manifest = {
    made_at: now.toISOString(),
    app_id: config.appId || null,
    database: { file: DATABASE_NAME, bytes: (await fsp.stat(snapshotFile)).size, integrity },
    tables,
    files: {
      count: files.length - missing.length,
      bytes,
      linked,
      copied,
      missing_count: missing.length,
      missing: missing.slice(0, MISSING_NAMED),
    },
  };
  await fsp.writeFile(join(partial, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
  // Whole: it gets its real name.
  await fsp.rename(partial, folder);

  const removed = await removeOldBackups(root, keep, now);
  return { name, folder, manifest, removed };
}

/**
 * Keep the newest `keep`; remove the rest, and any backup that was cut
 * short more than a day ago. Only folders this file made are touched.
 * @param {string} root
 * @param {number} keep
 * @param {Date} [now]
 * @returns {Promise<string[]>} the names removed
 */
export async function removeOldBackups(root, keep, now = new Date()) {
  const removed = [];
  const backups = await listBackups(root);
  for (const old of backups.slice(Math.max(1, keep))) {
    await fsp.rm(old.folder, { recursive: true, force: true });
    removed.push(old.name);
  }
  let names = [];
  try {
    names = await fsp.readdir(root);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.endsWith(PARTIAL) || !BACKUP_NAME.test(name.slice(0, -PARTIAL.length))) continue;
    if (now.getTime() - madeAt(name.slice(0, -PARTIAL.length)) < EVERY_MS) continue;
    await fsp.rm(join(root, name), { recursive: true, force: true });
  }
  return removed;
}

/**
 * Look a backup over without changing anything: the database is sound,
 * holds what the manifest says, and every file it refers to is there at
 * the right size.
 *
 * @param {string} folder
 * @returns {Promise<{ ok: boolean, problems: string[], manifest: any }>}
 */
export async function checkBackup(folder) {
  /** @type {string[]} */
  const problems = [];
  let manifest = null;
  try {
    manifest = await readManifest(folder);
  } catch {
    return { ok: false, problems: ["The backup has no readable manifest.json: it was not finished, or is not a backup."], manifest };
  }
  const file = join(folder, DATABASE_NAME);
  if (!(await exists(file))) return { ok: false, problems: [`${DATABASE_NAME} is missing.`], manifest };

  /** @type {{ path: string, bytes: number | null }[]} */
  let files = [];
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = String(/** @type {any} */ (db.prepare(`PRAGMA integrity_check`).get())?.integrity_check || "");
    if (integrity !== "ok") problems.push(`The database fails its own check: ${integrity}`);
    const counts = tableCounts(db);
    for (const [table, expected] of Object.entries(manifest.tables || {})) {
      if (counts[table] !== expected) problems.push(`Table ${table} holds ${counts[table] ?? "nothing"}; the manifest says ${expected}.`);
    }
    files = referencedFiles(db);
  } catch (error) {
    problems.push(`The database can't be read: ${error instanceof Error ? error.message : error}`);
  } finally {
    db?.close();
  }

  const known = new Set(manifest.files?.missing || []);
  let absent = 0;
  for (const entry of files) {
    const path = inside(join(folder, FILES_FOLDER), entry.path);
    let size = -1;
    try {
      size = path ? (await fsp.stat(path)).size : -1;
    } catch {
      /* not there */
    }
    if (size < 0) {
      absent += 1;
      // Already missing when the backup was made: said once, below.
      if (!known.has(entry.path) && absent <= MISSING_NAMED) problems.push(`A file is missing: ${entry.path}`);
    } else if (entry.bytes != null && size !== entry.bytes) {
      problems.push(`A file is the wrong size (${size} bytes, should be ${entry.bytes}): ${entry.path}`);
    }
  }
  const wereMissing = Number(manifest.files?.missing_count || 0);
  if (wereMissing > 0) {
    problems.push(`${wereMissing} ${wereMissing === 1 ? "file was" : "files were"} already missing from the server when this backup was made.`);
  }
  return { ok: problems.length === 0, problems, manifest };
}

/** One line saying what a backup holds. @param {any} manifest */
export function describeBackup(manifest) {
  const tables = manifest?.tables || {};
  const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const megabytes = ((Number(manifest?.database?.bytes || 0) + Number(manifest?.files?.bytes || 0)) / 1_000_000).toFixed(1);
  return [
    part(Number(tables.users || 0), "person", "people"),
    part(Number(tables.tasks || 0), "task", "tasks"),
    part(Number(tables.notes || 0), "note", "notes"),
    part(Number(manifest?.files?.count || 0), "file", "files"),
    `${megabytes} MB`,
  ].join(", ");
}

/**
 * Make a backup a day for as long as the server runs. Looks once an hour
 * and makes one when the newest is over a day old, so a server that was
 * off at the usual time catches up.
 *
 * @param {DatabaseSync} db
 * @param {{ dbFile: string, backupDir?: string, backupKeep?: number, backups?: boolean, appId?: string }} config
 * @returns {{ stop: () => void, runNow: () => Promise<void> }}
 */
export function startBackupLoop(db, config) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const [newest] = await listBackups(backupsRoot(config));
      if (newest && Date.now() - newest.madeAt < EVERY_MS) return;
      const made = await makeBackup(config, { db });
      const missing = Number(made.manifest.files.missing_count || 0);
      log.info(
        `[backup] made ${made.name}: ${describeBackup(made.manifest)}${missing ? ` · ${missing} files were already missing` : ""}${made.removed.length ? ` · removed ${made.removed.length} old` : ""}`
      );
    } catch (error) {
      log.error(`[backup] FAILED: ${error instanceof Error ? error.message : error}`);
    } finally {
      running = false;
    }
  };
  // Only where the settings say so: a test or a script that starts a
  // server with settings of its own makes no backups.
  if (config.backups !== true) return { stop() {}, runNow: run };
  const first = setTimeout(run, FIRST_CHECK_MS);
  const every = setInterval(run, CHECK_EVERY_MS);
  first.unref?.();
  every.unref?.();
  return {
    stop() {
      clearTimeout(first);
      clearInterval(every);
    },
    runNow: run,
  };
}
