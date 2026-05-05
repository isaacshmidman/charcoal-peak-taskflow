import { describe, expect, it } from "vitest";
import {
  customPartsToOffset,
  nativeTimeToTaskTime,
  normalizeNotificationSettings,
  offsetToCustomParts,
  taskTimeToNativeTime,
} from "./notifications";

describe("notification settings helpers", () => {
  it("normalizes settings and clamps custom offsets", () => {
    expect(
      normalizeNotificationSettings({
        enabled: true,
        timedOffsetMinutes: -999999,
        missedGraceMinutes: 999999,
        allDayTime: "bad",
      })
    ).toMatchObject({
      enabled: true,
      timedOffsetMinutes: -10080,
      missedGraceMinutes: 1440,
      allDayTime: "9:00AM",
    });
  });

  it("converts native time input values to Zephyrly task time strings", () => {
    expect(nativeTimeToTaskTime("00:00")).toBe("12:00AM");
    expect(nativeTimeToTaskTime("13:05")).toBe("1:05PM");
    expect(taskTimeToNativeTime("9:30AM")).toBe("09:30");
    expect(taskTimeToNativeTime("12:15PM")).toBe("12:15");
  });

  it("converts custom before and after offsets", () => {
    expect(customPartsToOffset({ direction: "before", amount: 2, unit: "hours" })).toBe(-120);
    expect(customPartsToOffset({ direction: "after", amount: 1, unit: "days" })).toBe(1440);
    expect(offsetToCustomParts(-120)).toEqual({ direction: "before", amount: 2, unit: "hours" });
    expect(offsetToCustomParts(1440)).toEqual({ direction: "after", amount: 1, unit: "days" });
  });
});
