// @ts-nocheck
/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { markdownToDoc, isAllowedHref } from "../lib/markdown-doc.js";
import { docToMarkdown } from "../lib/markdown-doc.js";
import { applyBlockChanges, applyMarks, findText, linkTextToTask, markChanges } from "./note-format.js";

const doc = (md) => markdownToDoc(md, { taskLinkAllowed: () => true });
const format = (d, text, { add = [], remove = [], all = false, ...block } = {}) => {
  const hits = findText(d, text, { all });
  applyMarks(hits, markChanges(add, remove, isAllowedHref));
  applyBlockChanges(d, text, { all, ...block });
  return d;
};
const para = (d, i = 0) => d.content[i].content;

describe("finding text", () => {
  it("finds text across formatting within a line, but not across lines", () => {
    const d = doc("call **the** plumber\n\nnext");
    expect(findText(d, "call the plumber")).toHaveLength(1);
    expect(findText(d, "plumber\nnext")).toHaveLength(0);
    expect(findText(doc("a x a x"), "x", { all: true })).toHaveLength(2);
  });
});

describe("marks", () => {
  it("formats exactly the text, splitting runs and keeping what was there", () => {
    const d = format(doc("call **the** plumber today"), "the plumber", { add: ["italic"] });
    expect(para(d)).toEqual([
      { type: "text", text: "call " },
      { type: "text", text: "the", marks: [{ type: "bold" }, { type: "italic" }] },
      { type: "text", text: " plumber", marks: [{ type: "italic" }] },
      { type: "text", text: " today" },
    ]);
  });

  it("sets colour and font on one textStyle, and removes them separately", () => {
    const d = format(doc("hello world"), "world", { add: ["color:blue", "font:georgia", "highlight:green", "underline"] });
    expect(para(d)[1].marks).toEqual([
      { type: "textStyle", attrs: { color: "#3b82f6", fontFamily: "Georgia, serif" } },
      { type: "highlight", attrs: { color: "#bbf7d0" } },
      { type: "underline" },
    ]);
    format(d, "world", { remove: ["color"] });
    expect(para(d)[1].marks.find((m) => m.type === "textStyle")).toEqual({ type: "textStyle", attrs: { color: null, fontFamily: "Georgia, serif" } });
    format(d, "world", { remove: ["font"] });
    expect(para(d)[1].marks.some((m) => m.type === "textStyle")).toBe(false);
  });

  it("refuses yellow, unknown colours and unsafe links", () => {
    const d = doc("hi");
    expect(() => format(d, "hi", { add: ["highlight:yellow"] })).toThrow(/reserved for text linked to a task/);
    expect(() => format(d, "hi", { add: ["color:gold"] })).toThrow(/Text colours are/);
    expect(() => format(d, "hi", { add: ["link:javascript:alert(1)"] })).toThrow(/full web or email addresses/);
    expect(() => format(d, "hi", { add: ["sparkle"] })).toThrow(/Can't add "sparkle"/);
  });

  it("clearing formatting keeps the link to a task and a web link, like the toolbar", () => {
    const d = doc("[**call** the plumber](zephyrly-task:task_1) and [site](https://x.dev)");
    format(d, "call the plumber and site", { add: ["highlight:pink"] });
    format(d, "call the plumber and site", { remove: ["all"] });
    expect(docToMarkdown(d)).toBe("[call the plumber](zephyrly-task:task_1) and [site](https://x.dev)");
  });
});

describe("blocks", () => {
  it("makes a line a heading, a code block, and back", () => {
    const d = doc("Plan\n\nbody");
    format(d, "Plan", { block: "heading2" });
    expect(d.content[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    format(d, "body", { block: "code_block" });
    expect(d.content[1]).toEqual({ type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "body" }] });
    format(d, "body", { block: "paragraph" });
    expect(d.content[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "body" }] });
  });

  it("puts a line in a quote (joining one before it) and takes it out, splitting the quote", () => {
    const d = doc("> one\n\ntwo\n\nthree");
    format(d, "two", { block: "quote" });
    expect(docToMarkdown(d)).toBe("> one\n>\n> two\n\nthree");
    format(d, "one", { block: "paragraph" });
    expect(d.content.map((n) => n.type)).toEqual(["paragraph", "blockquote", "paragraph"]);
  });

  it("puts lines in a list, joins a list right before, changes the kind, and takes a line out", () => {
    const d = doc("- a\n\nb\n\nc");
    format(d, "b", { list: "bullet" });
    expect(docToMarkdown(d)).toBe("- a\n- b\n\nc");
    format(d, "a", { list: "checklist" });
    expect(docToMarkdown(d)).toBe("- [ ] a\n- [ ] b\n\nc");
    format(d, "b", { checked: true });
    expect(docToMarkdown(d)).toBe("- [ ] a\n- [x] b\n\nc");
    format(d, "a", { list: "none" });
    expect(docToMarkdown(d)).toBe("a\n\n- [x] b\n\nc");
  });

  it("numbered lists keep counting when a middle line is taken out", () => {
    const d = doc("1. one\n2. two\n3. three");
    format(d, "two", { list: "none" });
    expect(docToMarkdown(d)).toBe("1. one\n\ntwo\n\n3. three");
    format(d, "one", { list: "roman" });
    expect(d.content[0].attrs).toEqual({ start: 1, listStyleType: "upper-roman" });
  });

  it("indents lines outside lists, and says how to indent inside one", () => {
    const d = doc("plain\n\n- item");
    format(d, "plain", { indent: 2 });
    expect(d.content[0].attrs).toEqual({ indent: 2 });
    format(d, "plain", { indent: 0 });
    expect(d.content[0].attrs).toBeUndefined();
    expect(() => format(d, "item", { indent: 1 })).toThrow(/nesting them in the list/);
    expect(() => format(d, "plain", { checked: true })).toThrow(/isn't on a checklist line/);
  });

  it("changes every occurrence with all", () => {
    const d = doc("x one\n\nx two");
    format(d, "x", { all: true, list: "dash" });
    expect(d.content).toHaveLength(1);
    expect(d.content[0]).toMatchObject({ type: "bulletList", attrs: { listStyleType: "dash" } });
    expect(d.content[0].content).toHaveLength(2);
  });
});

describe("linking text to a task", () => {
  it("marks exactly the text, and refuses text already linked", () => {
    const d = doc("please call **the** plumber");
    expect(linkTextToTask(d, "call the plumber", "task_9")).toBe(true);
    expect(docToMarkdown(d)).toBe("please [call **the** plumber](zephyrly-task:task_9)");
    expect(() => linkTextToTask(d, "plumber", "task_10")).toThrow(/already linked to a task \(id task_9\)/);
    expect(linkTextToTask(d, "nowhere", "task_11")).toBe(false);
  });
});
