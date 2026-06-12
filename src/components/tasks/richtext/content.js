// @ts-check
/**
 * @file Pure helpers for the rich description editor's content I/O —
 * kept out of the React component so they can be unit-tested without a
 * DOM/editor instance.
 */

export const WORD_LIMIT = 500;

/**
 * Decide the initial TipTap `content` for the editor:
 *   - a non-empty stored ProseMirror JSON string → its parsed object
 *   - else a non-empty plaintext mirror → the raw string (TipTap wraps
 *     it in a paragraph)
 *   - else "" (empty document)
 *
 * @param {string | null | undefined} valueJson
 * @param {string | null | undefined} plainFallback
 * @returns {object | string}
 */
export function initialContentFrom(valueJson, plainFallback) {
  const raw = typeof valueJson === "string" ? valueJson.trim() : "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // fall through to plaintext
    }
  }
  const plain = typeof plainFallback === "string" ? plainFallback : "";
  return plain || "";
}

/**
 * Normalize editor output for storage. An empty document must serialize
 * to BOTH fields empty ("") — never an empty-paragraph JSON blob — so
 * `task.description` stays falsy for "no description" checks (e.g. the
 * notification builder).
 *
 * @param {{ isEmpty: boolean, json: object, text: string }} args
 * @returns {{ json: string, text: string }}
 */
export function normalizeOutput({ isEmpty, json, text }) {
  const trimmed = (text || "").trim();
  if (isEmpty || !trimmed) {
    return { json: "", text: "" };
  }
  return { json: JSON.stringify(json), text: trimmed };
}

/**
 * Count words in a plaintext string (whitespace-delimited).
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
