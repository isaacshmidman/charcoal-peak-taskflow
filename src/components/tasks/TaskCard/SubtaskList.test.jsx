import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SubtaskList from "./SubtaskList";

/**
 * Pins the fix for the juddering subtask undo.
 *
 * There are two nested grid containers. The OUTER one collapses when the
 * task has no subtasks — that contraction is deliberate. The bug was that
 * it also went `inert` + `aria-hidden` the instant the last subtask left
 * the data, which hid the subtree out from under a row that was still
 * animating out. The row's exit stranded there and it was still present
 * when undo added the restored one, so the card showed the subtask twice.
 *
 * The rule: the section may COLLAPSE as soon as the data empties, but it
 * must not be hidden from the tree until the exit has actually finished.
 */
const sub = (id, title) => ({
  id,
  title,
  status: "todo",
  due_date: "",
  task_time: "",
  parent_id: "parent-1",
});

const noop = () => {};
const baseProps = {
  task: { id: "parent-1", title: "Parent" },
  didSwipeRef: { current: false },
  onToggleDone: noop,
  onEdit: noop,
  onEditSubtask: noop,
  onDelete: noop,
  onReorderSubtasks: noop,
  onAddSubtask: noop,
};

const grids = (container) => [...container.querySelectorAll('[class*="grid-rows-"]')];
const outer = (container) => grids(container)[0];
const inner = (container) => grids(container)[1];
const collapsed = (el) => el.className.includes("grid-rows-[0fr]");
const hiddenFromTree = (el) => el.hasAttribute("inert") || el.getAttribute("aria-hidden") === "true";

describe("SubtaskList", () => {
  it("keeps the section in the tree while a removed row animates out", () => {
    const { container, rerender } = render(
      <SubtaskList {...baseProps} subtasks={[sub("s1", "only child")]} />
    );
    expect(hiddenFromTree(outer(container))).toBe(false);

    // The last subtask is deleted. Collapsing is fine and wanted; going
    // inert here is what used to strand the exiting row.
    rerender(<SubtaskList {...baseProps} subtasks={[]} />);
    expect(collapsed(outer(container))).toBe(true);
    expect(hiddenFromTree(outer(container))).toBe(false);
  });

  it("does not hide the rows container just because the data emptied", () => {
    const { container, rerender } = render(
      <SubtaskList {...baseProps} subtasks={[sub("s1", "child")]} />
    );
    fireEvent.click(screen.getByText(/subtasks/i));
    expect(collapsed(inner(container))).toBe(false);

    rerender(<SubtaskList {...baseProps} subtasks={[]} />);
    expect(collapsed(inner(container))).toBe(false);
  });

  it("still collapses the rows when the user closes the section", () => {
    const { container } = render(
      <SubtaskList {...baseProps} subtasks={[sub("s1", "child")]} />
    );
    const toggle = screen.getByText(/subtasks/i);

    fireEvent.click(toggle);
    expect(collapsed(inner(container))).toBe(false);
    fireEvent.click(toggle);
    expect(collapsed(inner(container))).toBe(true);
  });

  it("re-opens the section when a subtask is restored", () => {
    const { container, rerender } = render(<SubtaskList {...baseProps} subtasks={[]} />);
    rerender(<SubtaskList {...baseProps} subtasks={[sub("s1", "restored")]} />);
    expect(collapsed(outer(container))).toBe(false);
    expect(hiddenFromTree(outer(container))).toBe(false);
  });
});
