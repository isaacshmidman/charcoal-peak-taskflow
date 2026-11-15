import {
  DEFAULT_NAV_ORDER,
  navRouteFor,
  placePath,
  readStartSettings,
  sanitizeNavOrder,
  sanitizeNavRoute,
  saveStartSettings,
  startPath,
  tagsPath,
  tasksPath,
} from "./navigation";

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

describe("how the app and Tasks open", () => {
  beforeEach(() => window.localStorage.clear());

  it("opens on Home with Tasks as the list for someone who chose nothing", () => {
    expect(readStartSettings()).toEqual({ start: "/Home", tasksView: "list" });
    expect(startPath()).toBe("/Home");
    expect(tasksPath()).toBe("/Active");
    expect(tagsPath()).toBe("/Active");
  });

  it("sends the Tasks link to the chosen view, and leaves other places alone", () => {
    saveStartSettings({ tasksView: "board" });
    expect(placePath("/Active")).toBe("/Groupings");
    expect(placePath("/Calendar")).toBe("/Calendar");
    expect(startPath()).toBe("/Home");
    saveStartSettings({ tasksView: "completed" });
    expect(placePath("/Active")).toBe("/Completed");
  });

  it("opens the app in Tasks' chosen view when Tasks is the start page", () => {
    saveStartSettings({ start: "/Active", tasksView: "board" });
    expect(startPath()).toBe("/Groupings");
  });

  it("leads a tag to the board for someone who opens Tasks as the board, never to Completed", () => {
    saveStartSettings({ tasksView: "board" });
    expect(tagsPath()).toBe("/Groupings");
    saveStartSettings({ tasksView: "completed" });
    expect(tagsPath()).toBe("/Active");
  });

  it("reads an old start page of the board as Tasks opening as the board", () => {
    window.localStorage.setItem("defaultNav", "/Groupings");
    expect(readStartSettings()).toEqual({ start: "/Active", tasksView: "board" });
    expect(startPath()).toBe("/Groupings");
    // Changing the start page keeps the view it implied, and tidies the old value.
    saveStartSettings({ start: "/Today" });
    expect(window.localStorage.getItem("defaultNav")).toBe("/Today");
    expect(readStartSettings()).toEqual({ start: "/Today", tasksView: "board" });
  });

  it("lets a view chosen since win over the old start page", () => {
    window.localStorage.setItem("defaultNav", "/Completed");
    window.localStorage.setItem("defaultTasksView", "list");
    expect(readStartSettings()).toEqual({ start: "/Active", tasksView: "list" });
  });

  it("ignores a view it does not know, and tells the navigation about a change", () => {
    window.localStorage.setItem("defaultTasksView", "kanban");
    expect(tasksPath()).toBe("/Active");
    let told = 0;
    const heard = () => { told += 1; };
    window.addEventListener("navOrderChanged", heard);
    saveStartSettings({ tasksView: "board" });
    window.removeEventListener("navOrderChanged", heard);
    expect(told).toBe(1);
  });
});
