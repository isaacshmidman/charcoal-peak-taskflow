import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import TimedEventBlock from "./TimedEventBlock";
import { resizedEnd } from "./useResizeDuration";

describe("resizedEnd", () => {
  const base = { startMin: 9 * 60, originalEnd: 10 * 60 + 30, hourHeight: 44 };
  it("moves the end by the pointer's travel, snapped to the quarter hour", () => {
    expect(resizedEnd({ ...base, deltaY: 44 })).toBe(11 * 60 + 30); // +1h
    expect(resizedEnd({ ...base, deltaY: 16 })).toBe(10 * 60 + 45); // +21.8m → +15
    expect(resizedEnd({ ...base, deltaY: -22 })).toBe(10 * 60); // −30m
  });
  it("never ends within 15 minutes of the start, or after 11:59 PM", () => {
    expect(resizedEnd({ ...base, deltaY: -1000 })).toBe(9 * 60 + 15);
    expect(resizedEnd({ ...base, deltaY: 5000 })).toBe(24 * 60 - 1);
  });
});

const task = (over = {}) => ({
  id: "t1", title: "Standup", status: "todo", due_date: "2026-09-23",
  task_time: "9:00AM", task_end_time: "10:30AM", tags: [], ...over,
});
const layout = (t = task()) => ({ task: t, startMin: 9 * 60, endMin: 10 * 60 + 30, col: 0, cols: 1, colSpan: 1 });

const renderBlock = (props = {}) => {
  const onResize = vi.fn();
  const onTaskClick = vi.fn();
  const onDragStart = vi.fn();
  const view = render(
    <DndContext onDragStart={onDragStart}>
      <div data-testid="grid" style={{ position: "relative", height: 1056 }}>
        <TimedEventBlock layout={layout(props.task)} hourHeight={44} minHeight={22} priorities={[]}
          onTaskClick={onTaskClick} onToggleDone={() => {}} onResize={onResize} {...props} />
      </div>
    </DndContext>
  );
  return { ...view, onResize, onTaskClick, onDragStart };
};

const block = () => screen.getByTestId("calendar-event-t1");

describe("resizing an event", () => {
  it("stretches live, shows the new range, and saves only the end on release", () => {
    const { onResize, onTaskClick, onDragStart } = renderBlock();
    const handle = screen.getByTestId("calendar-resize-t1");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 544 }); // +1 hour
    expect(block().style.height).toBe(`${2.5 * 44}px`);
    expect(screen.getByTestId("calendar-resize-time").textContent).toBe("9 AM – 11:30 AM");
    expect(onResize).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 544 });
    fireEvent.click(handle);
    expect(onResize).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), 11 * 60 + 30);
    // Letting go doesn't open the task, and pulling the edge never started a move.
    expect(onTaskClick).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(screen.queryByTestId("calendar-resize-time")).toBeNull();
  });

  it("saves nothing if the end didn't change", () => {
    const { onResize } = renderBlock();
    const handle = screen.getByTestId("calendar-resize-t1");
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 504 }); // < half a slot
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 504 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("cancels with Escape", () => {
    const { onResize } = renderBlock();
    const handle = screen.getByTestId("calendar-resize-t1");
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 600 });
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(block().style.height).toBe(`${1.5 * 44}px`);
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 600 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("offers no handle on read-only calendar items", () => {
    renderBlock({ task: task({ source_provider: "google", source_writable: false }) });
    expect(screen.queryByTestId("calendar-resize-t1")).toBeNull();
  });

  it("still opens the task on a plain click of the card", () => {
    const { onTaskClick } = renderBlock();
    fireEvent.click(screen.getByTitle("Standup"));
    expect(onTaskClick).toHaveBeenCalled();
  });
});
