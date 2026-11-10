import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TagsField from "./TagsField";
import TimeFields from "./TimeFields";
import { friendlyDate } from "./parts";
import { toDateStr } from "@/lib/dates";
import { Calendar } from "@/components/ui/calendar";

/** @type {any} */
let latest = null;

/** @param {{ Field: any, initial: any, extra?: any }} props */
function Harness({ Field, initial, extra = {} }) {
  const [form, setForm] = useState(initial);
  latest = form;
  return <Field form={form} setForm={setForm} {...extra} />;
}

const saved = [{ id: "1", name: "errands" }, { id: "2", name: "work" }];

describe("TagsField", () => {
  const box = () => screen.getByLabelText("Add a tag");
  const type = (/** @type {string} */ text) => fireEvent.change(box(), { target: { value: text } });

  it("adds what was typed on Enter, and on a comma", () => {
    render(<Harness Field={TagsField} initial={{ tags: [] }} extra={{ savedTags: saved }} />);
    type("garden");
    fireEvent.keyDown(box(), { key: "Enter" });
    type("home");
    fireEvent.keyDown(box(), { key: "," });
    expect(latest.tags).toEqual(["garden", "home"]);
    expect(/** @type {HTMLInputElement} */ (box()).value).toBe("");
  });

  it("adds the saved tag when the whole name is typed, whatever its capitals", () => {
    render(<Harness Field={TagsField} initial={{ tags: [] }} extra={{ savedTags: saved }} />);
    type("WORK");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(latest.tags).toEqual(["work"]);
  });

  it("never adds the same tag twice", () => {
    render(<Harness Field={TagsField} initial={{ tags: ["work"] }} extra={{ savedTags: saved }} />);
    type("work");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(latest.tags).toEqual(["work"]);
  });

  it("Backspace in the empty box takes the last tag off", () => {
    render(<Harness Field={TagsField} initial={{ tags: ["a", "b"] }} extra={{ savedTags: saved }} />);
    fireEvent.keyDown(box(), { key: "Backspace" });
    expect(latest.tags).toEqual(["a"]);
  });

  it("keeps a half-typed tag when the box is left", () => {
    render(<Harness Field={TagsField} initial={{ tags: [] }} extra={{ savedTags: saved }} />);
    type("almost");
    fireEvent.blur(box());
    expect(latest.tags).toEqual(["almost"]);
  });

  it("removes a tag by its button", () => {
    render(<Harness Field={TagsField} initial={{ tags: ["a", "b"] }} extra={{ savedTags: saved }} />);
    fireEvent.click(screen.getByLabelText("Remove tag a"));
    expect(latest.tags).toEqual(["b"]);
  });
});

describe("TimeFields", () => {
  it("a task gets a start and an end; turning time off clears both", () => {
    render(<Harness Field={TimeFields} initial={{ due_date: "2026-11-20", task_time: "", task_end_time: "" }} extra={{ endTouchedRef: { current: false } }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Set time" }));
    expect(latest).toMatchObject({ task_time: "9:00AM", task_end_time: "10:00AM" });
    expect(screen.getByLabelText("End time")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Set time" }));
    expect(latest).toMatchObject({ task_time: "", task_end_time: "" });
  });

  it("a subtask gets a start only, and never an end-time field", () => {
    render(<Harness Field={TimeFields} initial={{ due_date: "2026-11-20", task_time: "" }} extra={{ withEnd: false, dateRequired: false }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Set time" }));
    expect(latest).toEqual({ due_date: "2026-11-20", task_time: "9:00AM" });
    expect(screen.queryByLabelText("End time")).toBeNull();
  });

  it("says why a task without a date can't be saved — but not for a subtask", () => {
    const { unmount } = render(<Harness Field={TimeFields} initial={{ due_date: "", task_time: "" }} />);
    expect(screen.getByText("Pick a date to save this task.")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Set time" })).toBeNull();
    unmount();
    render(<Harness Field={TimeFields} initial={{ due_date: "", task_time: "" }} extra={{ withEnd: false, dateRequired: false }} />);
    expect(screen.queryByText("Pick a date to save this task.")).toBeNull();
  });
});

describe("friendlyDate", () => {
  it("names today and tomorrow, and shows the year only when it isn't this one", () => {
    const now = new Date();
    expect(friendlyDate(toDateStr(now))).toMatch(/^Today · /);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    expect(friendlyDate(toDateStr(tomorrow))).toMatch(/^Tomorrow · /);
    expect(friendlyDate(`${now.getFullYear() + 2}-03-05`)).toMatch(new RegExp(`Mar 5, ${now.getFullYear() + 2}$`));
  });
});

describe("the date picker", () => {
  // The bug this guards: today and the picked day were both FILLED, in two
  // colours, and on the day that was both the two styles fought over the
  // background and the text colour.
  it("fills only the picked day; today is a dot, not a fill", () => {
    const today = new Date();
    const { container } = render(<Calendar mode="single" selected={today} />);
    const picked = /** @type {HTMLElement} */ (container.querySelector('[aria-selected="true"]'));
    expect(picked.className).toContain("!bg-primary");
    // Every class that sets a background on that button belongs to "picked"
    // (the hover tint aside) — nothing from "today" paints the button itself.
    const fills = picked.className.split(/\s+/).filter((c) => /(^|:)!?bg-/.test(c) && !c.includes("after:"));
    expect(fills.sort()).toEqual(["!bg-primary", "hover:bg-selected"]);
    expect(picked.className).toContain("after:bg-sun-500");
  });
});
