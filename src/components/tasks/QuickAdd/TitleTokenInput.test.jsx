import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import TitleTokenInput from "./TitleTokenInput";

/**
 * Enter in a form's title field means "done" — the record is already
 * autosaved, so the key just finishes and closes. The cases that must NOT
 * finish are the interesting ones: the token dropdown owns Enter while it's
 * open, and a modified Enter belongs to the form's own Mod+Enter handler
 * (firing both would commit twice).
 */

const SAVED_TAGS = [{ id: "t1", name: "family" }];
const GRAMMAR = { dates: false, times: false, recurrence: false, tags: true, priority: false };

function Harness({ onEnter, initial = "" }) {
  const [form, setForm] = useState({ title: initial, tags: [] });
  return (
    <TitleTokenInput
      form={form}
      setForm={setForm}
      grammar={GRAMMAR}
      savedTags={SAVED_TAGS}
      testid="title"
      onEnter={onEnter}
    />
  );
}

/** Type into the controlled input and park the caret at the end, the way a
 *  real keystroke does (the hook reads selectionStart on keyup). */
const typeInto = (input, value) => {
  fireEvent.change(input, { target: { value } });
  input.setSelectionRange(value.length, value.length);
  fireEvent.keyUp(input, { key: value.slice(-1) || "a" });
};

describe("TitleTokenInput — Enter finishes the form", () => {
  it("calls onEnter on a plain Enter", () => {
    const onEnter = vi.fn();
    render(<Harness onEnter={onEnter} />);
    const input = screen.getByTestId("title");
    typeInto(input, "Buy milk");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("does not call onEnter while the token dropdown is open — Enter accepts the tag instead", () => {
    const onEnter = vi.fn();
    render(<Harness onEnter={onEnter} />);
    const input = /** @type {HTMLInputElement} */ (screen.getByTestId("title"));
    typeInto(input, "Call mom #fam");

    // The dropdown is showing the matching saved tag.
    expect(screen.getByText("family")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEnter).not.toHaveBeenCalled();
    // The token was consumed out of the title, not left as literal text.
    expect(input.value).not.toContain("#fam");
  });

  it("leaves Mod+Enter and Shift+Enter alone", () => {
    const onEnter = vi.fn();
    render(<Harness onEnter={onEnter} />);
    const input = screen.getByTestId("title");
    typeInto(input, "Buy milk");

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onEnter).not.toHaveBeenCalled();
  });

  it("is inert without an onEnter handler", () => {
    render(<Harness onEnter={undefined} />);
    const input = screen.getByTestId("title");
    typeInto(input, "Buy milk");

    expect(() => fireEvent.keyDown(input, { key: "Enter" })).not.toThrow();
  });
});
