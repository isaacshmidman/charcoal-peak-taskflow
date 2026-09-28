// @ts-check
/**
 * @file Plain text → a rich-text (ProseMirror) document, and the word
 * count the editors' limits are measured in. Shared by the
 * app's editors (src/components/tasks/richtext/content.js re-exports it)
 * and the server, which stores text written by AI apps the same way the
 * editor would.
 */

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
 * Count words in a plaintext string (whitespace-delimited).
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  const t = (text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
