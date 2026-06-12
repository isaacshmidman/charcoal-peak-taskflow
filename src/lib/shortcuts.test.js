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
      expect(navPathForDigit("1")).toBe("/Calendar");
      expect(navPathForDigit("2")).toBe("/Today");
      localStorage.removeItem("navOrder");
    });
  });

  describe("G_SEQUENCES", () => {
    it("covers every nav destination + settings", () => {
      expect(G_SEQUENCES).toEqual({
        t: "/Today",
        a: "/Active",
        g: "/Groupings",
        c: "/Calendar",
        d: "/Completed",
        s: "/Settings",
      });
    });
  });
});
