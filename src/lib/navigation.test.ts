import { DEFAULT_NAV_ORDER, sanitizeNavOrder, sanitizeNavRoute } from "./navigation";

describe("navigation helpers", () => {
  it("falls back to Today for invalid default routes", () => {
    expect(sanitizeNavRoute("/Today")).toBe("/Today");
    expect(sanitizeNavRoute("/NotARealRoute")).toBe("/Today");
  });

  it("dedupes valid routes and appends missing defaults", () => {
    // A saved pre-/Notes order self-heals: new routes append at the end.
    expect(sanitizeNavOrder(["/Completed", "/Completed", "/Today", "/Bogus"])).toEqual([
      "/Completed",
      "/Today",
      "/Groupings",
      "/Calendar",
      "/Active",
      "/Notes",
    ]);
  });

  it("returns the full default order when storage is empty or invalid", () => {
    expect(sanitizeNavOrder(undefined)).toEqual(DEFAULT_NAV_ORDER);
    expect(sanitizeNavOrder(null)).toEqual(DEFAULT_NAV_ORDER);
  });
});
