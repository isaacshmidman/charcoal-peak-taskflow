import { describe, expect, it } from "vitest";
import { canCollapseAllDay, COLLAPSED_ALLDAY_VISIBLE } from "./allday-collapse";

/**
 * The rule exists because of arithmetic, so the arithmetic is what's
 * pinned: a hidden row is 26px, the "N more" button that replaces them
 * is 24px. Hiding one row nets 2px, which looked like the expand toggle
 * doing nothing.
 */
const ROW = 26;
const MORE_BUTTON = 24;
const collapsedHeight = (n) =>
  canCollapseAllDay(n) ? COLLAPSED_ALLDAY_VISIBLE * ROW + MORE_BUTTON : n * ROW;

describe("canCollapseAllDay", () => {
  it("does not collapse when only one row would be hidden", () => {
    // Three tasks: 2 shown + a button was 84px against 78px expanded.
    expect(canCollapseAllDay(3)).toBe(false);
  });

  it("does not collapse when there is nothing to hide", () => {
    expect(canCollapseAllDay(0)).toBe(false);
    expect(canCollapseAllDay(1)).toBe(false);
    expect(canCollapseAllDay(2)).toBe(false);
  });

  it("collapses once two or more rows would be hidden", () => {
    expect(canCollapseAllDay(4)).toBe(true);
    expect(canCollapseAllDay(9)).toBe(true);
  });

  it("only collapses when doing so is actually shorter", () => {
    // The property the rule is really protecting: collapsing must never
    // leave the strip the same height (or taller) than showing it all.
    for (let n = 0; n <= 12; n++) {
      const expanded = n * ROW;
      if (canCollapseAllDay(n)) {
        expect(collapsedHeight(n), `n=${n}`).toBeLessThan(expanded);
        // And meaningfully shorter, not by a hair.
        expect(expanded - collapsedHeight(n), `n=${n}`).toBeGreaterThanOrEqual(ROW);
      } else {
        expect(collapsedHeight(n), `n=${n}`).toBe(expanded);
      }
    }
  });
});
