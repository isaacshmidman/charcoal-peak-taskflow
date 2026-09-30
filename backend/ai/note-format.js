// @ts-check
/**
 * @file Formatting a note's document the way the editor's toolbar does
 * (src/components/tasks/richtext/Toolbar.jsx), for AI apps that name the
 * text instead of selecting it. Pure functions over the editor's JSON.
 *
 * Text is found within one block (a paragraph, heading, list item's line…)
 * and may cross formatting: "call the plumber" is found even when "the"
 * is bold. Marks are then set on exactly that span; block changes apply to
 * the block(s) holding it.
 *
 * Same rules as the toolbar:
 * - Highlights come from its five colours; yellow is reserved for links
 *   to tasks and never offered.
 * - Clearing formatting never removes a link to a task (that would cut
 *   the text loose from its task), and resets headings and code blocks to
 *   body text, out of any quote. Lists stay.
 * - Links are http, https or mailto only.
 */
import { ToolError } from "./args.js";

export const TEXT_COLORS = /** @type {Record<string, string>} */ ({
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  pink: "#ec4899",
  slate: "#64748b",
});
export const HIGHLIGHTS = /** @type {Record<string, string>} */ ({
  purple: "#e9d5ff",
  green: "#bbf7d0",
  blue: "#bfdbfe",
  pink: "#fbcfe8",
  orange: "#fed7aa",
});
export const FONTS = /** @type {Record<string, string>} */ ({
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  georgia: "Georgia, serif",
  "times new roman": '"Times New Roman", Times, serif',
  "courier new": '"Courier New", Courier, monospace',
  verdana: "Verdana, Geneva, sans-serif",
  "trebuchet ms": '"Trebuchet MS", Tahoma, sans-serif',
  garamond: 'Garamond, "Times New Roman", serif',
  "system ui": "system-ui, sans-serif",
  monospace: "ui-monospace, SFMono-Regular, monospace",
});
/** The toolbar's "Clear formatting": never taskLink. */
const CLEARABLE = ["bold", "italic", "underline", "strike", "code", "textStyle", "highlight"];
const SIMPLE_MARKS = ["bold", "italic", "underline", "strike", "code"];
const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);
const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * @typedef {{ node: any, index: number }} Step        a node and its place in its parent
 * @typedef {{ block: any, chain: Step[], start: number, end: number }} Hit
 */

/**
 * Every textblock with the chain of nodes above it (doc first).
 * @param {any} doc
 * @returns {{ block: any, chain: Step[] }[]}
 */
function textblocks(doc) {
  /** @type {{ block: any, chain: Step[] }[]} */
  const out = [];
  /** @param {any} node @param {Step[]} chain */
  const walk = (node, chain) => {
    (node.content || []).forEach((/** @type {any} */ child, /** @type {number} */ index) => {
      const next = [...chain, { node, index }];
      if (TEXTBLOCKS.has(child.type)) out.push({ block: child, chain: next });
      else if (Array.isArray(child.content)) walk(child, next);
    });
  };
  walk(doc, []);
  return out;
}

/** @param {any} node */
const inlineLength = (node) => (node.type === "text" ? (node.text || "").length : node.type === "hardBreak" ? 1 : 0);

/** @param {any} block */
const blockText = (block) => (block.content || []).map((/** @type {any} */ n) => (n.type === "text" ? n.text || "" : n.type === "hardBreak" ? "\n" : "")).join("");

/**
 * Where `needle` sits, within single blocks.
 * @param {any} doc
 * @param {string} needle
 * @param {{ all?: boolean }} [opts]
 * @returns {Hit[]}
 */
export function findText(doc, needle, { all = false } = {}) {
  if (!needle) return [];
  /** @type {Hit[]} */
  const hits = [];
  for (const { block, chain } of textblocks(doc)) {
    const text = blockText(block);
    let from = text.indexOf(needle);
    while (from !== -1) {
      hits.push({ block, chain, start: from, end: from + needle.length });
      if (!all) return hits;
      from = text.indexOf(needle, from + needle.length);
    }
  }
  return hits;
}

/**
 * Make `offset` fall between two inline nodes, splitting a text node if
 * it's inside one.
 * @param {any} block
 * @param {number} offset
 */
