// @ts-check
/**
 * @file Tiny fuzzy scorer for the command palette. Deliberately simple —
 * no dependency, no subsequence acrobatics: startsWith beats
 * word-boundary beats substring, and that's the whole theory. Returns 0
 * for no match; higher is better.
 */

/**
 * @param {string} query
 * @param {string} text
 * @returns {number}
 */
export function fuzzyScore(query, text) {
  const q = String(query || "").trim().toLowerCase();
  const t = String(text || "").toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  const boundary = t.split(/[\s\-_/]+/).some((word) => word.startsWith(q));
  if (boundary) return 70;
  if (t.includes(q)) return 50;
  return 0;
}

/**
 * Filter + rank a list by a query against `getText(item)`. Stable for
 * equal scores (keeps input order). Empty query returns [] — the
 * palette shows curated sections instead.
 * @template T
 * @param {string} query
 * @param {T[]} items
 * @param {(item: T) => string} getText
 * @param {number} [limit]
 * @returns {T[]}
 */
export function fuzzyFilter(query, items, getText, limit = 8) {
  const q = String(query || "").trim();
  if (!q) return [];
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(q, getText(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.item);
}
