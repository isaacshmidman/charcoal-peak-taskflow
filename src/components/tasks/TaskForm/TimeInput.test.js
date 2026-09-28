import { describe, expect, it } from "vitest";
import { addMinutes, defaultEndTime } from "./TimeInput.jsx";

describe("defaultEndTime", () => {
  it("is an hour after the start", () => {
    expect(defaultEndTime("9:00AM")).toBe("10:00AM");
    expect(defaultEndTime("11:30AM")).toBe("12:30PM");
    expect(defaultEndTime("10:45PM")).toBe("11:45PM");
  });

  it("stops at 11:59 PM instead of wrapping to an end before the start", () => {
    // addMinutes wraps, which is what produced a 12:30 AM end for 11:30 PM.
    expect(addMinutes("11:30PM", 60)).toBe("12:30AM");
    expect(defaultEndTime("11:30PM")).toBe("11:59PM");
    expect(defaultEndTime("11:00PM")).toBe("11:59PM");
    expect(defaultEndTime("11:45PM")).toBe("11:59PM");
  });
});
