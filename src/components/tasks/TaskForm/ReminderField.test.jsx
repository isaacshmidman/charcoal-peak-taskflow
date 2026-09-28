import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReminderField, { describeDefaultReminder, reminderFits } from "./ReminderField";

/** @type {any} */
let serverSettings = { enabled: true, timedOffsetMinutes: -10, allDayEnabled: true, allDayTime: "9:00AM" };
vi.mock("@/api/apiClient", () => ({
  apiClient: { notifications: { getSettings: async () => ({ settings: serverSettings }) } },
}));

/** @param {{ initial: any, onForm?: (form: any) => void }} props */
function Harness({ initial, onForm }) {
  const [form, setForm] = useState(initial);
  onForm?.(form);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReminderField form={form} setForm={setForm} />
    </QueryClientProvider>
  );
}

describe("describeDefaultReminder", () => {
  const base = { enabled: true, timedOffsetMinutes: -10, allDayEnabled: true, allDayTime: "9:00AM" };
  it("names what Default means for this task", () => {
    expect(describeDefaultReminder(base, true)).toBe("10 min before");
    expect(describeDefaultReminder({ ...base, timedOffsetMinutes: 0 }, true)).toBe("at start");
    expect(describeDefaultReminder({ ...base, timedOffsetMinutes: -60 }, true)).toBe("1 hour before");
    expect(describeDefaultReminder({ ...base, timedOffsetMinutes: -2880 }, true)).toBe("2 days before");
    expect(describeDefaultReminder(base, false)).toBe("at 9:00 AM");
    expect(describeDefaultReminder({ ...base, allDayEnabled: false }, false)).toBe("none");
    expect(describeDefaultReminder({ ...base, enabled: false }, true)).toBe("reminders off");
  });
});

describe("reminderFits", () => {
  it("matches offsets to timed tasks and times of day to all-day ones", () => {
    expect(reminderFits("before:15", true)).toBe(true);
    expect(reminderFits("before:15", false)).toBe(false);
    expect(reminderFits("at:8:00AM", false)).toBe(true);
    expect(reminderFits("at:8:00AM", true)).toBe(false);
    expect(reminderFits("none", true)).toBe(true);
    expect(reminderFits("", false)).toBe(true);
  });
});

describe("ReminderField", () => {
  it("shows the account default for a timed task", async () => {
    serverSettings = { enabled: true, timedOffsetMinutes: -10, allDayEnabled: true, allDayTime: "9:00AM" };
    render(<Harness initial={{ due_date: "2026-09-30", task_time: "2:00PM", reminder: "" }} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Reminder" }).textContent).toContain("Default (10 min before)"));
  });

  it("drops an offset that no longer fits once the task becomes all-day", async () => {
    /** @type {any} */
    let latest = null;
    render(<Harness initial={{ due_date: "2026-09-30", task_time: "", reminder: "before:30" }} onForm={(f) => { latest = f; }} />);
    await waitFor(() => expect(latest.reminder).toBe(""));
  });

  it("offers a time of day for an all-day task set to one", async () => {
    render(<Harness initial={{ due_date: "2026-09-30", task_time: "", reminder: "at:7:30AM" }} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Reminder" }).textContent).toContain("At a time"));
    expect(screen.getByText(/7:30AM/)).toBeTruthy();
  });

  it("says so when notifications are off", async () => {
    serverSettings = { enabled: false };
    render(<Harness initial={{ due_date: "2026-09-30", task_time: "2:00PM", reminder: "" }} />);
    expect(await screen.findByText(/Notifications are off/)).toBeTruthy();
  });
});
