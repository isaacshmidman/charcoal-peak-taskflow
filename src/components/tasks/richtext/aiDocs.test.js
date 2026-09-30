import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "./extensions";
import { markdownToDoc, isAllowedHref } from "../../../../backend/lib/markdown-doc.js";
import { applyBlockChanges, applyMarks, findText, linkTextToTask, markChanges } from "../../../../backend/ai/note-format.js";

/**
 * AI apps write notes as JSON the server builds (backend/lib/markdown-doc.js,
 * backend/ai/note-format.js). The real editor must open that JSON exactly
 * as written: nothing unknown dropped, nothing reshaped.
 */
let editor;
afterEach(() => editor?.destroy());

const roundTrip = (doc) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: buildEditorExtensions(), content: doc });
  return editor.getJSON();
};

/**
 * Drop what the editor fills in by itself, so only real differences show:
 * default attrs, its own order for marks, and the empty line it keeps at
 * the end of a document that ends in a list, quote or rule.
 */
const normalize = (node) => {
  if (Array.isArray(node)) return node.map(normalize);
  if (node?.type === "doc") {
    const content = [...(node.content || [])];
    const last = content[content.length - 1];
    if (last?.type === "paragraph" && !last.content?.length) content.pop();
    return { type: "doc", content: normalize(content) };
  }
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "attrs") {
      const attrs = Object.fromEntries(Object.entries(value || {}).filter(([k, v]) => v !== null && v !== 0 && !(k === "listStyleType" && (v === "disc" || v === "decimal")) && !(k === "start" && v === 1) && !(k === "type" && v === null) && !(k === "target" || k === "rel" || k === "class" || k === "title")));
      if (Object.keys(attrs).length) out.attrs = attrs;
    } else if (key === "marks") {
      out.marks = normalize(value).sort((a, b) => a.type.localeCompare(b.type));
    } else {
      out[key] = normalize(value);
    }
  }
  return out;
};

const everything = [
  "# Heading one",
  "## Two",
  "### Three",
  "",
  "Some **bold**, *italic*, ~~strike~~, `code`, a [link](https://example.com), and [a task](zephyrly-task:task_1).",
  "line one",
  "line two",
  "",
  "- bullet",
  "  - nested",
  "- [ ] open",
  "- [x] done",
  "",
  "3. three",
  "",
  "> quoted",
  "",
  "```js",
  "x = 1",
  "```",
  "",
  "---",
].join("\n");

describe("documents from AI apps open in the editor unchanged", () => {
  it("Markdown written by an AI app", () => {
    const doc = markdownToDoc(everything, { taskLinkAllowed: () => true });
    expect(normalize(roundTrip(doc))).toEqual(normalize(doc));
  });

  it("text formatted by format_note: colours, fonts, highlights, underline, lists, quotes, indents", () => {
    const doc = markdownToDoc("Plan the trip\n\ncall the plumber today\n\nbuy milk\n\nold note", { taskLinkAllowed: () => true });
    const fmt = (text, add, block = {}) => {
      applyMarks(findText(doc, text), markChanges(add, [], isAllowedHref));
      applyBlockChanges(doc, text, { all: false, ...block });
    };
    fmt("Plan the trip", ["color:blue", "font:georgia"], { block: "heading1" });
    fmt("the plumber", ["highlight:green", "underline", "bold"]);
    fmt("buy milk", ["link:mailto:me@example.com"], { list: "checklist", checked: true });
    fmt("old note", [], { block: "quote" });
    fmt("today", [], { indent: 3 });
    linkTextToTask(doc, "call the", "task_2");
    expect(normalize(roundTrip(doc))).toEqual(normalize(doc));
  });
});