function splitAt(block, offset) {
  let pos = 0;
  const content = block.content || [];
  for (let i = 0; i < content.length; i += 1) {
    const node = content[i];
    const len = inlineLength(node);
    if (offset > pos && offset < pos + len && node.type === "text") {
      const cut = offset - pos;
      const left = { ...node, text: node.text.slice(0, cut) };
      const right = { ...node, text: node.text.slice(cut) };
      content.splice(i, 1, left, right);
      return;
    }
    pos += len;
  }
}

/**
 * The text nodes exactly covering [start, end) of a block.
 * @param {any} block
 * @param {number} start
 * @param {number} end
 */
function nodesIn(block, start, end) {
  splitAt(block, start);
  splitAt(block, end);
  /** @type {any[]} */
  const out = [];
  let pos = 0;
  for (const node of block.content || []) {
    const len = inlineLength(node);
    if (node.type === "text" && pos >= start && pos + len <= end) out.push(node);
    pos += len;
  }
  return out;
}

/**
 * Adjacent text nodes with identical marks back into one (the editor
 * does the same when it loads).
 * @param {any} block
 */
function mergeRuns(block) {
  /** @type {any[]} */
  const merged = [];
  for (const node of block.content || []) {
    const last = merged[merged.length - 1];
    if (last && last.type === "text" && node.type === "text" && JSON.stringify(last.marks || []) === JSON.stringify(node.marks || [])) {
      merged[merged.length - 1] = { ...last, text: last.text + node.text };
    } else {
      merged.push(node);
    }
  }
  block.content = merged;
}

/**
 * The mark changes a format request means, checked against the toolbar's
 * choices. Returns functions that change one text node's marks.
 * @param {string[]} add
 * @param {string[]} remove
 * @param {(href: string) => boolean} isAllowedLink
 */
export function markChanges(add = [], remove = [], isAllowedLink) {
  /** @type {((marks: any[]) => any[])[]} */
  const steps = [];
  /** @param {any[]} marks @param {string} type */
  const without = (marks, type) => marks.filter((m) => m.type !== type);
  /** @param {any[]} marks @param {string} key @param {string | null} value */
  const withStyle = (marks, key, value) => {
    const current = marks.find((m) => m.type === "textStyle");
    const attrs = { color: null, fontFamily: null, ...(current?.attrs || {}), [key]: value };
    const rest = without(marks, "textStyle");
    return attrs.color || attrs.fontFamily ? [...rest, { type: "textStyle", attrs }] : rest;
  };

  for (const raw of remove) {
    const what = raw.trim().toLowerCase();
    if (what === "all") steps.push((marks) => marks.filter((m) => !CLEARABLE.includes(m.type)));
    else if (SIMPLE_MARKS.includes(what) || what === "highlight" || what === "link") steps.push((marks) => without(marks, what));
    else if (what === "color") steps.push((marks) => withStyle(marks, "color", null));
    else if (what === "font") steps.push((marks) => withStyle(marks, "fontFamily", null));
    else throw new ToolError(`Can't remove "${raw}". Remove bold, italic, underline, strike, code, highlight, color, font, link, or all.`);
  }
  for (const raw of add) {
    const [kindRaw, ...restParts] = raw.split(":");
    const kind = kindRaw.trim().toLowerCase();
    const value = restParts.join(":").trim();
    if (SIMPLE_MARKS.includes(kind) && !value) {
      // Code, like the editor's, stands alone: no other formatting inside it.
      if (kind === "code") steps.push((marks) => [...marks.filter((m) => m.type === "taskLink" || m.type === "link"), { type: "code" }]);
      else steps.push((marks) => (marks.some((m) => m.type === kind) ? marks : [...marks, { type: kind }]));
    } else if (kind === "highlight") {
      const name = value.toLowerCase() || "purple";
      if (name === "yellow") throw new ToolError("Yellow highlighting is reserved for text linked to a task. Use make_task_from_note to link text to a task.");
      const hex = HIGHLIGHTS[name];
      if (!hex) throw new ToolError(`Highlight colours are ${Object.keys(HIGHLIGHTS).join(", ")}.`);
      steps.push((marks) => [...without(marks, "highlight"), { type: "highlight", attrs: { color: hex } }]);
    } else if (kind === "color") {
      const hex = TEXT_COLORS[value.toLowerCase()];
      if (!hex) throw new ToolError(`Text colours are ${Object.keys(TEXT_COLORS).join(", ")}.`);
      steps.push((marks) => withStyle(marks, "color", hex));
    } else if (kind === "font") {
      const stack = FONTS[value.toLowerCase()];
      if (!stack) throw new ToolError(`Fonts are Arial, Helvetica, Georgia, Times New Roman, Courier New, Verdana, Trebuchet MS, Garamond, System UI and Monospace.`);
      steps.push((marks) => withStyle(marks, "fontFamily", stack));
    } else if (kind === "link") {
      if (!isAllowedLink(value)) throw new ToolError("Links must be full web or email addresses (https://…, http://…, mailto:…).");
      steps.push((marks) => [...without(marks, "link"), { type: "link", attrs: { href: value } }]);
    } else {
      throw new ToolError(
        `Can't add "${raw}". Add bold, italic, underline, strike, code, highlight:<colour>, color:<colour>, font:<name> or link:<address>.`
      );
    }
  }
  return steps;
}

