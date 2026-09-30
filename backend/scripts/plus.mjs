#!/usr/bin/env node
// @ts-check
/**
 * Give Zephyrly Plus to someone (a gift), take it back, or list who has it.
 * Run on the server, never exposed on the web:
 *
 *   docker compose exec taskflow node backend/scripts/plus.mjs grant friend@example.com
 *   docker compose exec taskflow node backend/scripts/plus.mjs revoke friend@example.com
 *   docker compose exec taskflow node backend/scripts/plus.mjs list
 */
import { backendConfig } from "../config.js";
import { createDatabase } from "../db.js";
import { findUserByEmail } from "../store.js";
import { grantPlus, plusOf, revokePlus } from "../plans.js";

const [command, email] = process.argv.slice(2);
const db = createDatabase(backendConfig);
const appId = backendConfig.appId;

const who = () => {
  const user = email ? findUserByEmail(db, appId, email.trim().toLowerCase()) : null;
  if (!user) {
    console.error(`No account with the email "${email || ""}". They need to sign in to Zephyrly once first.`);
    process.exit(1);
  }
  return { appId, userId: user.id, email: user.email };
};

if (command === "grant") {
  const person = who();
  if (plusOf(db, person)) console.log(`${person.email} already has Plus.`);
  else {
    grantPlus(db, { ...person, source: "gift" });
    console.log(`${person.email} now has Plus, as a gift.`);
  }
} else if (command === "revoke") {
  const person = who();
  const n = revokePlus(db, { ...person, reason: "owner" });
  console.log(n ? `Took Plus back from ${person.email}.` : `${person.email} didn't have Plus.`);
} else if (command === "list") {
  const rows = db
    .prepare(
      `SELECT users.email, entitlements.source, entitlements.granted_at FROM entitlements
       JOIN users ON users.id = entitlements.user_id
       WHERE entitlements.app_id = ? AND entitlements.revoked_at IS NULL ORDER BY entitlements.granted_at`
    )
    .all(appId);
  for (const row of rows) console.log(`${row.email}\t${row.source}\t${row.granted_at}`);
  console.log(`${rows.length} with Plus.`);
} else {
  console.log("Usage: node backend/scripts/plus.mjs grant <email> | revoke <email> | list");
  process.exit(command ? 1 : 0);
}
