// @ts-check
/**
 * @file How a person arranged their Home page: which blocks show, in
 * what order, and how wide each is. Kept with their other preferences on
 * the user row, so the page they set up on a laptop is the page they get
 * on a phone.
 *
 * The server keeps the shape honest and nothing more. Which blocks exist
 * is the app's business (src/lib/home-blocks.js): a name the app no
 * longer knows is simply not drawn, so an old layout never breaks a new
 * build and a new block never needs a change here.
 */

export const HOME_SIZES = ["third", "half", "full"];

const BLOCK_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MOST_BLOCKS = 24;

/**
 * @param {string | null | undefined} raw
 * @returns {Record<string, any>}
 */
function parsePreferences(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * A layout with only what makes sense kept: each block once, a known
 * width, a sensible number of them. Null when there isn't one, which
 * means "never arranged": the app shows its own starting layout.
 * (An empty list is a layout too: someone removed every block.)
 *
 * @param {unknown} raw
 * @returns {{ id: string, size: string }[] | null}
 */
export function cleanHomeLayout(raw) {
  if (!Array.isArray(raw)) return null;
  /** @type {{ id: string, size: string }[]} */
  const blocks = [];
  const seen = new Set();
  for (const entry of raw) {
    if (blocks.length >= MOST_BLOCKS) break;
    const id = entry && typeof entry === "object" ? /** @type {any} */ (entry).id : null;
    if (typeof id !== "string" || !BLOCK_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const size = /** @type {any} */ (entry).size;
    blocks.push({ id, size: HOME_SIZES.includes(size) ? size : "third" });
  }
  return blocks;
}

/**
 * @param {any} db
 * @param {{ appId: string, userId: string }} who
 */
export function getHomeLayout(db, { appId, userId }) {
  const row = db.prepare(`SELECT preferences_json FROM users WHERE app_id = ? AND id = ?`).get(appId, userId);
  return cleanHomeLayout(parsePreferences(row?.preferences_json).homeLayout);
}

/**
 * Replace the layout. Null (or anything that isn't a list) forgets it,
 * which puts the starting layout back.
 * @param {any} db
 * @param {{ appId: string, userId: string, layout: unknown }} input
 */
export function setHomeLayout(db, { appId, userId, layout }) {
  const row = db.prepare(`SELECT preferences_json FROM users WHERE app_id = ? AND id = ?`).get(appId, userId);
  const preferences = parsePreferences(row?.preferences_json);
  const cleaned = cleanHomeLayout(layout);
  if (cleaned) preferences.homeLayout = cleaned;
  else delete preferences.homeLayout;
  db.prepare(`UPDATE users SET preferences_json = ?, updated_date = ? WHERE app_id = ? AND id = ?`).run(
    JSON.stringify(preferences),
    new Date().toISOString(),
    appId,
    userId
  );
  return cleaned;
}
