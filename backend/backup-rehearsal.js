// @ts-check
/**
 * @file A rehearsal of putting a backup back: the only way to know a
 * backup is one.
 *
 * The backup is copied to a folder of its own, and the real server is
 * started on that copy, on this machine only. Then it is asked what the
 * app would ask: is it healthy, does each person get their tasks and
 * notes, does a stored file come back byte for byte. Nothing is sent
 * anywhere (calendar sync and reminders never start), the live data is
 * not opened, and the copy is removed afterwards.
 *
 * What it proves: this backup, with this version of the app, comes back
 * as a working server holding what the manifest says. What it can't: that
 * the `.env` kept beside it is the right one (calendar sign-ins need its
 * key), or that the drive the backup is on will still be readable.
 */
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
import { DATABASE_NAME, FILES_FOLDER, checkBackup, describeBackup } from "./backup.js";

/** People asked about one by one; the counts cover everyone regardless. */
const PEOPLE_ASKED = 25;

/** Copy a folder, as second names for the same files where the disk allows. */
async function copyTree(from, to) {
  let entries = [];
  try {
    entries = await fsp.readdir(from, { withFileTypes: true });
  } catch {
    return;
  }
  await fsp.mkdir(to, { recursive: true });
  for (const entry of entries) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) {
      try {
        await fsp.link(source, target);
      } catch {
        await fsp.copyFile(source, target);
      }
    }
  }
}

/** @param {Buffer} data */
const digest = (data) => createHash("sha256").update(data).digest("hex");

/**
 * @param {string} folder the backup to rehearse
 * @param {import("./config.js").backendConfig} config the server's own settings
 * @param {{ scratch?: string }} [how] where to put the copy (default: beside the backup)
 * @returns {Promise<{ ok: boolean, problems: string[], did: string[], manifest: any }>}
 */
export async function rehearseRestore(folder, config, how = {}) {
  /** @type {string[]} */
  const did = [];
  const looked = await checkBackup(folder);
  const problems = [...looked.problems];
  if (!looked.manifest) return { ok: false, problems, did, manifest: null };
  did.push(`The backup is whole: ${describeBackup(looked.manifest)}.`);

  const scratch = how.scratch || join(dirname(folder), `.rehearsal-${randomUUID().slice(0, 8)}`);
  /** @type {import("node:sqlite").DatabaseSync | null} */
  let db = null;
  /** @type {any} */
  let server = null;
  try {
    await fsp.mkdir(scratch, { recursive: true });
    // The database is always a real copy: the server writes to it.
    await fsp.copyFile(join(folder, DATABASE_NAME), join(scratch, DATABASE_NAME));
    await copyTree(join(folder, FILES_FOLDER), join(scratch, FILES_FOLDER));

    // Imported here, not at the top: the server imports the backup code.
    const { createDatabase } = await import("./db.js");
    const { createRequestHandler } = await import("./server.js");
    const { createSession } = await import("./auth.js");

    const rehearsalConfig = /** @type {any} */ ({
      ...config,
      host: "127.0.0.1",
      port: 0,
      dbFile: join(scratch, DATABASE_NAME),
      // Nothing leaves this machine during a rehearsal.
      integrationsEnabled: false,
      backups: false,
    });
    // Opening it runs every change the database's shape has had since the
    // backup was made: an old backup has to survive that too.
    db = createDatabase(rehearsalConfig);
    did.push("This version of the app opened the database.");

    server = http.createServer(createRequestHandler(rehearsalConfig, db));
    await new Promise((done) => server.listen(0, "127.0.0.1", () => done(null)));
    const { port } = /** @type {any} */ (server.address());
    const base = `http://127.0.0.1:${port}`;
    const appId = rehearsalConfig.appId;

    const users = /** @type {any[]} */ (db.prepare(`SELECT * FROM users WHERE app_id = ? ORDER BY created_date`).all(appId));
    let asked = 0;
    for (const user of users.slice(0, PEOPLE_ASKED)) {
      const { accessToken } = createSession(db, rehearsalConfig, /** @type {any} */ ({ headers: {}, socket: {} }), { appId, user });
      const headers = { Authorization: `Bearer ${accessToken}` };
      for (const [entity, table] of [["Task", "tasks"], ["Note", "notes"]]) {
        const expected = Number(
          // Whose a thing is, the way the server decides it (store.js).
          /** @type {any} */ (
            db
              .prepare(
                `SELECT COUNT(*) AS n FROM ${table} WHERE app_id = ? AND ((created_by_id = ? AND created_by_id != '') OR LOWER(created_by) = ?)`
              )
              .get(appId, user.id, String(user.email || "").toLowerCase())
          ).n
        );
        const answer = await fetch(`${base}/api/apps/${appId}/entities/${entity}`, { headers });
        const list = answer.ok ? await answer.json() : null;
        if (!Array.isArray(list)) problems.push(`Asking for a person's ${table} failed (${answer.status}).`);
        else if (list.length !== expected) problems.push(`A person's ${table}: the server gave ${list.length}, the database holds ${expected}.`);
      }

      // One stored file of theirs, fetched as the app would, compared with the backup's.
      const file = /** @type {any} */ (
        db.prepare(`SELECT id, storage_path FROM task_attachments WHERE app_id = ? AND user_id = ? ORDER BY created_date DESC LIMIT 1`).get(appId, user.id)
      );
      if (file) {
        const answer = await fetch(`${base}/api/apps/${appId}/attachments/${file.id}`, { headers });
        const got = answer.ok ? Buffer.from(await answer.arrayBuffer()) : null;
        let kept = null;
        try {
          kept = await fsp.readFile(join(folder, FILES_FOLDER, file.storage_path));
        } catch {
          /* said by checkBackup already */
        }
        if (!got) problems.push(`Fetching a stored file failed (${answer.status}).`);
        else if (kept && digest(got) !== digest(kept)) problems.push("A stored file came back different from the one in the backup.");
      }
      asked += 1;
    }
    did.push(
      users.length === 0
        ? "The database holds no people, so nobody's lists could be asked for."
        : `The server gave ${asked === users.length ? "every person" : `${asked} of ${users.length} people`} their tasks and notes, and a stored file where they have one.`
    );

    const health = await fetch(`${base}/api/health`);
    if (!health.ok) problems.push(`The server's health check answered ${health.status}.`);
    else did.push("The server on the copy reports healthy.");
  } catch (error) {
    problems.push(`The rehearsal stopped: ${error instanceof Error ? error.message : error}`);
  } finally {
    if (server) await new Promise((done) => server.close(() => done(null)));
    try {
      db?.close();
    } catch {
      /* already closed */
    }
    await fsp.rm(scratch, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, problems, did, manifest: looked.manifest };
}
