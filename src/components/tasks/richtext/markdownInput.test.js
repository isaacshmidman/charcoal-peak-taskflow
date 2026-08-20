import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "./extensions";

/**
 * Markdown typing shortcuts, exercised against a REAL editor built from
 * the app's own extension list — not a re-declared one, so this can't
 * drift from what ships.
 *
 * Input rules fire from ProseMirror's `handleTextInput`, which is what a
 * keystroke ultimately calls. Driving that directly is the honest way to
 * test them: `insertContent` would bypass input rules entirely and pass
 * whatever the rules did or didn't do.
 */
let editor;

const mount = () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: buildEditorExtensions(), content: "" });
};

/** Type `text` at the end of the doc the way a keypress would. */
const typeAtEnd = (text) => {
  const pos = editor.state.selection.to;
  const handled = editor.view.someProp("handleTextInput", (fn) =>
    fn(editor.view, pos, pos, text)
  );
  // An input rule that doesn't match returns false; the character still
  // needs to land, exactly as the browser would insert it.
  if (!handled) editor.commands.insertContent(text);
};

const typeAll = (str) => { for (const ch of str) typeAtEnd(ch); };

beforeEach(() => { editor = mount(); });
afterEach(() => { editor?.destroy(); document.body.innerHTML = ""; });

describe("markdown typing shortcuts", () => {
  it("turns '# ' into a heading", () => {
    typeAll("# Big heading");
    expect(editor.getHTML()).toContain("<h1>");
    // getText() trails the empty paragraph the heading rule leaves behind.
    expect(editor.getText().trim()).toBe("Big heading");
  });

  it("supports deeper heading levels", () => {
    typeAll("### Third");
    expect(editor.getHTML()).toContain("<h3>");
  });

  it("turns '- ' into a bullet list", () => {
    // The list extensions are .extend()s of StarterKit's, so they must
    // still carry its input rules — replacing them outright would have
    // silently dropped this.
    typeAll("- milk");
    const html = editor.getHTML();
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
  });

  it("turns '1. ' into an ordered list", () => {
    typeAll("1. first");
    const html = editor.getHTML();
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
  });

  it("turns '> ' into a blockquote", () => {
    typeAll("> quoted");
    expect(editor.getHTML()).toContain("<blockquote>");
  });

  it("converts **bold**, *italic*, ~~strike~~ and `code`", () => {
    typeAll("**loud** ");
    expect(editor.getHTML()).toContain("<strong>loud</strong>");

    typeAll("*lean* ");
    expect(editor.getHTML()).toContain("<em>lean</em>");

    typeAll("~~gone~~ ");
    expect(editor.getHTML()).toContain("<s>gone</s>");

    typeAll("`snippet` ");
    expect(editor.getHTML()).toContain("<code>snippet</code>");
  });

  it("leaves ordinary prose untouched", () => {
    typeAll("call Bob at 3 and pay 5 - 3 dollars");
    const html = editor.getHTML();
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<ul");
    expect(editor.getText()).toBe("call Bob at 3 and pay 5 - 3 dollars");
  });
});

describe("pasted markdown", () => {
  /**
   * The paste path in RichDescriptionEditor is: looksLikeMarkdown gates
   * it, marked turns it into HTML, and insertContent parses that HTML
   * through the editor's SCHEMA. This drives the same three steps so the
   * schema-filtering claim is actually checked rather than asserted.
   */
  const pasteMarkdown = async (text) => {
    const { marked } = await import("marked");
    const { looksLikeMarkdown } = await import("./pasteMarkdown");
    if (!looksLikeMarkdown(text)) return false;
    editor.commands.insertContent(marked.parse(text, { async: false, gfm: true, breaks: true }));
    return true;
  };

  it("converts a pasted markdown document into real formatting", async () => {
    const converted = await pasteMarkdown(
      "# Shopping\n\nGet **milk** and *bread*.\n\n- apples\n- pears\n\n> remember the list\n"
    );
    expect(converted).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>milk</strong>");
    expect(html).toContain("<em>bread</em>");
    expect(html).toContain("<li");
    expect(html).toContain("<blockquote>");
    // The words all survive the round trip.
    for (const word of ["Shopping", "milk", "bread", "apples", "pears"]) {
      expect(editor.getText()).toContain(word);
    }
  });

  it("drops anything the schema doesn't define instead of trusting it", async () => {
    // marked passes raw HTML through; ProseMirror is the gate that makes
    // that safe, because it only keeps nodes the schema knows.
    await pasteMarkdown("# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**kept**");
    const html = editor.getHTML();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>kept</strong>");
  });

  it("does not touch plain prose", async () => {
    const converted = await pasteMarkdown("just a sentence I copied from an email");
    expect(converted).toBe(false);
    expect(editor.getHTML()).not.toContain("<strong>");
  });
});