/**
 * Apply mark changes to the span of each hit.
 * @param {Hit[]} hits
 * @param {((marks: any[]) => any[])[]} steps
 */
export function applyMarks(hits, steps) {
  if (!steps.length) return;
  // Hits come in document order; right to left keeps earlier offsets valid.
  const ordered = [...hits].reverse();
  const touched = new Set();
  for (const hit of ordered) {
    if (hit.block.type === "codeBlock") throw new ToolError("Text in a code block can't be formatted.");
    for (const node of nodesIn(hit.block, hit.start, hit.end)) {
      const marks = steps.reduce((acc, step) => step(acc), node.marks || []);
      if (marks.length) node.marks = marks;
      else delete node.marks;
    }
    touched.add(hit.block);
  }
  for (const block of touched) mergeRuns(block);
}

/**
 * @param {Hit} hit
 * @returns {Step | null}  the innermost list item (listItem / taskItem) holding the hit
 */
function listItemOf(hit) {
  for (let i = hit.chain.length - 1; i >= 0; i -= 1) {
    const { node, index } = hit.chain[i];
    const child = node.content[index];
    if (child.type === "listItem" || child.type === "taskItem") return { node, index };
  }
  return null;
}

/**
 * Change a textblock into another kind in place.
 * @param {Hit} hit
 * @param {string} style  paragraph | heading1..3 | code_block
 */
function restyleBlock(hit, style) {
  const { block } = hit;
  const plainContent = () => {
    const text = blockText(block);
    return text ? [{ type: "text", text }] : undefined;
  };
  const keepIndent = block.attrs?.indent ? { indent: block.attrs.indent } : {};
  if (style === "code_block") {
    const content = plainContent();
    block.type = "codeBlock";
    block.attrs = { language: null };
    if (content) block.content = content;
    else delete block.content;
    return;
  }
  if (block.type === "codeBlock") {
    // Out of a code block: its lines become lines of plain text.
    const text = blockText(block);
    block.content = text.split("\n").flatMap((line, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]);
    if (!block.content.length) delete block.content;
  }
  if (style === "paragraph") {
    block.type = "paragraph";
    block.attrs = keepIndent;
    if (!Object.keys(block.attrs).length) delete block.attrs;
  } else {
    block.type = "heading";
    block.attrs = { level: Number(style.slice(-1)), ...keepIndent };
  }
}

/**
 * Replace the node at `step` in its parent with `nodes`.
 * @param {Step} step
 * @param {any[]} nodes
 */
const replaceAt = (step, nodes) => step.node.content.splice(step.index, 1, ...nodes);

/**
 * Take the top-level block holding the hit out of a quote, splitting the
 * quote around it.
 * @param {Hit} hit
 */
