// @ts-check
/**
 * @file One-time rewrite of the retired pale-yellow highlight.
 *
 * `#fef08a` used to be offered in the rich-text highlight picker. The
 * note↔task link now paints a reserved yellow (--brand-yellow) that means
 * "a task exists for this span", so a hand-made yellow would be
 * indistinguishable from a real task link. The colour left the picker and
 * the spans already written with it move to the purple that replaced it.
 *
 * Pure so it can be tested without a database. Returns null when nothing
 * changed, which is what lets the caller skip the write entirely — that's
 * what makes the migration idempotent and cheap on every later boot.
 */

export const RETIRED_HIGHLIGHT = "#fef08a";
export const REPLACEMENT_HIGHLIGHT = "#e9d5ff";

/**
 * Rewrite retired highlight marks inside a stored ProseMirror JSON string.
 *
 * @param {string | null | undefined} raw  the stored content_json / description_json
 * @returns {string | null}  the rewritten JSON, or null to leave the row alone
 */
export function migrateHighlightJson(raw) {
  if (typeof raw !== "string" || !raw) return null;
  // Cheap reject before paying for a parse — the vast majority of rows
  // never mentioned this colour. Case-insensitive to match the per-mark
  // comparison below; a case-sensitive fast path would skip rows the
  // rewrite would otherwise have caught.
  if (!raw.toLowerCase().includes(RETIRED_HIGHLIGHT)) return null;

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    // Malformed content is left exactly as-is rather than risking a
    // rewrite we can't reason about.
    return null;
  }
  if (!doc || typeof doc !== "object") return null;

  const changed = rewrite(doc);
  return changed ? JSON.stringify(doc) : null;
}

/**
 * Depth-first mutate. Only `highlight` marks carrying exactly the retired
 * colour are touched — other marks, other colours, and every piece of
 * text are left byte-identical.
 *
 * @param {any} node
 * @returns {boolean} whether anything changed
 */
function rewrite(node) {
  let changed = false;
  if (Array.isArray(node)) {
    for (const child of node) if (rewrite(child)) changed = true;
    return changed;
  }
  if (!node || typeof node !== "object") return false;

  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (
        mark &&
        mark.type === "highlight" &&
        mark.attrs &&
        typeof mark.attrs.color === "string" &&
        mark.attrs.color.toLowerCase() === RETIRED_HIGHLIGHT
      ) {
        mark.attrs.color = REPLACEMENT_HIGHLIGHT;
        changed = true;
      }
    }
  }
  if (Array.isArray(node.content)) {
    if (rewrite(node.content)) changed = true;
  }
  return changed;
}
