// @ts-check
/**
 * @file Decides whether pasted PLAIN text should be read as markdown.
 *
 * The risk here is over-eagerness, not under-eagerness: turning ordinary
 * prose into formatting mangles what someone pasted. So this only says
 * yes when the text carries a structural markdown marker that is
 * unlikely to appear by accident — a heading, a list, a blockquote, a
 * fence, a rule, or paired emphasis/code delimiters.
 *
 * Pure and separate from the editor so the judgement can be tested.
 */

/** Markers that only really occur in markdown, anchored to line starts. */
const BLOCK_PATTERNS = [
  /^\s{0,3}#{1,6}\s+\S/m,        // # heading
  /^\s{0,3}[-*+]\s+\S/m,         // - bullet
  /^\s{0,3}\d+[.)]\s+\S/m,       // 1. ordered
  /^\s{0,3}>\s+\S/m,             // > quote
  /^\s{0,3}```/m,                // ``` fence
  /^\s{0,3}(?:[-*_]\s*){3,}$/m,  // --- rule
  /^\s{0,3}\[[ xX]\]\s+\S/m,     // [ ] task item
];

/** Paired inline delimiters, which need both halves on one line. */
const INLINE_PATTERNS = [
  /\*\*[^\s*][^*]*\*\*/,         // **bold**
  /__[^\s_][^_]*__/,             // __bold__
  /(^|[^*])\*[^\s*][^*]*\*([^*]|$)/, // *italic*
  /~~[^\s~][^~]*~~/,             // ~~strike~~
  /`[^`\n]+`/,                   // `code`
  /\[[^\]\n]+\]\([^)\s]+\)/,     // [text](url)
];

/**
 * @param {string} text
 * @returns {boolean} true when the text is worth parsing as markdown
 */
export function looksLikeMarkdown(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  // A single short word with no markers is never worth reinterpreting.
  if (BLOCK_PATTERNS.some((re) => re.test(trimmed))) return true;
  return INLINE_PATTERNS.some((re) => re.test(trimmed));
}