function liftOutOfQuote(hit) {
  const i = hit.chain.findIndex((s) => s.node.content[s.index]?.type === "blockquote");
  if (i === -1) return;
  const quoteStep = hit.chain[i];
  const quote = quoteStep.node.content[quoteStep.index];
  const inner = hit.chain[i + 1];
  const before = quote.content.slice(0, inner.index);
  const moved = quote.content[inner.index];
  const after = quote.content.slice(inner.index + 1);
  replaceAt(quoteStep, [
    ...(before.length ? [{ ...quote, content: before }] : []),
    moved,
    ...(after.length ? [{ ...quote, content: after }] : []),
  ]);
}

/**
 * Put a top-level block into a quote (joining a quote right before it).
 * @param {Hit} hit
 */
function wrapInQuote(hit) {
  if (hit.chain.some((s) => s.node.content[s.index]?.type === "blockquote")) return;
  // The document's child holding the text (the block itself, outside lists).
  const top = hit.chain[0];
  const block = top.node.content[top.index];
  const prev = top.node.content[top.index - 1];
  if (prev?.type === "blockquote") {
    prev.content.push(block);
    top.node.content.splice(top.index, 1);
  } else {
    replaceAt(top, [{ type: "blockquote", content: [block] }]);
  }
}

const LIST_KINDS = /** @type {Record<string, { type: string, style?: string }>} */ ({
  bullet: { type: "bulletList", style: "disc" },
  circle: { type: "bulletList", style: "circle" },
  dash: { type: "bulletList", style: "dash" },
  numbers: { type: "orderedList", style: "decimal" },
  letters: { type: "orderedList", style: "lower-alpha" },
  roman: { type: "orderedList", style: "upper-roman" },
  checklist: { type: "taskList" },
});

/**
 * @param {any} list
 * @param {{ type: string, style?: string }} kind
 */
function convertList(list, kind) {
  const wasTask = list.type === "taskList";
  list.type = kind.type;
  list.attrs = kind.type === "taskList" ? undefined : { ...(kind.type === "orderedList" ? { start: list.attrs?.start || 1 } : {}), listStyleType: kind.style };
  if (!list.attrs) delete list.attrs;
  for (const item of list.content || []) {
    if (kind.type === "taskList" && !wasTask) {
      item.type = "taskItem";
      item.attrs = { checked: false };
    } else if (kind.type !== "taskList" && wasTask) {
      item.type = "listItem";
      delete item.attrs;
    }
  }
}

/**
 * Put the block holding the hit into a list, change the list it's in, or
 * (kind "none") take its line out of the list.
 * @param {Hit} hit
 * @param {string} kindName
 */
function setList(hit, kindName) {
  const itemStep = listItemOf(hit);
  if (kindName === "none") {
    if (!itemStep) return;
    const item = itemStep.node.content[itemStep.index];
    if ((item.content || []).some((/** @type {any} */ c) => LIST_TYPES.has(c.type))) {
      throw new ToolError("That line has a list nested under it; take those lines out first.");
    }
    // Split the list around the item, and put the item's lines in its place.
    const listIndexInChain = hit.chain.findIndex((s) => s.node === itemStep.node);
    const listStep = hit.chain[listIndexInChain - 1];
    const list = listStep.node.content[listStep.index];
    const before = list.content.slice(0, itemStep.index);
    const after = list.content.slice(itemStep.index + 1);
    replaceAt(listStep, [
      ...(before.length ? [{ ...list, content: before }] : []),
      ...item.content,
      ...(after.length ? [{ ...list, content: after, ...(list.type === "orderedList" ? { attrs: { ...list.attrs, start: (list.attrs?.start || 1) + before.length + 1 } } : {}) }] : []),
    ]);
    return;
  }
  const kind = LIST_KINDS[kindName];
  if (itemStep) {
    convertList(itemStep.node, kind);
    return;
  }
  if (hit.block.type === "codeBlock") throw new ToolError("A code block can't go in a list.");
  // A block not in a list: wrap it, joining a matching list right before it.
  const blockStep = hit.chain[hit.chain.length - 1];
  const itemType = kind.type === "taskList" ? "taskItem" : "listItem";
  const item = { type: itemType, ...(itemType === "taskItem" ? { attrs: { checked: false } } : {}), content: [hit.block] };
  /** @param {any} node */
  const sameKind = (node) =>
    node &&
    node.type === kind.type &&
    (kind.type === "taskList" || node.attrs?.listStyleType === kind.style || (!node.attrs?.listStyleType && (kind.style === "disc" || kind.style === "decimal")));
  const siblings = blockStep.node.content;
  const prev = siblings[blockStep.index - 1];
  const next = siblings[blockStep.index + 1];
  // Join a matching list on either side (both, if it sits between two),
  // as toggling a list in the editor does.
  if (sameKind(prev)) {
    prev.content.push(item);
    if (sameKind(next)) {
      prev.content.push(...next.content);
      siblings.splice(blockStep.index, 2);
    } else {
      siblings.splice(blockStep.index, 1);
    }
  } else if (sameKind(next)) {
    next.content.unshift(item);
    siblings.splice(blockStep.index, 1);
  } else {
    const list = { type: kind.type, content: [item] };
    if (kind.type !== "taskList") list.attrs = { ...(kind.type === "orderedList" ? { start: 1 } : {}), listStyleType: kind.style };
    replaceAt(blockStep, [list]);
  }
}

