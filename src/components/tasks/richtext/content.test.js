import { describe, expect, it } from "vitest";
import {
  initialContentFrom,
  normalizeOutput,
  countWords,
  WORD_LIMIT,
} from "./content";

describe("richtext content helpers", () => {
  describe("initialContentFrom", () => {
    it("parses a stored ProseMirror JSON string into an object", () => {
      const doc = { type: "doc", content: [{ type: "paragraph" }] };
      expect(initialContentFrom(JSON.stringify(doc), "")).toEqual(doc);
    });

    it("falls back to the plaintext mirror when JSON is empty", () => {
      expect(initialContentFrom("", "hello world")).toBe("hello world");
      expect(initialContentFrom(null, "legacy note")).toBe("legacy note");
      expect(initialContentFrom(undefined, "legacy note")).toBe("legacy note");
    });

    it("falls back to plaintext when JSON is malformed", () => {
      expect(initialContentFrom("{not json", "plain")).toBe("plain");
    });

    it("returns empty string when both are empty", () => {
      expect(initialContentFrom("", "")).toBe("");
      expect(initialContentFrom(null, null)).toBe("");
    });

    it("prefers JSON over plaintext when both present", () => {
      const doc = { type: "doc", content: [] };
      expect(initialContentFrom(JSON.stringify(doc), "ignored")).toEqual(doc);
    });
  });

  describe("normalizeOutput", () => {
    it("empty doc → both fields empty (not an empty-paragraph blob)", () => {
      const json = { type: "doc", content: [{ type: "paragraph" }] };
      expect(normalizeOutput({ isEmpty: true, json, text: "" })).toEqual({ json: "", text: "" });
    });

    it("whitespace-only text → both empty", () => {
      const json = { type: "doc", content: [{ type: "paragraph" }] };
      expect(normalizeOutput({ isEmpty: false, json, text: "   \n  " })).toEqual({ json: "", text: "" });
    });

    it("non-empty doc → stringified json + trimmed text", () => {
      const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
      const out = normalizeOutput({ isEmpty: false, json, text: "  hi  " });
      expect(out.text).toBe("hi");
      expect(JSON.parse(out.json)).toEqual(json);
    });
  });

  describe("countWords", () => {
    it("counts whitespace-delimited words", () => {
      expect(countWords("")).toBe(0);
      expect(countWords("   ")).toBe(0);
      expect(countWords("one")).toBe(1);
      expect(countWords("one two   three\nfour")).toBe(4);
    });

    it("WORD_LIMIT is 500", () => {
      expect(WORD_LIMIT).toBe(500);
    });
  });
});
