import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "./pasteMarkdown";

describe("looksLikeMarkdown", () => {
  it("recognises block structure", () => {
    for (const md of [
      "# Heading",
      "## Sub heading",
      "- one\n- two",
      "* one",
      "1. first\n2. second",
      "> quoted",
      "```\ncode\n```",
      "---",
      "[ ] a task",
    ]) {
      expect(looksLikeMarkdown(md), md).toBe(true);
    }
  });

  it("recognises paired inline delimiters", () => {
    for (const md of ["**bold**", "__bold__", "some *italic* text", "~~gone~~", "`code`", "see [docs](https://x.dev)"]) {
      expect(looksLikeMarkdown(md), md).toBe(true);
    }
  });

  it("leaves ordinary prose alone", () => {
    // Over-eagerness is the real failure mode: reinterpreting plain text
    // mangles what someone actually pasted.
    for (const plain of [
      "Just a normal sentence.",
      "Call Bob about the 3 * 4 estimate",
      "a_variable_name in code",
      "5 - 3 = 2",
      "Prices went up 10% - watch out",
      "meet at 3.30 tomorrow",
      "TODO buy milk",
      "",
      "   ",
    ]) {
      expect(looksLikeMarkdown(plain), plain).toBe(false);
    }
  });

  it("does not treat an unpaired delimiter as markdown", () => {
    expect(looksLikeMarkdown("2 * 3 is six")).toBe(false);
    expect(looksLikeMarkdown("a ** b")).toBe(false);
    expect(looksLikeMarkdown("backtick ` alone")).toBe(false);
  });

  it("handles non-strings without throwing", () => {
    expect(looksLikeMarkdown(null)).toBe(false);
    expect(looksLikeMarkdown(undefined)).toBe(false);
    expect(looksLikeMarkdown(/** @type {any} */ (42))).toBe(false);
  });
});
