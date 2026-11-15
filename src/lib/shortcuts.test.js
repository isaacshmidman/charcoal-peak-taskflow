import { describe, expect, it } from "vitest";
import {
  G_SEQUENCES,
  isTypingTarget,
  isModalOpen,
  navPathForDigit,
} from "./shortcuts";

describe("shortcuts core", () => {
  describe("isTypingTarget", () => {
    it("true for inputs, textareas, selects", () => {
      expect(isTypingTarget(document.createElement("input"))).toBe(true);
      expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
      expect(isTypingTarget(document.createElement("select"))).toBe(true);
    });

    it("true for contenteditable hosts and their descendants (TipTap)", () => {
      const host = document.createElement("div");
      host.setAttribute("contenteditable", "true");
      const child = document.createElement("p");
      host.appendChild(child);
      document.body.appendChild(host);
      expect(isTypingTarget(host)).toBe(true);
      expect(isTypingTarget(child)).toBe(true);
      document.body.removeChild(host);
    });

    it("false for plain elements and null", () => {
      expect(isTypingTarget(document.createElement("div"))).toBe(false);
      expect(isTypingTarget(document.createElement("button"))).toBe(false);
      expect(isTypingTarget(null)).toBe(false);
    });
  });

  describe("isModalOpen", () => {
    it("detects open Radix dialogs and alert-dialogs", () => {
      expect(isModalOpen()).toBe(false);
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("data-state", "open");
      document.body.appendChild(dialog);
      expect(isModalOpen()).toBe(true);
      dialog.setAttribute("data-state", "closed");
      expect(isModalOpen()).toBe(false);
      document.body.removeChild(dialog);
    });
  });

  describe("navPathForDigit", () => {
    const order = ["/Today", "/Calendar", "/Active", "/Groupings", "/Completed"];

    it("maps 1–5 to the given sidebar order", () => {
      expect(navPathForDigit("1", order)).toBe("/Today");
      expect(navPathForDigit("2", order)).toBe("/Calendar");
      expect(navPathForDigit("5", order)).toBe("/Completed");
    });

    it("returns null out of range", () => {
      expect(navPathForDigit("6", order)).toBe(null);
      expect(navPathForDigit("0", order)).toBe(null);
      expect(navPathForDigit("x", order)).toBe(null);
    });

    it("falls back to the default order without localStorage", () => {
      // happy-dom provides localStorage; no navOrder key set → defaults.
      localStorage.removeItem("navOrder");
      expect(typeof navPathForDigit("1")).toBe("string");
    });

    it("respects a custom persisted order", () => {
      localStorage.setItem(
        "navOrder",
        JSON.stringify(["/Calendar", "/Today", "/Active", "/Groupings", "/Completed"])
      );
      // Home, added since this order was saved, leads; the rest is theirs.
      expect(navPathForDigit("1")).toBe("/Home");
      expect(navPathForDigit("2")).toBe("/Calendar");
      expect(navPathForDigit("3")).toBe("/Today");
      localStorage.setItem("navOrder", JSON.stringify(["/Calendar", "/Home", "/Today", "/Active", "/Notes"]));
      expect(navPathForDigit("1")).toBe("/Calendar");
      expect(navPathForDigit("2")).toBe("/Home");
      localStorage.removeItem("navOrder");
    });
  });

  describe("G_SEQUENCES", () => {
    it("covers every nav destination + settings", () => {
      expect(G_SEQUENCES).toEqual({
        h: "/Home",
        t: "/Today",
        a: "/Active",
        g: "/Groupings",
        c: "/Calendar",
        d: "/Completed",
        n: "/Notes",
        s: "/Settings",
      });
    });
  });
});

describe("a request made before its page was listening", () => {
  it("waits for that page, and is handed over once", async () => {
    const { emitShortcut, hearShortcut, SHORTCUT_EVENTS } = await import("./shortcuts");
    window.history.replaceState({}, "", "/Today");
    emitShortcut(SHORTCUT_EVENTS.newTask, { from: "plus" });
    const got = [];
    const stop = hearShortcut(SHORTCUT_EVENTS.newTask, (detail) => got.push(detail));
    expect(got).toEqual([{ from: "plus" }]);
    // Not again for a second listener, and with someone listening it is sent the ordinary way.
    const stopSecond = hearShortcut(SHORTCUT_EVENTS.newTask, (detail) => got.push(detail));
    expect(got).toHaveLength(1);
    let heard = 0;
    const onEvent = () => { heard += 1; };
    window.addEventListener(SHORTCUT_EVENTS.newTask, onEvent);
    emitShortcut(SHORTCUT_EVENTS.newTask);
    window.removeEventListener(SHORTCUT_EVENTS.newTask, onEvent);
    expect(heard).toBe(1);
    stop();
    stopSecond();
  });

  it("is dropped if the person has gone to another page meanwhile", async () => {
    const { emitShortcut, hearShortcut, SHORTCUT_EVENTS } = await import("./shortcuts");
    window.history.replaceState({}, "", "/Completed");
    emitShortcut(SHORTCUT_EVENTS.newTask);
    window.history.replaceState({}, "", "/Today");
    const got = [];
    hearShortcut(SHORTCUT_EVENTS.newTask, (detail) => got.push(detail))();
    expect(got).toEqual([]);
  });

  it("only keeps requests a person would press again: a search key is not kept", async () => {
    const { emitShortcut, hearShortcut, SHORTCUT_EVENTS } = await import("./shortcuts");
    emitShortcut(SHORTCUT_EVENTS.search);
    const got = [];
    hearShortcut(SHORTCUT_EVENTS.search, (detail) => got.push(detail))();
    expect(got).toEqual([]);
  });
});
