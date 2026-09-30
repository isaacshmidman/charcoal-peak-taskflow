// @ts-check
/**
 * @file Markdown ⇄ the editor's rich-text document (ProseMirror JSON, the
 * schema in src/components/tasks/richtext/extensions.js). How AI apps read
 * and write formatted notes: they speak Markdown natively.
 *
 * What maps across: headings (1–3, the levels the toolbar offers), bold,
 * italic, strikethrough, code, links (http, https and mailto only),
 * links to tasks (written as [text](zephyrly-task:<id>)), bullet,
 * numbered and checklist items (nested), quotes, code blocks, rules,
 * line breaks. Colours, highlights, fonts, underline and indents have no
 * Markdown; they are kept when a note is edited in place, and set with
 * the AI tools' formatting tool.
 *
 * Nothing written in Markdown is ever read as HTML: raw HTML stays as the
 * characters typed.
 */
import { lexer } from "marked";

export const TASK_LINK_SCHEME = "zephyrly-task:";

/**
 * The app's link rule (richtext/links.js isAllowedLink): absolute http,
 * https or mailto.
 * @param {string} href
 */
function isAllowedHref(href) {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * @typedef {{ type: string, attrs?: Record<string, any> }} Mark
 * @typedef {{ taskLinkAllowed?: (taskId: string) => boolean }} ParseOptions
 */

/**
 * @param {any[]} tokens  marked inline tokens
 * @param {Mark[]} marks
 * @param {ParseOptions} opts
 * @returns {any[]}
 */
function inline(tokens, marks, opts) {
  /** @type {any[]} */
  const out = [];
  /** @param {string} value @param {Mark[]} m */
  const text = (value, m) => {
    // A line break inside a paragraph is kept as one: written by an AI app,
    // a new line nearly always means a new line.
    value.split("\n").forEach((part, i) => {
      if (i > 0) out.push({ type: "hardBreak" });
      if (part) out.push(m.length ? { type: "text", text: part, marks: m } : { type: "text", text: part });
    });
  };
  for (const token of tokens || []) {
    switch (token.type) {
      case "strong":
        out.push(...inline(token.tokens, [...marks, { type: "bold" }], opts));
        break;
      case "em":
        out.push(...inline(token.tokens, [...marks, { type: "italic" }], opts));
        break;
      case "del":
        out.push(...inline(token.tokens, [...marks, { type: "strike" }], opts));
        break;
      case "codespan":
        text(token.text, [...marks, { type: "code" }]);
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "link": {
        const href = String(token.href || "");
        if (href.startsWith(TASK_LINK_SCHEME)) {
          const taskId = href.slice(TASK_LINK_SCHEME.length);
          const ok = taskId && (!opts.taskLinkAllowed || opts.taskLinkAllowed(taskId));
          out.push(...inline(token.tokens, ok ? [...marks, { type: "taskLink", attrs: { taskId } }] : marks, opts));
        } else if (isAllowedHref(href)) {
          out.push(...inline(token.tokens, [...marks, { type: "link", attrs: { href } }], opts));
        } else {
          out.push(...inline(token.tokens, marks, opts));
        }
        break;
      }
      case "image":
        text(token.text || "", marks);
        break;
      case "checkbox":
        // A checklist item's box (in a loose list it sits inline); the item
        // itself carries the checked state.
        break;
      case "text":
        if (token.tokens) out.push(...inline(token.tokens, marks, opts));
        else text(token.text, marks);
        break;
      default:
        // escape, html (as the characters typed), anything unknown.
        text(token.text ?? token.raw ?? "", marks);
    }
  }
  return out;
}

/**
 * @param {any[]} content
 */
const paragraph = (content) => (content.length ? { type: "paragraph", content } : { type: "paragraph" });

/**
 * @param {any[]} tokens  marked block tokens
 * @param {ParseOptions} opts
 * @returns {any[]}
 */
function blocks(tokens, opts) {
  /** @type {any[]} */
  const out = [];
  for (const token of tokens || []) {
    switch (token.type) {
      case "space":
      case "checkbox":
        break;
      case "heading":
        out.push({ type: "heading", attrs: { level: Math.min(3, token.depth) }, content: inline(token.tokens, [], opts) });
        break;
      case "paragraph":
      case "text":
        out.push(paragraph(token.tokens ? inline(token.tokens, [], opts) : inline([{ type: "text", text: token.text }], [], opts)));
        break;
      case "blockquote":
        out.push({ type: "blockquote", content: nonEmpty(blocks(token.tokens, opts)) });
        break;
      case "code":
        out.push({ type: "codeBlock", attrs: { language: token.lang || null }, ...(token.text ? { content: [{ type: "text", text: token.text }] } : {}) });
        break;
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "list": {
        // Markdown runs "- a" and "- [ ] b" into one list; the editor has
        // plain lists and checklists, so split it where the kind changes.
        let start = Number(token.start) || 1;
        /** @type {any[][]} */
        const runs = [];
        for (const item of token.items) {
          const last = runs[runs.length - 1];
          if (last && Boolean(last[0].task) === Boolean(item.task)) last.push(item);
          else runs.push([item]);
        }
        for (const run of runs) {
          if (run[0].task) {
            out.push({
              type: "taskList",
              content: run.map((/** @type {any} */ item) => ({
                type: "taskItem",
                attrs: { checked: Boolean(item.checked) },
                content: nonEmpty(blocks(item.tokens, opts)),
              })),
            });
          } else {
            const items = run.map((/** @type {any} */ item) => ({ type: "listItem", content: nonEmpty(blocks(item.tokens, opts)) }));
            out.push(token.ordered ? { type: "orderedList", attrs: { start }, content: items } : { type: "bulletList", content: items });
          }
          start += run.length;
        }
        break;
      }
      default:
        // html blocks, tables and the rest: their text, as typed.
        if (token.raw || token.text) out.push(paragraph(inline([{ type: "text", text: String(token.raw ?? token.text).trim() }], [], opts)));
    }
  }
  return out;
}

/**
 * List items and quotes must hold at least one block.
 * @param {any[]} content
 */
const nonEmpty = (content) => (content.length ? content : [{ type: "paragraph" }]);

/**
 * Markdown → a rich-text document.
 * @param {string} markdown
 * @param {ParseOptions} [opts]
 * @returns {{ type: "doc", content: any[] }}
 */
export function markdownToDoc(markdown, opts = {}) {
  const content = blocks(lexer(String(markdown).replace(/\r\n?/g, "\n"), { gfm: true }), opts);
  return { type: "doc", content };
}

// ── Document → Markdown ────────────────────────────────────────────────

/**
 * Characters that would read as formatting if written back.
 * @param {string} text
 */
const escapeText = (text) => text.replace(/([\\`*[\]~])/g, "\\$1");

// Marks Markdown can write, outermost first. A link wraps its whole span.
const WRAPPING = ["bold", "italic", "strike"];
const OPEN = /** @type {Record<string, string>} */ ({ bold: "**", italic: "*", strike: "~~" });

/**
 * Inline content → Markdown. Marks open and close where they start and
 * stop, rather than around every run of text, so bold-then-bold-italic
 * reads "**the *plumber***" and survives being read back.
 * @param {any[]} nodes  inline content
 */
function inlineMarkdown(nodes) {
  let out = "";
  /** @type {string[]} */
  let open = [];
  /** @type {string | null} */
  let openLink = null;
  let linkText = "";
  /** @param {string[]} next */
  const moveTo = (next) => {
    // Close from the innermost down to the first mark that ends, then open.
    let keep = 0;
    while (keep < open.length && keep < next.length && open[keep] === next[keep]) keep += 1;
    for (let i = open.length - 1; i >= keep; i -= 1) linkText += OPEN[open[i]];
    for (let i = keep; i < next.length; i += 1) linkText += OPEN[next[i]];
    open = next;
  };
  const flushLink = () => {
    moveTo([]);
    out += openLink ? `[${linkText}](${openLink})` : linkText;
    linkText = "";
    openLink = null;
  };
  for (const node of nodes || []) {
    if (node.type === "hardBreak") {
      moveTo([]);
      linkText += "  \n";
      continue;
    }
    if (node.type !== "text") continue;
    const marks = node.marks || [];
    const has = (/** @type {string} */ type) => marks.find((/** @type {any} */ m) => m.type === type);
    const taskLink = has("taskLink");
    const link = has("link");
    const href = taskLink?.attrs?.taskId ? `${TASK_LINK_SCHEME}${taskLink.attrs.taskId}` : link?.attrs?.href || null;
    if (href !== openLink) {
      flushLink();
      openLink = href;
    }
    moveTo(WRAPPING.filter((type) => has(type)));
    linkText += has("code") ? `\`${node.text}\`` : escapeText(node.text || "");
  }
  flushLink();
  return out;
}

/**
 * @param {any} node
 * @param {string} indent
 * @returns {string[]}  lines
 */
function blockMarkdown(node, indent) {
  const children = node.content || [];
  switch (node.type) {
    case "heading":
      return [`${indent}${"#".repeat(node.attrs?.level || 1)} ${inlineMarkdown(children)}`];
    case "paragraph":
      return [`${indent}${inlineMarkdown(children)}`];
    case "blockquote":
      return children.flatMap((/** @type {any} */ c) => blockMarkdown(c, "")).map((/** @type {string} */ line) => `${indent}> ${line}`);
    case "codeBlock":
      return [`${indent}\`\`\`${node.attrs?.language || ""}`, ...children.map((/** @type {any} */ c) => c.text || "").join("").split("\n").map((l) => `${indent}${l}`), `${indent}\`\`\``];
    case "horizontalRule":
      return [`${indent}---`];
    case "bulletList":
    case "orderedList":
    case "taskList": {
      let n = Number(node.attrs?.start) || 1;
      // Straight after another list, a different marker, or Markdown would
      // read the two as one list.
      const bullet = node.afterList ? "*" : "-";
      const dot = node.afterList ? ")" : ".";
      return children.flatMap((/** @type {any} */ item) => {
        const marker =
          node.type === "taskList" ? `${bullet} [${item.attrs?.checked ? "x" : " "}] ` : node.type === "orderedList" ? `${n++}${dot} ` : `${bullet} `;
        const [first = { type: "paragraph" }, ...rest] = item.content || [];
        const head = blockMarkdown(first, "");
        const pad = `${indent}${" ".repeat(marker.length)}`;
        return [
          `${indent}${marker}${head[0] ?? ""}`,
          ...head.slice(1).map((l) => `${pad}${l}`),
          ...rest.flatMap((/** @type {any} */ c) => blockMarkdown(c, pad)),
        ];
      });
    }
    default:
      return children.length ? [`${indent}${inlineMarkdown(children)}`] : [];
  }
}

/**
 * A rich-text document → Markdown, as get_note shows a note. Blocks are
 * separated by a blank line; list items by single lines.
 * @param {any} doc
 */
export function docToMarkdown(doc) {
  const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
  const nodes = doc?.content || [];
  return nodes
    .map((/** @type {any} */ node, /** @type {number} */ i) => {
      const afterList = LISTS.has(node.type) && i > 0 && LISTS.has(nodes[i - 1].type);
      return blockMarkdown(afterList ? { ...node, afterList } : node, "").join("\n");
    })
    .join("\n\n")
    .trim();
}
