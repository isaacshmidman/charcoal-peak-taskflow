// @ts-check
/**
 * @file Comparators for the Recently Deleted page. Extracted from the page
 * so the two sections' semantics are testable and explicit — they differ:
 *
 * - Tasks: "Date" = the task's DUE date (compareDueDateTime), and the
 *   completion sorts read the was_completed snapshot flag.
 * - Notes: "Date" = the CREATED date (matching the Notes page's language),
 *   and completion sorts don't apply. Pinning is deliberately ignored —
 *   it's a live-notes concept, so the trash sorts purely by the panel.
 *
 * Both take a `priorityRank` lookup because trash records only snapshot a
 * priority_id; the live priority list supplies the ordering.
 */
import { compareDueDateTime } from "@/lib/sort-helpers";

/** First tag, untagged sinking last — the app-wide tag_az tie rule. */
export function compareFirstTag(a, b) {
  const ta = a.tags?.[0] || "";
  const tb = b.tags?.[0] || "";
  if (!ta && tb) return 1;
  if (ta && !tb) return -1;
  return ta.localeCompare(tb);
}

const deletedAt = (r) => new Date(r.deleted_at).getTime() || 0;

/**
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @param {string} sortValue
 * @param {(record: Record<string, any>) => number} rank  priority_id → order
 */
export function compareDeletedTask(a, b, sortValue, rank) {
  switch (sortValue) {
    case "deleted_desc": return deletedAt(b) - deletedAt(a);
    case "deleted_asc": return deletedAt(a) - deletedAt(b);
    case "completed_first": return (a.was_completed ? 0 : 1) - (b.was_completed ? 0 : 1);
    case "uncompleted_first": return (a.was_completed ? 1 : 0) - (b.was_completed ? 1 : 0);
    case "date_asc": return compareDueDateTime(a, b, "asc");
    case "date_desc": return compareDueDateTime(a, b, "desc");
    case "priority_asc": return rank(a) - rank(b);
    case "priority_desc": return rank(b) - rank(a);
    case "tag_az": return compareFirstTag(a, b);
    default: return 0;
  }
}

/**
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 * @param {string} sortValue
 * @param {(record: Record<string, any>) => number} rank
 */
export function compareDeletedNote(a, b, sortValue, rank) {
  switch (sortValue) {
    case "deleted_desc": return deletedAt(b) - deletedAt(a);
    case "deleted_asc": return deletedAt(a) - deletedAt(b);
    // "Date" means CREATED date for notes (the Notes page's meaning).
    case "date_asc": return String(a.created_date || "").localeCompare(String(b.created_date || ""));
    case "date_desc": return String(b.created_date || "").localeCompare(String(a.created_date || ""));
    case "priority_asc": return rank(a) - rank(b);
    case "priority_desc": return rank(b) - rank(a);
    case "tag_az": return compareFirstTag(a, b);
    // completed_first / uncompleted_first / anything else: not applicable.
    default: return 0;
  }
}

/**
 * Run a record list through the multi-sort list, falling back to
 * newest-deleted-first so rows never shuffle when no sort applies.
 * @param {Array<Record<string, any>>} records
 * @param {string[]} sorts
 * @param {(a: any, b: any, sortValue: string, rank: any) => number} comparator
 * @param {(record: Record<string, any>) => number} rank
 */
export function sortTrash(records, sorts, comparator, rank) {
  return [...records].sort((a, b) => {
    for (const sortValue of sorts) {
      const result = comparator(a, b, sortValue, rank);
      if (result !== 0) return result;
    }
    return deletedAt(b) - deletedAt(a);
  });
}
