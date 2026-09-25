import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RichDescriptionEditor from "../RichDescriptionEditor";

/**
 * The link bar through the real editor component: what shows when the
 * caret is in a link, what its buttons do, and that nothing is saved just
 * for opening a description that contains a URL.
 */
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Mount the editor and hand back its instance once it exists. */
async function mount(props) {
  let editor = null;
  const onChange = vi.fn();
  const view = render(
    <RichDescriptionEditor onChange={onChange} onEditorReady={(ed) => { editor = ed; }} {...props} />
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor, onChange, ...view };
}

/** Position just inside the first occurrence of `text`. */
const posOf = (editor, text) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text.includes(text)) found = pos + node.text.indexOf(text) + 1;
  });
  return found;
};

describe("link bar", () => {
  it("makes URLs in a stored description clickable without saving anything", async () => {
    const { container, onChange } = await mount({ plainFallback: "Join https://zoom.us/j/42 at 3" });
    const anchor = container.querySelector(".tiptap-prose a");
    expect(anchor?.getAttribute("href")).toBe("https://zoom.us/j/42");
    // Opening a task must not autosave it.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows where a link really goes when the caret is in it, and opens it", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { editor } = await mount({
      valueJson: JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "the agenda", marks: [{ type: "link", attrs: { href: "https://example.com/agenda" } }] }],
        }],
      }),
    });

    act(() => { editor.chain().focus().setTextSelection(posOf(editor, "agenda")).run(); });
    // The label is the real destination, not the link's text.
    const label = await screen.findByTestId("richtext-link-label");
    expect(label.textContent).toBe("example.com/agenda");

    fireEvent.mouseDown(screen.getByTestId("richtext-link-open"));
    expect(open).toHaveBeenCalledWith("https://example.com/agenda", "_blank", "noopener,noreferrer");
  });

  it("removes a link but keeps its words", async () => {
    const { editor, onChange } = await mount({ plainFallback: "see https://example.com/x now" });
    act(() => { editor.chain().focus().setTextSelection(posOf(editor, "example")).run(); });
    fireEvent.mouseDown(await screen.findByTestId("richtext-link-remove"));

    expect(editor.getHTML()).not.toContain("<a");
    expect(editor.getText()).toBe("see https://example.com/x now");
    expect(onChange).toHaveBeenCalled();
  });

  it("adds a link to selected text from ⌘K, adding https:// to a bare address", async () => {
    const { editor } = await mount({ plainFallback: "call notes" });
    act(() => {
      editor.chain().focus().setTextSelection({ from: 1, to: 5 }).run(); // "call"
      editor.commands.openLinkEditor();
    });

    const input = await screen.findByTestId("richtext-link-input");
    fireEvent.change(input, { target: { value: "zoom.us/j/7" } });
    fireEvent.submit(input.closest("form"));

    expect(editor.getHTML()).toContain('<a href="https://zoom.us/j/7"');
    expect(editor.state.doc.textContent).toBe("call notes");
  });

  it("refuses an address it won't link", async () => {
    const { editor } = await mount({ plainFallback: "click here" });
    act(() => {
      editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
      editor.commands.openLinkEditor();
    });
    const input = await screen.findByTestId("richtext-link-input");
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(input.closest("form"));

    expect(await screen.findByText("Enter a web address or an email.")).toBeTruthy();
    expect(editor.getHTML()).not.toContain("<a");
  });
});

describe("clicking links", () => {
  it("while editing, a plain click only moves the caret; ⌘/Ctrl-click opens", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = await mount({ plainFallback: "go https://example.com/a" });
    const anchor = container.querySelector(".tiptap-prose a");

    fireEvent.click(anchor);
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(anchor, { metaKey: true });
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
  });

  it("read-only, the browser follows a vetted link itself", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = await mount({ plainFallback: "go https://example.com/a", disabled: true });
    const anchor = container.querySelector(".tiptap-prose a");
    expect(anchor.getAttribute("target")).toBe("_blank");

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    anchor.dispatchEvent(event);
    // Not intercepted: the native anchor (new tab, no opener) does the work.
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    // And no link bar in read-only mode.
    expect(screen.queryByTestId("richtext-link-label")).toBeNull();
  });
});
