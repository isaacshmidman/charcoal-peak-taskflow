/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc } from "./markdown-doc.js";

describe("Markdown ⇄ note documents", () => {
  const sample = [
    "# Trip & plans",
    "",
    "Call **the *plumber*** then ~~pack~~ `a<b` [site](https://x.dev) [fix **it**](zephyrly-task:task_1) \\*literal\\*",
    "",
    "- a",
    "  - nested",
    "- b",
    "",
    "* [ ] todo",
    "* [x] done",
    "",
    "3) three",
    "4) four",
    "",
    "> quote",
    "",
    "```js",
    "x = 1",
    "```",
    "",
    "---",
  ].join("\n");

  it("reads back what it writes, unchanged", () => {
    const opts = { taskLinkAllowed: () => true };
    const once = docToMarkdown(markdownToDoc(sample, opts));
    expect(once).toBe(sample);
    expect(docToMarkdown(markdownToDoc(once, opts))).toBe(once);
  });

  it("splits a list where plain items turn into checklist items, as the editor has both", () => {
    const doc = markdownToDoc("- a\n\n- [ ] todo\n- [x] done");
    expect(doc.content.map((n) => n.type)).toEqual(["bulletList", "taskList"]);
    expect(doc.content[1].content.map((i) => [i.attrs.checked, i.content[0].content[0].text])).toEqual([[false, "todo"], [true, "done"]]);
  });

  it("keeps headings to the three levels the toolbar offers, and a line break as a line break", () => {
    const doc = markdownToDoc("#### deep\n\nline one\nline two");
    expect(doc.content[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(doc.content[1].content.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
  });

  it("never reads HTML or script links, and drops links to tasks that aren't allowed", () => {
    const doc = markdownToDoc('<img src=x onerror="alert(1)"> [x](javascript:alert(1)) [y](zephyrly-task:nope)', { taskLinkAllowed: () => false });
    const para = doc.content[0].content;
    expect(para.some((n) => n.marks)).toBe(false);
    expect(para.map((n) => n.text).join("")).toBe('<img src=x onerror="alert(1)"> x y');
  });

  it("escapes characters that would otherwise turn into formatting", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "2 * 3 [not a link] ~x~" }] }] };
    const md = docToMarkdown(doc);
    expect(md).toBe("2 \\* 3 \\[not a link\\] \\~x\\~");
    expect(markdownToDoc(md).content[0].content.map((n) => n.text).join("")).toBe("2 * 3 [not a link] ~x~");
  });

  it("keeps paragraphs inside a quote apart", () => {
    const doc = markdownToDoc("> one\n>\n> two");
    expect(doc.content[0].content.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
    expect(docToMarkdown(doc)).toBe("> one\n>\n> two");
  });
});
