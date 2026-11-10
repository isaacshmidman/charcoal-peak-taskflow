import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RepeatFields from "./RepeatFields";

/** @type {any} */
let latest = null;

/** @param {{ initial: any }} props */
function Harness({ initial }) {
  const [form, setForm] = useState(initial);
  const [showEndDate, setShowEndDate] = useState(!!initial.recurrence_end_date);
  latest = form;
  return <RepeatFields form={form} setForm={setForm} showEndDate={showEndDate} setShowEndDate={setShowEndDate} />;
}

const oneTime = { task_type: "one_time", recurrence: "none", recurrence_days: [], recurrence_end_date: "", due_date: "2026-11-20" };

describe("RepeatFields", () => {
  it("a one-time task shows one row and no extras", () => {
    render(<Harness initial={oneTime} />);
    expect(screen.getByRole("combobox", { name: "Repeat" }).textContent).toContain("Does not repeat");
    expect(screen.queryByRole("combobox", { name: "Ends" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Days of the week" })).toBeNull();
  });

  it("a repeating task shows its pattern and when it ends", () => {
    render(<Harness initial={{ ...oneTime, task_type: "recurring", recurrence: "monthly" }} />);
    expect(screen.getByRole("combobox", { name: "Repeat" }).textContent).toContain("Every month");
    expect(screen.getByRole("combobox", { name: "Ends" }).textContent).toContain("Never");
  });

  it("chosen days toggle, stay sorted, and none chosen says so", () => {
    render(<Harness initial={{ ...oneTime, task_type: "recurring", recurrence: "custom_days", recurrence_days: [3] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    expect(latest.recurrence_days).toEqual([1, 3]);
    expect(screen.getByRole("button", { name: "Monday" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
    expect(latest.recurrence_days).toEqual([]);
    expect(screen.getByText("Pick at least one day.")).toBeTruthy();
  });
});
