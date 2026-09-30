import { safeInAppPath } from "./navigation";

describe("safeInAppPath", () => {
  const origin = "https://zephyrly.app";
  it("keeps this site's own pages", () => {
    expect(safeInAppPath("/Today", origin)).toBe("/Today");
    expect(safeInAppPath("https://zephyrly.app/Notes?x=1#y", origin)).toBe("/Notes?x=1#y");
  });

  it("refuses anything the router would take to another site", () => {
    for (const raw of [
      "https://evil.example/login",
      "//evil.example",
      "\\\\evil.example",
      "/\\evil.example",
      "https://zephyrly.app//evil.example",
      "https://zephyrly.app/\\evil.example",
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(safeInAppPath(raw, origin), String(raw)).toBeNull();
    }
  });
});
