/* @vitest-environment node */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readJsonBody, sameOriginUrl } from "./http.js";

/** A request-shaped stream: chunks plus the headers readJsonBody reads. */
function requestOf(chunks, headers = {}) {
  const request = /** @type {any} */ (Readable.from(chunks.map((c) => Buffer.from(c))));
  request.headers = headers;
  return request;
}

describe("readJsonBody", () => {
  it("parses a body under the cap", async () => {
    await expect(readJsonBody(requestOf(['{"a":', "1}"]), { maxBytes: 100 })).resolves.toEqual({ a: 1 });
  });

  it("returns null for an empty body and 400s on bad JSON", async () => {
    await expect(readJsonBody(requestOf([]))).resolves.toBeNull();
    await expect(readJsonBody(requestOf(["{nope"]))).rejects.toMatchObject({ status: 400, code: "invalid_json" });
  });

  it("refuses a declared Content-Length over the cap without reading", async () => {
    const request = requestOf(["{}"], { "content-length": "5000" });
    let read = false;
    request.on("data", () => { read = true; });
    request.pause();
    await expect(readJsonBody(request, { maxBytes: 100 })).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
    expect(read).toBe(false);
  });

  it("stops buffering once a streamed body passes the cap, even with no Content-Length", async () => {
    const chunk = "x".repeat(60);
    // Four chunks of 60 bytes against a cap of 100: rejected on the second.
    await expect(readJsonBody(requestOf([chunk, chunk, chunk, chunk]), { maxBytes: 100 })).rejects.toMatchObject({
      status: 413,
    });
  });

  it("defaults to a small cap for ordinary routes", async () => {
    const big = JSON.stringify({ password: "x".repeat(70 * 1024) });
    await expect(readJsonBody(requestOf([big]))).rejects.toMatchObject({ status: 413 });
  });
});

describe("sameOriginUrl", () => {
  const APP = "https://zephyrly.app";

  it("keeps paths and same-origin URLs", () => {
    expect(sameOriginUrl("/Today", APP)).toBe("https://zephyrly.app/Today");
    expect(sameOriginUrl("https://zephyrly.app/auth/callback?next=%2FToday", APP)).toBe(
      "https://zephyrly.app/auth/callback?next=%2FToday"
    );
  });

  it("sends anything off-site back to the fallback on this origin", () => {
    for (const hostile of [
      "https://evil.example/login",
      "//evil.example/login",
      "https://zephyrly.app.evil.example/",
      "javascript:alert(1)",
      "http://zephyrly.app/Today", // a different scheme is a different origin
    ]) {
      expect(sameOriginUrl(hostile, APP, "/login")).toBe("https://zephyrly.app/login");
    }
  });

  it("uses the fallback for missing or blank targets", () => {
    expect(sameOriginUrl(null, APP, "/Settings")).toBe("https://zephyrly.app/Settings");
    expect(sameOriginUrl("   ", APP)).toBe("https://zephyrly.app/");
  });
});
