import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "./extensions";
import Toolbar from "./Toolbar";

/**
 * The toolbar against a REAL editor built from the shipped extension list,
 * so a command name that doesn't exist (or a chain that doesn't run) fails
 * here rather than as a dead button.
 */
/** @type {Editor | undefined} */
let editor;

const mount = (content) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: buildEditorExtensions(), content });
  const bar = () => <Toolbar editor={editor} onPickerOpenChange={undefined} onMakeTask={undefined} />;
  const view = render(bar());
  // The toolbar reads editor state during render; the real host re-renders
  // per transaction (shouldRerenderOnTransaction), so mimic that.
  editor.on("transaction", () => view.rerender(bar()));
  return editor;
};

/** Toolbar controls fire on mousedown (iOS: never blur the editable). */
const press = (testid) => fireEvent.mouseDown(screen.getByTestId(testid));

/** The first block's HTML. StarterKit's TrailingNode appends an empty
 *  paragraph after a heading/quote so the caret can always get below it. */
const firstBlock = (ed) => ed.getHTML().replace(/<p><\/p>$/, "");

const chooseStyle = (key) => {
  press("richtext-style");
  press(`richtext-style-${key}`);
};

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = "";
});

describe("text style picker", () => {
  it("turns the current line into each heading level and back", () => {
    const ed = mount("<p>Plan</p>");
    ed.commands.setTextSelection(2);

    chooseStyle("h2");
    expect(firstBlock(ed)).toBe("<h2>Plan</h2>");

    chooseStyle("h1");
    expect(firstBlock(ed)).toBe("<h1>Plan</h1>");

    chooseStyle("paragraph");
    expect(firstBlock(ed)).toBe("<p>Plan</p>");
  });

  it("wraps a line in a quote and unwraps it with Normal text", () => {
    const ed = mount("<p>Said so</p>");
    ed.commands.setTextSelection(2);

    chooseStyle("quote");
    expect(firstBlock(ed)).toBe("<blockquote><p>Said so</p></blockquote>");

    chooseStyle("paragraph");
    expect(firstBlock(ed)).toBe("<p>Said so</p>");
  });

  it("makes a code block", () => {
    const ed = mount("<p>npm run verify</p>");
    ed.commands.setTextSelection(2);
    chooseStyle("code");
    expect(ed.getHTML()).toContain("<pre><code>npm run verify</code></pre>");
  });

  it("closes once a style is chosen", () => {
    const ed = mount("<p>x</p>");
    ed.commands.setTextSelection(1);
    chooseStyle("h3");
    expect(screen.queryByTestId("richtext-style-h1")).toBeNull();
  });
});

describe("clear formatting", () => {
  it("strips marks and block styles but keeps a note's task link", () => {
    const ed = mount(
      '<h2><strong>Bold</strong> <span style="color: #ef4444">red</span> ' +
        '<mark data-color="#bbf7d0">lit</mark> <span data-task-id="t1">linked</span></h2>'
    );
    ed.commands.selectAll();

    press("richtext-style");
    press("richtext-clear-formatting");

    const html = ed.getHTML();
    expect(html.startsWith("<p>")).toBe(true);
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("color:");
    expect(html).not.toContain("<mark");
    // The note↔task link is data, not formatting — clearing must not sever it.
    expect(html).toContain('data-task-id="t1"');
  });

  it("leaves lists alone", () => {
    const ed = mount("<ul><li><p><em>one</em></p></li></ul>");
    ed.commands.selectAll();
    press("richtext-style");
    press("richtext-clear-formatting");
    expect(ed.getHTML()).toContain("<ul");
    expect(ed.getHTML()).not.toContain("<em>");
  });
});

describe("undo / redo", () => {
  it("is disabled with nothing to undo, then undoes and redoes an edit", () => {
    const ed = mount("<p>a</p>");
    expect(screen.getByTestId("richtext-undo")).toHaveProperty("disabled", true);

    ed.commands.insertContentAt(2, "b");
    expect(ed.getText()).toBe("ab");
    expect(screen.getByTestId("richtext-undo")).toHaveProperty("disabled", false);

    press("richtext-undo");
    expect(ed.getText()).toBe("a");

    press("richtext-redo");
    expect(ed.getText()).toBe("ab");
  });
});

describe("pickers", () => {
  it("close after a colour is chosen", () => {
    const ed = mount("<p>tint</p>");
    ed.commands.selectAll();
    fireEvent.mouseDown(screen.getByLabelText("Text color"));
    fireEvent.mouseDown(screen.getByTitle("Blue"));
    expect(ed.getHTML()).toContain("color: #3b82f6");
    expect(screen.queryByTitle("Blue")).toBeNull();
  });
});
