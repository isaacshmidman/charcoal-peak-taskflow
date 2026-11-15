import { describe, expect, it } from "vitest";
import { awaitingFirstAnswer } from "./loading";

describe("awaitingFirstAnswer", () => {
  it("is loading while a query has nothing at all", () => {
    expect(awaitingFirstAnswer({ isLoading: true, isFetching: true })).toBe(true);
  });

  it("is still loading when the only thing to show is the empty stand-in and the server hasn't answered", () => {
    expect(awaitingFirstAnswer({ isLoading: false, isFetching: true, dataUpdatedAt: 0, data: [] })).toBe(true);
  });

  it("shows a kept copy with rows in it straight away, while the server is asked", () => {
    expect(awaitingFirstAnswer({ isLoading: false, isFetching: true, dataUpdatedAt: 0, data: [{ id: "a" }] })).toBe(false);
  });

  it("an empty answer from the server is an answer: the list really is empty", () => {
    expect(awaitingFirstAnswer({ isLoading: false, isFetching: false, dataUpdatedAt: 1700000000000, data: [] })).toBe(false);
    // Asked again later (coming back to the tab): still empty, not loading.
    expect(awaitingFirstAnswer({ isLoading: false, isFetching: true, dataUpdatedAt: 1700000000000, data: [] })).toBe(false);
  });

  it("with no connection nothing is being asked, so an empty copy is shown as empty", () => {
    expect(awaitingFirstAnswer({ isLoading: false, isFetching: false, dataUpdatedAt: 0, data: [] })).toBe(false);
  });
});
