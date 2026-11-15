import { DEFAULT_NAV_ORDER, navRouteFor, sanitizeNavOrder, sanitizeNavRoute } from "./navigation";

describe("navigation helpers", () => {
  it("falls back to Today for invalid default routes", () => {
    expect(sanitizeNavRoute("/Today")).toBe("/Today");
    expect(sanitizeNavRoute("/NotARealRoute")).toBe("/Today");
  });

  it("still opens on the board or Completed for someone who chose it", () => {
    expect(sanitizeNavRoute("/Groupings")).toBe("/Groupings");
    expect(sanitizeNavRoute("/Completed")).toBe("/Completed");
  });

  it("dedupes valid routes and appends missing defaults", () => {
    // An order saved when the board and Completed were places of their
    // own heals itself: they drop out, and anything missing is appended.
    expect(sanitizeNavOrder(["/Completed", "/Notes", "/Notes", "/Today", "/Groupings", "/Bogus"])).toEqual([
      "/Notes",
      "/Today",
      "/Calendar",
      "/Active",
    ]);
  });

  it("lights up Tasks for the board and Completed", () => {
    expect(navRouteFor("/Groupings")).toBe("/Active");
    expect(navRouteFor("/Completed")).toBe("/Active");
    expect(navRouteFor("/Active")).toBe("/Active");
    expect(navRouteFor("/Calendar")).toBe("/Calendar");
  });

  it("returns the full default order when storage is empty or invalid", () => {
    expect(sanitizeNavOrder(undefined)).toEqual(DEFAULT_NAV_ORDER);
    expect(sanitizeNavOrder(null)).toEqual(DEFAULT_NAV_ORDER);
  });
});
