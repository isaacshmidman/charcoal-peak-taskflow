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

describe("hydrating stored descriptions", () => {
  /**
   * Through a real editor, because the bug only shows there: TipTap
   * parses any string as HTML, which is what collapsed plain-text line
   * breaks into one paragraph.
   */
  const hydrate = async (plain) => {
    const { initialContentFrom } = await import("./content");
    editor.commands.setContent(initialContentFrom("", plain));
  };

  it("keeps each line of a plain-text description as its own paragraph", async () => {
    await hydrate("Bring:\nlaptop\ncharger");
    expect(editor.getJSON().content).toHaveLength(3);
    expect(editor.getText({ blockSeparator: "\n" })).toBe("Bring:\nlaptop\ncharger");
  });

  it("keeps a literal < in plain text as text", async () => {
    await hydrate("budget < 50, deadline <- friday");
    expect(editor.getText()).toBe("budget < 50, deadline <- friday");
  });

  it("renders an HTML calendar description with its formatting, minus anything unsafe", async () => {
    await hydrate('Agenda <b>first</b><br><script>alert(1)</script><img src=x onerror=alert(1)>');
    const html = editor.getHTML();
    expect(html).toContain("<strong>first</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
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

describe("placeholder", () => {
  /**
   * index.css draws the hint from data-placeholder on the empty
   * paragraph. Before the Placeholder extension was registered nothing set
   * it, so the CSS rule never matched and an empty box gave no hint.
   */
  it("labels an empty editor with the host's hint, and drops it once typed in", () => {
    editor.destroy();
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({ element, extensions: buildEditorExtensions({ placeholder: "Write anything" }), content: "" });

    const para = () => element.querySelector("p");
    expect(para()?.getAttribute("data-placeholder")).toBe("Write anything");
    expect(para()?.classList.contains("is-editor-empty")).toBe(true);

    typeAll("hi");
    expect(para()?.classList.contains("is-editor-empty")).toBe(false);
  });
});

describe("highlights are never the reserved yellow", () => {
  /**
   * Yellow means "a task exists for this span". A highlight with no colour
   * renders as the browser's default yellow <mark>, so every way of making
   * one must land on a palette colour.
   */
  const PURPLE = 'data-color="#e9d5ff"';

  it("⌘⇧H (toggleHighlight with no colour) uses the palette default", () => {
    editor.commands.setContent("<p>flag this</p>");
    editor.commands.selectAll();
    editor.commands.toggleHighlight();
    expect(editor.getHTML()).toContain(PURPLE);
  });

  it("typing ==text== uses the palette default", () => {
    typeAll("==loud== ");
    expect(editor.getHTML()).toContain("<mark");
    expect(editor.getHTML()).toContain(PURPLE);
  });

  it("a pasted bare <mark> uses the palette default, while a coloured one keeps its colour", () => {
    editor.commands.setContent('<p><mark>bare</mark> <mark data-color="#bbf7d0">green</mark></p>');
    const html = editor.getHTML();
    expect(html).toContain(`<mark ${PURPLE}`);
    expect(html).toContain('data-color="#bbf7d0"');
  });
});

describe("links", () => {
  /** Every link mark in the doc as { text, href }. */
  const links = () => {
    const found = [];
    editor.state.doc.descendants((node) => {
      const mark = node.marks?.find((m) => m.type.name === "link");
      if (node.isText && mark) found.push({ text: node.text, href: mark.attrs.href });
    });
    return found;
  };

  it("turns a typed address into a link when you finish it", () => {
    typeAll("join https://zoom.us/j/123 ");
    expect(links()).toEqual([{ text: "https://zoom.us/j/123", href: "https://zoom.us/j/123" }]);
  });

  it("links a bare domain with a path as https", () => {
    typeAll("see zoom.us/j/9 ");
    expect(links()[0]?.href).toBe("https://zoom.us/j/9");
  });

  it("leaves file names alone, even when the extension is a real domain", () => {
    typeAll("edit notes.md and setup.sh then play clip.mov ");
    expect(links()).toEqual([]);
  });

  it("keeps links in pasted or imported HTML, and drops every unsafe one", () => {
    editor.commands.setContent(
      '<p><a href="https://meet.google.com/abc">Join</a> ' +
        '<a href="javascript:alert(1)">bad</a> ' +
        '<a href="data:text/html,x">data</a> ' +
        '<a href="/Today">relative</a></p>'
    );
    expect(links()).toEqual([{ text: "Join", href: "https://meet.google.com/abc" }]);
    // The unsafe ones stay as plain words, not lost.
    expect(editor.getText()).toBe("Join bad data relative");
  });

  it("renders every link to open safely in a new tab, ignoring pasted target/rel/class", () => {
    editor.commands.setContent(
      '<p><a href="https://example.com" target="_self" rel="opener" class="task-link-open">x</a></p>'
    );
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    // class="task-link-open" would fake the reserved task-link yellow.
    expect(html).not.toContain("task-link-open");
    expect(html).not.toContain("_self");
  });

  it("never draws an unsafe href from a stored document", () => {
    // A hand-crafted document, as if saved straight to the API.
    editor.commands.setContent({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
      }],
    });
    expect(editor.getHTML()).not.toContain("javascript");
    expect(editor.view.dom.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("links plain addresses already in the text when the editor opens — but not look-alike words", async () => {
    const { linkifyExistingUrls, LINKIFY_ON_LOAD } = await import("./extensions");
    // Content given at creation, the way hosts hydrate — no transaction,
    // so autolink-as-you-type never sees it; only the load pass can.
    editor.destroy();
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: buildEditorExtensions(),
      content:
        "<p>Call: https://zoom.us/j/5 or www.example.com, mail me@example.com. See notes.md</p>" +
        "<pre><code>curl https://api.example.com</code></pre>",
    });
    let meta = null;
    editor.on("transaction", ({ transaction }) => { meta = meta ?? transaction.getMeta(LINKIFY_ON_LOAD); });
    // (A trailing code block makes TipTap append an undoable empty
    // paragraph at load; linkify must add nothing on top of that.)
    const undoBefore = editor.can().undo();
    linkifyExistingUrls(editor);

    expect(links().map((l) => l.href)).toEqual([
      "https://zoom.us/j/5",
      "https://www.example.com/",
      "mailto:me@example.com",
    ]);
    // Tagged so hosts don't autosave it, and kept out of undo.
    expect(meta).toBe(true);
    expect(editor.can().undo()).toBe(undoBefore);
    editor.commands.undo();
    expect(links()).toHaveLength(3);
  });

  it("opens the link editor from ⌘K", () => {
    editor.commands.setContent("<p>text</p>");
    editor.commands.selectAll();
    expect(editor.storage.link.editorOpen).toBe(false);
    editor.commands.openLinkEditor();
    expect(editor.storage.link.editorOpen).toBe(true);
  });
});