/**
 * Block-level changes for every block holding a hit: style, list, quote,
 * checklist state, indent. Blocks are handled from the last to the first,
 * so earlier positions stay valid.
 * @param {any} doc
 * @param {string} needle
 * @param {{ all: boolean, block?: string, list?: string, checked?: boolean, indent?: number }} change
 */
export function applyBlockChanges(doc, needle, change) {
  // One pass per kind of change, re-finding the text each time, since a
  // change can move blocks.
  const passes = [];
  if (change.block) passes.push("block");
  if (change.list) passes.push("list");
  if (change.checked != null) passes.push("checked");
  if (change.indent != null) passes.push("indent");
  for (const pass of passes) {
    const hits = findText(doc, needle, { all: change.all });
    const seen = new Set();
    for (const hit of hits.reverse()) {
      if (seen.has(hit.block)) continue;
      seen.add(hit.block);
      if (pass === "block") {
        const style = /** @type {string} */ (change.block);
        if (style === "quote") {
          restyleBlock(hit, "paragraph");
          if (!listItemOf(hit)) wrapInQuote(hit);
        } else {
          restyleBlock(hit, style);
          if (style === "paragraph") liftOutOfQuote(hit);
        }
      } else if (pass === "list") {
        setList(hit, /** @type {string} */ (change.list));
      } else if (pass === "checked") {
        const itemStep = listItemOf(hit);
        const item = itemStep?.node.content[itemStep.index];
        if (!item || item.type !== "taskItem") throw new ToolError(`"${needle}" isn't on a checklist line.`);
        item.attrs = { ...(item.attrs || {}), checked: Boolean(change.checked) };
      } else {
        if (listItemOf(hit)) throw new ToolError("Lines in a list are indented by nesting them in the list, not with indent.");
        if (hit.block.type === "codeBlock") throw new ToolError("A code block can't be indented.");
        const indent = /** @type {number} */ (change.indent);
        hit.block.attrs = { ...(hit.block.attrs || {}), indent };
        if (!indent) delete hit.block.attrs.indent;
        if (!Object.keys(hit.block.attrs).length) delete hit.block.attrs;
      }
    }
  }
}

/**
 * Link the first occurrence of `needle` to a task (what the Notes page's
 * Make task does to the selection). Refuses text already linked.
 * @param {any} doc
 * @param {string} needle
 * @param {string} taskId
 */
export function linkTextToTask(doc, needle, taskId) {
  const [hit] = findText(doc, needle);
  if (!hit) return false;
  const nodes = nodesIn(hit.block, hit.start, hit.end);
  const already = nodes.find((n) => (n.marks || []).some((/** @type {any} */ m) => m.type === "taskLink"));
  if (already) {
    const id = already.marks.find((/** @type {any} */ m) => m.type === "taskLink").attrs?.taskId;
    throw new ToolError(`That text is already linked to a task (id ${id}).`);
  }
  for (const node of nodes) node.marks = [...(node.marks || []), { type: "taskLink", attrs: { taskId } }];
  mergeRuns(hit.block);
  return true;
}
