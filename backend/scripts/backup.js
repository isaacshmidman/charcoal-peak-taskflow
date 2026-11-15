// @ts-check
/**
 * Backups by hand. On the server:
 *
 *   docker compose exec taskflow node backend/scripts/backup.js            make one now
 *   docker compose exec taskflow node backend/scripts/backup.js list       what is kept
 *   docker compose exec taskflow node backend/scripts/backup.js check      look the newest over
 *   docker compose exec taskflow node backend/scripts/backup.js rehearse   start a server on a copy of the newest and ask it for everything
 *
 * `check` and `rehearse` take a backup's name to look at one that isn't
 * the newest. Safe while the app is running: the live database is only
 * read. Exits with 1 when something is wrong. See backend/backup.js and
 * docs/backups.md.
 */
import { join } from "node:path";
import { backendConfig } from "../config.js";
import { backupsRoot, checkBackup, describeBackup, listBackups, makeBackup, readManifest } from "../backup.js";

const [command = "now", wanted] = process.argv.slice(2);
const root = backupsRoot(backendConfig);

async function pick() {
  if (wanted) return join(root, wanted);
  const [newest] = await listBackups(root);
  if (!newest) throw new Error(`There are no backups in ${root} yet. Make one first: node backend/scripts/backup.js`);
  return newest.folder;
}

function report(title, result) {
  console.log(title);
  for (const line of result.did || []) console.log(`  ✓ ${line}`);
  for (const line of result.problems) console.log(`  ✗ ${line}`);
  console.log(result.ok ? "  Nothing wrong." : "  NOT sound: see the lines marked ✗.");
}

try {
  if (command === "now") {
    const made = await makeBackup(backendConfig);
    console.log(`Made ${made.folder}`);
    console.log(`  ${describeBackup(made.manifest)}`);
    const missing = Number(made.manifest.files.missing_count || 0);
    if (missing) console.log(`  ${missing} files the database refers to were not on the server (named in manifest.json).`);
    if (made.removed.length) console.log(`  Removed ${made.removed.length} old: ${made.removed.join(", ")}`);
  } else if (command === "list") {
    const backups = await listBackups(root);
    if (backups.length === 0) console.log(`No backups in ${root} yet.`);
    for (const backup of backups) console.log(`${backup.name}  ${describeBackup(await readManifest(backup.folder))}`);
  } else if (command === "check") {
    const folder = await pick();
    const result = await checkBackup(folder);
    report(`Checked ${folder}`, result);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "rehearse") {
    const folder = await pick();
    const { rehearseRestore } = await import("../backup-rehearsal.js");
    const result = await rehearseRestore(folder, backendConfig);
    report(`Rehearsed putting back ${folder}`, result);
    if (!result.ok) process.exitCode = 1;
  } else {
    console.log("Usage: node backend/scripts/backup.js [now | list | check [name] | rehearse [name]]");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
