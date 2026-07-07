import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("renders unchecked with checkbox semantics and toggles on click", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} />);

    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.querySelector("svg")).toBe(null);

    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("shows the ink fill and icon when checked, and toggles back off", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked onCheckedChange={onCheckedChange} />);

    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.className).toContain("bg-slate-900");
    expect(box.querySelector("svg")).not.toBe(null);

    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("runs a consumer onClick BEFORE the toggle, and both always fire", () => {
    // Swipeable rows (TaskCard) pass onClick for stopPropagation +
    // preventDefault as click hygiene — neither may suppress the toggle.
    const order = [];
    const onClick = vi.fn((e) => {
      order.push("onClick");
      e.stopPropagation();
      e.preventDefault();
    });
    const onCheckedChange = vi.fn(() => order.push("onCheckedChange"));
    render(<Checkbox checked={false} onClick={onClick} onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(order).toEqual(["onClick", "onCheckedChange"]);
  });

  it("does not toggle when disabled", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox disabled checked={false} onCheckedChange={onCheckedChange} />);

    const box = screen.getByRole("checkbox");
    expect(box.hasAttribute("disabled")).toBe(true);
    fireEvent.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("maps sizes to their box metrics", () => {
    const { rerender } = render(<Checkbox checked={false} size="sm" />);
    let box = screen.getByRole("checkbox");
    expect(box.className).toContain("w-4");
    expect(box.className).not.toContain("rounded-md");

    rerender(<Checkbox checked={false} size="default" />);
    box = screen.getByRole("checkbox");
    expect(box.className).toContain("w-5");
    expect(box.className).toContain("rounded-md");

    rerender(<Checkbox checked={false} size="task" />);
    box = screen.getByRole("checkbox");
    expect(box.className).toContain("w-7");
    expect(box.className).toContain("rounded-md");
  });

  it("passes through arbitrary props (testids, pointer handlers)", () => {
    const onPointerDown = vi.fn();
    render(
      <Checkbox
        checked={false}
        data-testid="task-toggle-42"
        onPointerDown={onPointerDown}
      />
    );

    const box = screen.getByTestId("task-toggle-42");
    fireEvent.pointerDown(box);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
