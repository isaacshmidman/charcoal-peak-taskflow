import { DEFAULT_NAV_ORDER, navRouteFor, sanitizeNavOrder, sanitizeNavRoute } from "./navigation";

describe("navigation helpers", () => {
  it("opens on Home for someone who never chose a page, and keeps a choice", () => {
    expect(sanitizeNavRoute("/Today")).toBe("/Today");
    expect(sanitizeNavRoute("/Home")).toBe("/Home");
    expect(sanitizeNavRoute(null)).toBe("/Home");
    expect(sanitizeNavRoute("/NotARealRoute")).toBe("/Home");
  });

  it("still opens on the board or Completed for someone who chose it", () => {
    expect(sanitizeNavRoute("/Groupings")).toBe("/Groupings");
    expect(sanitizeNavRoute("/Completed")).toBe("/Completed");
  });

  it("dedupes valid routes and puts back what is missing", () => {
    // An order saved when the board and Completed were places of their
    // own heals itself: they drop out, and anything missing comes back.
    expect(sanitizeNavOrder(["/Completed", "/Notes", "/Notes", "/Today", "/Groupings", "/Bogus"])).toEqual([
      "/Home",
      "/Notes",
      "/Today",
      "/Calendar",
      "/Active",
    ]);
  });

  it("adds Home to the top of an order saved before Home existed, once", () => {
    const before = ["/Calendar", "/Today", "/Active", "/Notes"];
    expect(sanitizeNavOrder(before)).toEqual(["/Home", ...before]);
    // Someone who has since moved Home keeps it where they put it.
    const moved = ["/Calendar", "/Today", "/Home", "/Active", "/Notes"];
    expect(sanitizeNavOrder(moved)).toEqual(moved);
  });

  it("puts a missing place back after the one it follows by default", () => {
    expect(sanitizeNavOrder(["/Notes", "/Home", "/Today", "/Active"])).toEqual(["/Notes", "/Home", "/Today", "/Calendar", "/Active"]);
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
