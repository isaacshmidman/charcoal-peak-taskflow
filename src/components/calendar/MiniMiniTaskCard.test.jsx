import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import MiniMiniTaskCard from "./MiniMiniTaskCard";

const task = (over = {}) => ({ id: "t1", title: "Send invoice", status: "todo", due_date: "2026-09-23", tags: [], ...over });
const priorities = [{ id: "p1", name: "High", color: "red" }];

const renderChip = (props = {}) => {
  const onClick = vi.fn();
  const onToggleDone = vi.fn();
  render(
    <DndContext>
      <MiniMiniTaskCard task={task()} priorities={priorities} onClick={onClick} onToggleDone={onToggleDone} {...props} />
    </DndContext>
  );
  return { onClick, onToggleDone };
};

describe("a chip on the calendar", () => {
  it("carries its priority's colour down the left edge", () => {
    renderChip({ task: task({ priority_id: "p1" }) });
    expect(screen.getByTitle("Send invoice").className).toContain("border-l-red-400");
  });

  it("a connected calendar's event takes that calendar's colour for the edge, and has no tick", () => {
    renderChip({ task: task({ source_kind: "event", source_color_hex: "#3366cc" }) });
    expect(screen.getByTitle("Send invoice").style.borderLeftColor).toBe("#3366cc");
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  it("ticking it marks it done without opening it", () => {
    const { onClick, onToggleDone } = renderChip();
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(onToggleDone).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    // Shown as done at once, before the save answers.
    expect(screen.getByRole("button", { name: "Mark incomplete" })).toBeTruthy();
  });

  it("the tick stays out of sight until the pointer or keyboard is on the chip, but only where there is a pointer to hover with", () => {
    renderChip();
    const tick = screen.getByRole("button", { name: "Mark done" });
    expect(tick.className).toContain("[@media(hover:hover)]:opacity-0");
    expect(tick.className).toContain("[@media(hover:hover)]:group-hover:opacity-100");
    expect(tick.className).toContain("[@media(hover:hover)]:group-focus-within:opacity-100");
  });

  it("a done task keeps its tick showing", () => {
    renderChip({ task: task({ status: "done" }) });
    expect(screen.getByRole("button", { name: "Mark incomplete" }).className).not.toContain("opacity-0");
  });

  it("clicking the chip itself opens it", () => {
    const { onClick } = renderChip();
    fireEvent.click(screen.getByText("Send invoice"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
