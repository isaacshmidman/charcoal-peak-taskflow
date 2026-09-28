import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import RichDescriptionEditor from "./RichDescriptionEditor";
import TitleAndDescription from "./TaskForm/TitleAndDescription";

/**
 * A read-only calendar event's form disables its fields with
 * <fieldset disabled>, which never reaches a contenteditable. The editor has
 * to lock itself, or the description stays typeable while every edit is
 * dropped (autosave is off for read-only events).
 */
describe("RichDescriptionEditor disabled", () => {
  const prose = (container) => container.querySelector(".tiptap-prose");

  it("renders a locked editor when disabled, and unlocks when the host says so", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <RichDescriptionEditor plainFallback="From the calendar" onChange={onChange} disabled />
    );
    await waitFor(() => expect(prose(container)).not.toBeNull());
    expect(prose(container).getAttribute("contenteditable")).toBe("false");

    rerender(<RichDescriptionEditor plainFallback="From the calendar" onChange={onChange} disabled={false} />);
    await waitFor(() => expect(prose(container).getAttribute("contenteditable")).toBe("true"));
    // Flipping editability is not an edit — nothing may be saved for it.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("never shows the formatting toolbar while disabled, even if focused", async () => {
    const { container } = render(
      <RichDescriptionEditor plainFallback="Read me" onChange={() => {}} disabled />
    );
    await waitFor(() => expect(prose(container)).not.toBeNull());
    act(() => { prose(container).dispatchEvent(new FocusEvent("focus")); });
    expect(container.querySelector("[data-richtext-toolbar]")).toBeNull();
  });
});

describe("TitleAndDescription readOnly", () => {
  it("passes read-only through to the description editor", async () => {
    const form = { title: "Holiday", description: "Office closed", description_json: "", tags: [] };
    const { container } = render(
      <TitleAndDescription
        form={form}
        setForm={() => {}}
        task={{ id: "evt-1", description: "Office closed" }}
        onTitleEnter={undefined}
        readOnly
      />
    );
    await waitFor(() => expect(container.querySelector(".tiptap-prose")).not.toBeNull());
    expect(container.querySelector(".tiptap-prose").getAttribute("contenteditable")).toBe("false");
  });
});

describe("RichDescriptionEditor word limit", () => {
  it("explains a refused paste instead of silently doing nothing", async () => {
    /** @type {any} */
    let editor = null;
    const onChange = vi.fn();
    const { findByTestId } = render(
      <RichDescriptionEditor plainFallback="one two" wordLimit={3} onChange={onChange} onEditorReady={(ed) => { editor = ed; }} />
    );
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, " three four five"); });

    expect((await findByTestId("richtext-limit-notice")).textContent).toBe("That's 2 words over the 3-word limit.");
    expect(editor.getText()).toBe("one two");
    expect(onChange).not.toHaveBeenCalled();
  });
});
