// @ts-check
import { describe, expect, it } from "vitest";
import { HttpStatusError } from "./http-status-error.js";

describe("HttpStatusError", () => {
  it("preserves message and statusCode", () => {
    const err = new HttpStatusError("Boom", 503);
    expect(err.message).toBe("Boom");
    expect(err.statusCode).toBe(503);
  });

  it("is instanceof Error and HttpStatusError", () => {
    const err = new HttpStatusError("x", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpStatusError);
  });

  it("has name HttpStatusError", () => {
    const err = new HttpStatusError("x", 400);
    expect(err.name).toBe("HttpStatusError");
  });
});
