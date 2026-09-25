import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { formatSlotTime, minutesAtOffset, slotLabel } from "./useEmptySlotClick";
import DayView from "./DayView";
import WeekView from "./WeekView";

describe("slot maths", () => {
  it("snaps a click down to the quarter hour and keeps it inside the day", () => {
    expect(minutesAtOffset(0, 48)).toBe(0);
    expect(minutesAtOffset(48 * 9 + 13, 48)).toBe(9 * 60 + 15); // 9:16 → 9:15
    expect(minutesAtOffset(48 * 9 + 11.9, 48)).toBe(9 * 60); // 9:14.9 → 9:00
    expect(minutesAtOffset(-5, 48)).toBe(0);
    expect(minutesAtOffset(48 * 24 + 40, 48)).toBe(23 * 60 + 45);
  });

  it("formats times the way tasks store them, and labels them for people", () => {
    expect(formatSlotTime(0)).toBe("12:00AM");
    expect(formatSlotTime(9 * 60 + 15)).toBe("9:15AM");
    expect(formatSlotTime(12 * 60)).toBe("12:00PM");
    expect(formatSlotTime(23 * 60 + 45)).toBe("11:45PM");
    expect(slotLabel(9 * 60)).toBe("9 AM");
    expect(slotLabel(13 * 60 + 30)).toBe("1:30 PM");
  });
});

const DAY = new Date(2026, 8, 25); // Fri Sep 25 2026, local
const task = (over) => ({
  id: "t1",
  title: "Standup",
  status: "todo",
  due_date: "2026-09-25",
  task_time: "10:00AM",
  task_end_time: "11:00AM",
  tags: [],
  ...over,
});

/** A press at clientY, then a click at clientY (+ travel). happy-dom rects are at 0,0. */
const clickAt = (el, clientY, { travel = 0, target = el } = {}) => {
  fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY });
  fireEvent.click(target, { button: 0, clientX: 10, clientY: clientY + travel });
};

const renderDay = (props) =>
  render(
    <DndContext>
      <DayView anchorDate={DAY} tasks={[task()]} priorities={[]} onTaskClick={() => {}} onToggleDone={() => {}} {...props} />
    </DndContext>
  );

describe("click to create — Day view", () => {
  it("opens a new task at the clicked time", () => {
    const onCreateAt = vi.fn();
    renderDay({ onCreateAt });
    clickAt(screen.getByTestId("calendar-timed-2026-09-25"), 48 * 14 + 30); // 14:37 → 2:30 PM
    expect(onCreateAt).toHaveBeenCalledWith("2026-09-25", 14 * 60 + 30);
  });

  it("opens the task, not a new one, when the click is on a task", () => {
    const onCreateAt = vi.fn();
    const onTaskClick = vi.fn();
    renderDay({ onCreateAt, onTaskClick });
    clickAt(screen.getByTestId("calendar-timed-2026-09-25"), 48 * 10 + 5, { target: screen.getByTitle("Standup") });
    expect(onCreateAt).not.toHaveBeenCalled();
    expect(onTaskClick).toHaveBeenCalled();
  });

  it("ignores the click that ends a drag", () => {
    const onCreateAt = vi.fn();
    renderDay({ onCreateAt });
    clickAt(screen.getByTestId("calendar-timed-2026-09-25"), 48 * 8, { travel: 40 });
    expect(onCreateAt).not.toHaveBeenCalled();
  });

  it("ignores a click whose press began on a task and ended on empty grid", () => {
    const onCreateAt = vi.fn();
    renderDay({ onCreateAt });
    const grid = screen.getByTestId("calendar-timed-2026-09-25");
    fireEvent.pointerDown(screen.getByTitle("Standup"), { button: 0, clientX: 10, clientY: 48 * 10 + 5 });
    fireEvent.click(grid, { button: 0, clientX: 10, clientY: 48 * 10 + 5 });
    expect(onCreateAt).not.toHaveBeenCalled();
  });

  it("creates an all-day task from the all-day area", () => {
    const onCreateAt = vi.fn();
    renderDay({ onCreateAt });
    clickAt(screen.getByTestId("calendar-allday-2026-09-25"), 5);
    expect(onCreateAt).toHaveBeenCalledWith("2026-09-25", null);
  });

  it("shows where a mouse click would land, but not for touch", () => {
    renderDay({ onCreateAt: () => {} });
    const grid = screen.getByTestId("calendar-timed-2026-09-25");
    fireEvent.pointerMove(grid, { pointerType: "mouse", buttons: 0, clientY: 48 * 9 + 20 });
    expect(screen.getByTestId("calendar-slot-ghost").textContent).toBe("+ 9:15 AM");
    fireEvent.pointerLeave(grid);
    expect(screen.queryByTestId("calendar-slot-ghost")).toBeNull();
    fireEvent.pointerMove(grid, { pointerType: "touch", buttons: 0, clientY: 48 * 9 + 20 });
    expect(screen.queryByTestId("calendar-slot-ghost")).toBeNull();
  });

  it("does nothing when the host doesn't offer creating", () => {
    renderDay({});
    const grid = screen.getByTestId("calendar-timed-2026-09-25");
    fireEvent.pointerMove(grid, { pointerType: "mouse", buttons: 0, clientY: 100 });
    expect(screen.queryByTestId("calendar-slot-ghost")).toBeNull();
  });
});

describe("click to create — Week view", () => {
  const renderWeek = (props) =>
    render(
      <DndContext>
        <WeekView anchorDate={DAY} tasks={[task()]} priorities={[]} onTaskClick={() => {}} onToggleDone={() => {}} {...props} />
      </DndContext>
    );

  it("opens a new task on the clicked day at the clicked time — even over an hour line", () => {
    const onCreateAt = vi.fn();
    renderWeek({ onCreateAt });
    // Week columns are tiled with hour-line blocks, so the click target is
    // one of those rather than the column itself.
    const column = screen.getByTestId("calendar-timed-2026-09-23");
    const hourBlock = column.children[7];
    fireEvent.pointerDown(hourBlock, { button: 0, clientX: 10, clientY: 44 * 7 + 30 });
    fireEvent.click(hourBlock, { button: 0, clientX: 10, clientY: 44 * 7 + 30 });
    expect(onCreateAt).toHaveBeenCalledWith("2026-09-23", 7 * 60 + 30);
  });

  it("creates an all-day task from a day's all-day cell", () => {
    const onCreateAt = vi.fn();
    renderWeek({ onCreateAt });
    clickAt(screen.getByTestId("calendar-allday-2026-09-26"), 5);
    expect(onCreateAt).toHaveBeenCalledWith("2026-09-26", null);
  });
});
