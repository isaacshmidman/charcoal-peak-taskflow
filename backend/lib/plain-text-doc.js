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

/**
 * A rich-text document's plain text, the way the editors save it
 * (TipTap's getText(): each block's text, blocks separated by a blank
 * line, hard breaks as line breaks), trimmed.
 *
 * @param {any} doc
 * @returns {string}
 */
export function docToText(doc) {
  /** @type {string[]} */
  const blocks = [];
  /** @param {any} node */
  const inlineText = (node) =>
    (node.content || [])
      .map((/** @type {any} */ child) => (child.type === "text" ? child.text || "" : child.type === "hardBreak" ? "\n" : inlineText(child)))
      .join("");
  /** @param {any} node */
  const walk = (node) => {
    const children = node?.content || [];
    const isTextblock = children.length === 0 || children.some((/** @type {any} */ c) => c.type === "text" || c.type === "hardBreak");
    if (node !== doc && isTextblock) {
      blocks.push(inlineText(node));
      return;
    }
    for (const child of children) walk(child);
  };
  walk(doc);
  return blocks.join("\n\n").trim();
}

/**
 * A stored rich-text body as a document: its saved JSON, or its plain
 * text laid out as the editor would open it (one paragraph per line).
 *
 * @param {unknown} json  the *_json column
 * @param {unknown} text  the plain-text mirror
 * @returns {{ type: "doc", content: any[] }}
 */
export function storedDoc(json, text) {
  if (typeof json === "string" && json.trim()) {
    try {
      const parsed = JSON.parse(json);
      if (parsed && parsed.type === "doc") return { ...parsed, content: Array.isArray(parsed.content) ? parsed.content : [] };
    } catch {
      // Fall through to the plain text.
    }
  }
  return typeof text === "string" && text ? plainTextToDoc(text) : { type: "doc", content: [] };
}

