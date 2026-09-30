import { describe, expect, it } from "vitest";
import { findSimilarTasks, titleSimilarity, titleWords } from "./similar-tasks.js";

const words = (title) => [...titleWords(title)].sort();
const slot = (slotId, title, overrides = {}) => ({ slotId, title, due_date: "2026-10-03", task_time: "9:00AM", task_end_time: "10:00AM", ...overrides });
const task = (id, title, overrides = {}) => ({ id, title, due_date: "2026-10-03", status: "todo", parent_id: null, source_provider: "", recurrence: "none", ...overrides });

describe("the words of a title", () => {
  it("leave out the little words, times and plurals", () => {
    expect(words("Go to the gym tmr")).toEqual(["gym"]);
    expect(words("Pick up groceries at 5pm")).toEqual(["grocery", "pick"]);
    expect(words("Mom's birthday dinner, 7:30")).toEqual(["birthday", "dinner", "mom"]);
    expect(words("Finish the 2 classes' essays tonight")).toEqual(["class", "essay", "finish"]);
    expect(words("in of the tmr")).toEqual([]);
  });
});

describe("similar titles", () => {
  it("match when one's words are all in the other's, or most are shared", () => {
    expect(titleSimilarity("Gym", "go to the gym tmr")).toBeGreaterThan(0);
    expect(titleSimilarity("Hike at Bear Mountain", "bear mountain hike")).toBeGreaterThan(0);
    expect(titleSimilarity("Dentist", "Dentist appointment")).toBeGreaterThan(0);
    expect(titleSimilarity("Team meeting", "Meeting with the design team")).toBeGreaterThan(0);
    expect(titleSimilarity("Weekly review of project plan", "Project plan review")).toBeGreaterThan(0);
  });

  it("don't match on one shared word among others, or on little words", () => {
    expect(titleSimilarity("Call Sam", "Dinner with Sam")).toBe(0);
    expect(titleSimilarity("Go to the gym", "Go to the store")).toBe(0);
    expect(titleSimilarity("Lunch", "Laundry")).toBe(0);
    expect(titleSimilarity("tmr", "tmr")).toBe(0);
  });

  it("rank the same words above a looser overlap", () => {
    expect(titleSimilarity("Gym", "gym")).toBeGreaterThan(titleSimilarity("Gym", "gym and sauna"));
    // Two of three words shared, neither inside the other: similar, but less so.
    expect(titleSimilarity("Design review meeting", "Design review notes")).toBeGreaterThan(0);
    expect(titleSimilarity("Gym and sauna", "gym")).toBeGreaterThan(titleSimilarity("Design review meeting", "Design review notes"));
  });
});

describe("finding tasks like the slots", () => {
  it("picks the best open task on that day for each slot, one slot per task", () => {
    const matches = findSimilarTasks(
      [slot("s1", "Gym"), slot("s2", "Lunch with Sam"), slot("s3", "Laundry")],
      [
        task("t1", "go to the gym tmr"),
        task("t2", "gym bag"),
        task("t3", "lunch"),
        task("t4", "Lunch with Sam", { status: "done" }),
        task("t5", "laundry", { due_date: "2026-10-04" }),
        task("t6", "laundry", { parent_id: "t1" }),
      ]
    );
    expect(matches.map((m) => [m.slotId, m.task.id, m.canMerge])).toEqual([
      ["s1", "t1", true],
      ["s2", "t3", true],
    ]);
  });

  it("won't merge into a calendar event or a repeating task, and says which", () => {
    const matches = findSimilarTasks(
      [slot("s1", "Gym"), slot("s2", "Standup")],
      [task("t1", "Gym", { source_provider: "google" }), task("t2", "Daily standup", { recurrence: "daily" })]
    );
    expect(matches.map((m) => [m.slotId, m.canMerge, m.why])).toEqual([
      ["s1", false, "calendar"],
      ["s2", false, "repeating"],
    ]);
  });

  it("gives a task to the slot it matches best, not the first one", () => {
    const matches = findSimilarTasks([slot("s1", "Gym and sauna"), slot("s2", "Gym")], [task("t1", "Gym")]);
    expect(matches.map((m) => [m.slotId, m.task.id])).toEqual([["s2", "t1"]]);
  });
});
