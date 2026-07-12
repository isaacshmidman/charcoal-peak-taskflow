import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("ranks exact > startsWith > word-boundary > substring > none", () => {
    expect(fuzzyScore("today", "today")).toBe(100);
    expect(fuzzyScore("tod", "today")).toBe(90);
    expect(fuzzyScore("tas", "all tasks")).toBe(70);
    expect(fuzzyScore("ask", "all tasks")).toBe(50);
    expect(fuzzyScore("zzz", "all tasks")).toBe(0);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(fuzzyScore("  CAL ", "Calendar")).toBe(90);
  });

  it("returns 0 for empty inputs", () => {
    expect(fuzzyScore("", "today")).toBe(0);
    expect(fuzzyScore("t", "")).toBe(0);
  });
});

describe("fuzzyFilter", () => {
  const items = ["Calendar", "call dentist", "recall notes", "Completed"];

  it("ranks and limits, keeping input order on ties", () => {
    expect(fuzzyFilter("cal", items, (x) => x)).toEqual([
      "Calendar",
      "call dentist",
      "recall notes",
    ]);
    expect(fuzzyFilter("cal", items, (x) => x, 2)).toEqual(["Calendar", "call dentist"]);
  });

  it("returns [] for an empty query (palette shows curated sections)", () => {
    expect(fuzzyFilter("", items, (x) => x)).toEqual([]);
  });
});
