// @ts-check
/**
 * @file Pure helpers for the rich description editor's content I/O —
 * kept out of the React component so they can be unit-tested without a
 * DOM/editor instance.
 */

export const WORD_LIMIT = 500;

/** Tags that mark a stored description as HTML rather than plain text. */
const HTML_TAG_RE = /<\/?(p|br|div|span|b|strong|i|em|u|s|a|ul|ol|li|h[1-6]|blockquote|code|pre)\b[^>]*>/i;

/**
 * Plain text → a ProseMirror doc, one paragraph per line (blank lines kept
 * as empty paragraphs). Built as JSON, so nothing in the text is ever
 * interpreted as markup.
 *
 * @param {string} text
 * @returns {{ type: "doc", content: Array<Record<string, any>> }}
 */
export function plainTextToDoc(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      // ProseMirror forbids empty text nodes; a blank line is a bare paragraph.
      line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" }
    ),
  };
}

/**
 * Decide the initial TipTap `content` for the editor:
 *   - a non-empty stored ProseMirror JSON string → its parsed object
 *   - else an HTML plaintext mirror (calendar imports) → the HTML string,
 *     which the editor parses through its schema
 *   - else a plain-text mirror → a doc with one paragraph per line
 *   - else "" (empty document)
 *
 * The plain-text case must NOT be handed over as a raw string: TipTap
 * parses every string as HTML, so line breaks collapsed into one run-on
 * paragraph and a "<" was read as the start of a tag. That hit every
 * description with no rich JSON — Google/Apple imports, Base44 imports,
 * and subtask descriptions written before subtasks had a rich editor.
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
  if (!plain.trim()) return "";
  // Google Calendar stores descriptions as HTML. Parsing it through the
  // schema keeps the formatting the editor knows and drops the rest.
  if (HTML_TAG_RE.test(plain)) return plain;
  return plainTextToDoc(plain);
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
