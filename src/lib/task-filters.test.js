import { describe, expect, it } from "vitest";
import { taskMatchesSearch } from "./task-filters";

describe("taskMatchesSearch", () => {
  const task = {
    title: "Call the plumber",
    tags: ["Home", "urgent"],
    description: "Ask about the leak under the kitchen sink",
  };

  it("matches the title, a tag, or the description, ignoring case", () => {
    expect(taskMatchesSearch(task, "PLUMBER")).toBe(true);
    expect(taskMatchesSearch(task, "home")).toBe(true);
    // The point of the helper: descriptions are searchable now.
    expect(taskMatchesSearch(task, "kitchen sink")).toBe(true);
    expect(taskMatchesSearch(task, "garage")).toBe(false);
  });

  it("matches everything for a blank query", () => {
    expect(taskMatchesSearch(task, "")).toBe(true);
    expect(taskMatchesSearch(task, "   ")).toBe(true);
    expect(taskMatchesSearch(task, null)).toBe(true);
  });

  it("ignores stray spaces around the query", () => {
    expect(taskMatchesSearch(task, "  plumber ")).toBe(true);
  });

  it("searches an HTML description's text, not its markup", () => {
    const imported = { title: "Standup", description: "Join <b>Zoom</b><br><div>room 4</div>" };
    expect(taskMatchesSearch(imported, "zoom")).toBe(true);
    expect(taskMatchesSearch(imported, "div")).toBe(false);
    expect(taskMatchesSearch(imported, "br")).toBe(false);
  });

  it("copes with missing fields", () => {
    expect(taskMatchesSearch({}, "x")).toBe(false);
    expect(taskMatchesSearch(null, "x")).toBe(false);
    expect(taskMatchesSearch({ title: "x" }, "x")).toBe(true);
  });
});
