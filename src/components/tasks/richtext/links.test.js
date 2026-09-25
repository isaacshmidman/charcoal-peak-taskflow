import { describe, expect, it, vi } from "vitest";
import { isAllowedLink, linkLabel, normalizeLinkInput, openLink, safeHref, shouldAutoLink } from "./links";

describe("safeHref", () => {
  it("allows absolute http, https and mailto", () => {
    expect(safeHref("https://zoom.us/j/123?pwd=x")).toBe("https://zoom.us/j/123?pwd=x");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    expect(safeHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
  });

  it("refuses every other scheme, relative paths and junk", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "tel:+15551234",
      "ftp://example.com",
      "/Today",
      "//evil.example",
      "#section",
      "zoom.us/j/1", // no scheme: normalizeLinkInput's job, not a stored href
      "https://",
      "",
      null,
      42,
    ]) {
      expect(safeHref(hostile)).toBeNull();
    }
  });
});

describe("normalizeLinkInput", () => {
  it("adds https:// to a bare domain and mailto: to a bare email", () => {
    expect(normalizeLinkInput("zoom.us/j/1")).toBe("https://zoom.us/j/1");
    expect(normalizeLinkInput(" www.example.com ")).toBe("https://www.example.com/");
    expect(normalizeLinkInput("me@example.com")).toBe("mailto:me@example.com");
  });

  it("keeps full URLs and refuses what isn't an address", () => {
    expect(normalizeLinkInput("https://meet.google.com/abc")).toBe("https://meet.google.com/abc");
    expect(normalizeLinkInput("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkInput("just words")).toBeNull();
    expect(normalizeLinkInput("hello")).toBeNull();
    expect(normalizeLinkInput("")).toBeNull();
  });

  it("is what the editor asks before making anything a link", () => {
    expect(isAllowedLink("zoom.us/j/1")).toBe(true);
    expect(isAllowedLink("data:text/html,x")).toBe(false);
  });
});

describe("linkLabel", () => {
  it("shows the real destination without the scheme", () => {
    expect(linkLabel("https://zoom.us/j/123?pwd=abc")).toBe("zoom.us/j/123?pwd=abc");
    expect(linkLabel("https://example.com/")).toBe("example.com");
    expect(linkLabel("mailto:someone@example.com")).toBe("someone@example.com");
  });

  it("truncates long addresses and shows nothing for unsafe ones", () => {
    const label = linkLabel(`https://example.com/${"a".repeat(100)}`, 30);
    expect(label).toHaveLength(30);
    expect(label.endsWith("…")).toBe(true);
    expect(linkLabel("javascript:alert(1)")).toBe("");
  });
});

describe("openLink", () => {
  it("opens safe links in a new tab with no opener, and refuses the rest", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(openLink("https://zoom.us/j/1")).toBe(true);
    expect(open).toHaveBeenCalledWith("https://zoom.us/j/1", "_blank", "noopener,noreferrer");
    expect(openLink("javascript:alert(1)")).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("shouldAutoLink", () => {
  it("links only unmistakable addresses", () => {
    for (const yes of ["https://zoom.us/j/1", "http://x.io", "www.example.com", "me@example.com", "zoom.us/j/123", "mailto:a@b.co"]) {
      expect(shouldAutoLink(yes)).toBe(true);
    }
    for (const no of ["notes.md", "setup.sh", "main.rs", "clip.mov", "archive.zip", "example.com", "javascript:alert(1)", "hello"]) {
      expect(shouldAutoLink(no)).toBe(false);
    }
  });
});
