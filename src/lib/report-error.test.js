import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError, resetErrorReports } from "./report-error";

describe("reportError", () => {
  let fetchMock;
  beforeEach(() => {
    resetErrorReports();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/Active?tag=private-thing");
  });
  afterEach(() => vi.unstubAllGlobals());

  const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

  it("sends what broke and where, without the address's query", () => {
    expect(reportError("render", new TypeError("x is not a function"))).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/apps\/[^/]+\/client-errors$/);
    const body = sentBody();
    expect(body).toMatchObject({ kind: "render", message: "x is not a function", page: "/Active" });
    expect(JSON.stringify(body)).not.toContain("private-thing");
  });

  it("sends the same error once, and only a handful per visit", () => {
    expect(reportError("render", new Error("same"))).toBe(true);
    expect(reportError("render", new Error("same"))).toBe(false);
    for (let i = 0; i < 10; i += 1) reportError("error", new Error(`different ${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("stays quiet offline, and never throws when the report itself fails", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    expect(reportError("error", new Error("offline one"))).toBe(false);
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    fetchMock.mockImplementation(() => Promise.reject(new Error("no route")));
    expect(() => reportError("error", new Error("server is down"))).not.toThrow();
  });
});
