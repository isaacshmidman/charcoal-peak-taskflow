import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AnimatedSearchInput } from "./animated-search-input";

function Harness({ initial = "" }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(true);
  return (
    <>
      <AnimatedSearchInput open={open} value={value} onChange={setValue} onClose={() => setOpen(false)} />
      <span data-testid="open">{String(open)}</span>
    </>
  );
}

describe("the search box's clear button", () => {
  it("is only there once something is typed", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "milk" } });
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("empties the box, keeps it open, and leaves the caret in it", () => {
    render(<Harness initial="milk" />);
    const box = /** @type {HTMLInputElement} */ (screen.getByRole("textbox"));
    const clear = screen.getByRole("button", { name: "Clear search" });
    // Pressing it must not close the box the way a press elsewhere does.
    fireEvent.pointerDown(clear);
    fireEvent.click(clear);
    expect(box.value).toBe("");
    expect(screen.getByTestId("open").textContent).toBe("true");
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});
