// @ts-check
import { describe, it, expect } from "vitest";
import {
  colorNameToGoogleColorId,
  colorNameToHex,
  lookupPriorityColor,
} from "./priority-color.js";

describe("colorNameToGoogleColorId", () => {
  it("maps each Zephyrly color to a valid Google colorId 1..11", () => {
    const samples = [
      "red", "orange", "yellow", "green", "blue", "violet", "pink",
      "teal", "cyan", "rose", "slate", "black", "white", "brown",
      "red_alt", "orange_alt", "yellow_alt", "green_alt", "blue_alt", "violet_alt",
    ];
    for (const c of samples) {
      const id = colorNameToGoogleColorId(c);
      expect(id, `mapping for ${c}`).toBeDefined();
      const n = Number(id);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(11);
    }
  });

  it("collapses *_alt variants to the same id as their base color", () => {
    expect(colorNameToGoogleColorId("red_alt")).toBe(colorNameToGoogleColorId("red"));
    expect(colorNameToGoogleColorId("blue_alt")).toBe(colorNameToGoogleColorId("blue"));
    expect(colorNameToGoogleColorId("green_alt")).toBe(colorNameToGoogleColorId("green"));
  });

  it("returns undefined for unknown color names", () => {
    expect(colorNameToGoogleColorId("not-a-color")).toBeUndefined();
    expect(colorNameToGoogleColorId("")).toBeUndefined();
  });
});

describe("colorNameToHex", () => {
  it("emits valid #RRGGBB for every base color", () => {
    const samples = ["red", "blue", "green", "violet", "slate", "black", "white"];
    for (const c of samples) {
      expect(colorNameToHex(c), `hex for ${c}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("base and *_alt give different hex values (deeper tier preserved)", () => {
    expect(colorNameToHex("red")).not.toBe(colorNameToHex("red_alt"));
    expect(colorNameToHex("blue")).not.toBe(colorNameToHex("blue_alt"));
  });

  it("returns undefined for unknown color names", () => {
    expect(colorNameToHex("magenta")).toBeUndefined();
  });
});

describe("lookupPriorityColor", () => {
  // Minimal fake db that mimics the better-sqlite3 prepare/get shape.
  function fakeDb(rows) {
    return {
      prepare(sql) {
        return {
          get(appId, id) {
            return rows.find((r) => r.app_id === appId && r.id === id);
          },
        };
      },
    };
  }

  it("returns the color name when row exists", () => {
    const db = fakeDb([{ app_id: "A1", id: "p1", color: "red_alt" }]);
    expect(lookupPriorityColor(db, "A1", "p1")).toBe("red_alt");
  });

  it("returns empty string when priorityId is missing", () => {
    const db = fakeDb([]);
    expect(lookupPriorityColor(db, "A1", "")).toBe("");
    expect(lookupPriorityColor(db, "A1", null)).toBe("");
  });

  it("returns empty string when row not found", () => {
    const db = fakeDb([]);
    expect(lookupPriorityColor(db, "A1", "p_nonexistent")).toBe("");
  });

  it("returns empty string on db errors instead of throwing", () => {
    const db = {
      prepare() { throw new Error("simulated failure"); },
    };
    expect(lookupPriorityColor(db, "A1", "p1")).toBe("");
  });
});
