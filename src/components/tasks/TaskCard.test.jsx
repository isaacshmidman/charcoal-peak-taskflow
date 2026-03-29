import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import TaskCard from "./TaskCard";

const priorities = [
  { id: "priority-1", name: "Medium", order: 1, color: "slate" },
];

const recurringTask = {
  id: "series-1",
  title: "Series task",
  description: "",
  priority_id: "priority-1",
  status: "todo",
  task_type: "recurring",
  recurrence: "daily",
  recurrence_days: [],
  recurrence_end_date: "",
  due_date: "2026-03-28",
  task_time: "",
  tags: [],
  completed_at: "",
};

describe("TaskCard", () => {
  it("clears the optimistic completed state when a recurring task is advanced in place", () => {
    const onToggleDone = vi.fn();
    const noop = vi.fn();
    const commonProps = {
      priorities,
      subtasks: [],
      onToggleDone,
      onEdit: noop,
      onDelete: noop,
      onAddSubtask: noop,
      onUpdate: noop,
      onEditSubtask: noop,
      onReorderSubtasks: noop,
    };

    const { rerender } = render(
      <TaskCard
        task={recurringTask}
        {...commonProps}
      />
    );

    const toggle = screen.getByTestId("task-toggle-series-1");
    fireEvent.click(toggle);

    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: "series-1" }));
    expect(toggle.className).toContain("bg-slate-900");

    rerender(
      <TaskCard
        task={{
          ...recurringTask,
          due_date: "2026-03-29",
          completed_at: "",
          status: "todo",
        }}
        {...commonProps}
      />
    );

    expect(screen.getByTestId("task-toggle-series-1").className).not.toContain("bg-slate-900");
  });
});
