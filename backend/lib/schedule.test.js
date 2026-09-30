import { describe, expect, it } from "vitest";
import {
  DAY,
  activeSchedule,
  changeEnd,
  changeStart,
  cleanDefaults,
  clearAll,
  clockParts,
  cutTime,
  describeChange,
  formatClock,
  formatRange,
  newSchedule,
  parseClock,
  parseSchedule,
  partsToMinutes,
  placeEntry,
  removeSlot,
  scheduleFromDefaults,
  scheduleProblem,
  schedulePreview,
  setDayBounds,
  setGap,
  setSlotLength,
  setSlotText,
  settingsOf,
  splitSlot,
} from "./schedule.js";

const h = (hours, minutes = 0) => hours * 60 + minutes;
const ranges = (s) => s.slots.map((slot) => formatRange(slot));
/** Unwraps a result, failing the test with its message if it was refused. */
const ok = (result) => {
  if (result.error) throw new Error(`refused: ${result.error}`);
  expect(scheduleProblem(result.schedule)).toBeNull();
  return result.schedule;
};
const indexAt = (s, start) => s.slots.findIndex((slot) => slot.start === start);
const fill = (s, start, text) => ok(setSlotText(s, indexAt(s, start), text));
const next = (s) => ({ ...s, cascade: "next" });

describe("a new schedule", () => {
  it("is every hour of the day, 12:00 AM – 1:00 AM to 11:00 PM – 12:00 AM, all empty", () => {
    const s = newSchedule();
    expect(scheduleProblem(s)).toBeNull();
    expect(s.slots).toHaveLength(24);
    expect(ranges(s)[0]).toBe("12:00 AM – 1:00 AM");
    expect(ranges(s)[1]).toBe("1:00 AM – 2:00 AM");
    expect(ranges(s)[12]).toBe("12:00 PM – 1:00 PM");
    expect(ranges(s)[23]).toBe("11:00 PM – 12:00 AM");
    expect(s.slots.every((slot) => slot.text === "")).toBe(true);
    expect(new Set(s.slots.map((slot) => slot.id)).size).toBe(24);
    expect(s).toMatchObject({ v: 1, enabled: true, gap: 0, slot: 60, cascade: "shift", now: true });
  });
});

describe("changing an end", () => {
  it("7:00 – 8:00 AM ending at 7:30 AM moves every slot after it half an hour earlier", () => {
    const before = newSchedule();
    const s = ok(changeEnd(before, 7, h(7, 30)));
    expect(ranges(s).slice(6, 10)).toEqual(["6:00 AM – 7:00 AM", "7:00 AM – 7:30 AM", "7:30 AM – 8:30 AM", "8:30 AM – 9:30 AM"]);
    // The half hour freed at the end of the day is still there, as empty time on the clock.
    expect(ranges(s).slice(-2)).toEqual(["10:30 PM – 11:00 PM", "11:00 PM – 12:00 AM"]);
    expect(describeChange(before, s, before.slots[7].id)).toBe("Adjusted 16 other slots and added 1 empty slot.");
  });

  it("with “only the next slot”, 7:30 AM stretches the 8:00 slot back and moves nothing else", () => {
    const before = next(newSchedule());
    const s = ok(changeEnd(before, 7, h(7, 30)));
    expect(ranges(s).slice(6, 10)).toEqual(["6:00 AM – 7:00 AM", "7:00 AM – 7:30 AM", "7:30 AM – 9:00 AM", "9:00 AM – 10:00 AM"]);
    expect(s.slots).toHaveLength(24);
    expect(describeChange(before, s, before.slots[7].id)).toBe("Adjusted 1 other slot.");
  });

  it("has to stay after the start", () => {
    expect(changeEnd(newSchedule(), 7, h(7))).toEqual({ error: "The end has to be after the start (7:00 AM)." });
    expect(changeEnd(newSchedule(), 7, h(6, 59)).error).toBe("The end has to be after the start (7:00 AM).");
    expect(changeEnd(newSchedule(), 7, DAY + 1).error).toBe("A schedule ends by midnight.");
  });

  it("later pushes the slots after it, and the empty ones at the end of the day give way", () => {
    const s = ok(changeEnd(newSchedule(), 7, h(9)));
    expect(ranges(s).slice(7, 9)).toEqual(["7:00 AM – 9:00 AM", "9:00 AM – 10:00 AM"]);
    expect(ranges(s).at(-1)).toBe("11:00 PM – 12:00 AM");
    expect(s.slots).toHaveLength(23);
  });

  it("won't push a filled slot out of the day", () => {
    const s = fill(newSchedule(), h(23), "Sleep");
    expect(changeEnd(s, 7, h(8, 30)).error).toBe("That would push “Sleep” past the end of the day (12:00 AM).");
  });

  it("with “only the next slot”, runs over empty slots but stops at a filled one", () => {
    const s = ok(changeEnd(next(newSchedule()), 7, h(9, 30)));
    expect(ranges(s).slice(7, 9)).toEqual(["7:00 AM – 9:30 AM", "9:30 AM – 10:00 AM"]);
    const busy = fill(next(newSchedule()), h(8), "Standup");
    expect(changeEnd(busy, 7, h(9, 30)).error).toBe(
      "“Standup” (8:00 AM – 9:00 AM) is in the way. Change that slot first, or choose “Move the slots after it” in Advanced settings."
    );
    // Moving into it, not over it, is fine: it gets shorter.
    expect(ranges(ok(changeEnd(busy, 7, h(8, 15)))).slice(7, 9)).toEqual(["7:00 AM – 8:15 AM", "8:15 AM – 9:00 AM"]);
  });

  it("on the last slot changes when the day ends", () => {
    const s = ok(changeEnd(newSchedule(), 23, h(23, 30)));
    expect(ranges(s).at(-1)).toBe("11:00 PM – 11:30 PM");
    expect(s.slots).toHaveLength(24);
  });
});

describe("changing a start", () => {
  it("earlier moves the slots before it earlier", () => {
    const s = ok(changeStart(newSchedule(), 8, h(7, 30)));
    expect(ranges(s).slice(0, 2)).toEqual(["12:00 AM – 12:30 AM", "12:30 AM – 1:30 AM"]);
    expect(ranges(s).slice(7, 9)).toEqual(["6:30 AM – 7:30 AM", "7:30 AM – 9:00 AM"]);
  });

  it("later moves them later, and the start of the day fills with empty time", () => {
    const s = ok(changeStart(newSchedule(), 8, h(8, 30)));
    // The new time at the start is cut on the hour, like the rest of the empty time.
    expect(ranges(s).slice(0, 3)).toEqual(["12:00 AM – 1:00 AM", "1:00 AM – 1:30 AM", "1:30 AM – 2:30 AM"]);
    expect(ranges(s).slice(8, 10)).toEqual(["7:30 AM – 8:30 AM", "8:30 AM – 9:00 AM"]);
  });

  it("has to stay before the end", () => {
    expect(changeStart(newSchedule(), 7, h(8)).error).toBe("The start has to be before the end (8:00 AM).");
  });

  it("with “only the next slot”, only the slot before changes", () => {
    const s = ok(changeStart(next(newSchedule()), 8, h(7, 30)));
    expect(ranges(s).slice(6, 9)).toEqual(["6:00 AM – 7:00 AM", "7:00 AM – 7:30 AM", "7:30 AM – 9:00 AM"]);
  });

  it("won't push a filled slot before the start of the day", () => {
    const s = fill(newSchedule(), 0, "Late film");
    expect(changeStart(s, 5, h(4, 30)).error).toBe("That would push “Late film” before the start of the day (12:00 AM).");
  });

  it("on the first slot changes when the day starts", () => {
    expect(ranges(ok(changeStart(newSchedule(), 0, h(0, 30))))[0]).toBe("12:30 AM – 1:00 AM");
  });
});

describe("the gap between slots", () => {
  it("5 minutes: every slot keeps its start and ends 5 minutes before the next", () => {
    const s = ok(setGap(newSchedule(), 5));
    expect(ranges(s).slice(0, 2)).toEqual(["12:00 AM – 12:55 AM", "1:00 AM – 1:55 AM"]);
    expect(ranges(s).at(-1)).toBe("11:00 PM – 12:00 AM");
    expect(s.gap).toBe(5);
  });

  it("30 minutes, then back to none", () => {
    const s = ok(setGap(newSchedule(), 30));
    expect(ranges(s).slice(0, 2)).toEqual(["12:00 AM – 12:30 AM", "1:00 AM – 1:30 AM"]);
    expect(ranges(ok(setGap(s, 0)))).toEqual(ranges(newSchedule()));
  });

  it("keeps working when times change afterwards", () => {
    const s = ok(changeEnd(ok(setGap(newSchedule(), 5)), 7, h(7, 30)));
    // The next slot moves up 25 minutes and keeps its 55.
    expect(ranges(s).slice(7, 9)).toEqual(["7:00 AM – 7:30 AM", "7:35 AM – 8:30 AM"]);
  });

  it("won't leave a filled slot with no time, and has to be shorter than a slot", () => {
    const s = ok(placeEntry(newSchedule(), h(7), h(7, 15), "Coffee"));
    expect(setGap(s, 30).error).toBe("A 30-minute gap leaves no time for “Coffee” (7:00 AM – 7:15 AM).");
    expect(setGap(newSchedule(), 60).error).toBe("The gap has to be shorter than a slot (60 minutes).");
  });
});

describe("slot length", () => {
  it("cuts empty time again, and leaves filled slots where they are", () => {
    const s = fill(ok(placeEntry(newSchedule(), h(7), h(7, 45), "Run")), h(12), "Lunch");
    const halves = ok(setSlotLength(s, 30));
    expect(halves.slot).toBe(30);
    expect(ranges(halves).slice(0, 2)).toEqual(["12:00 AM – 12:30 AM", "12:30 AM – 1:00 AM"]);
    const run = halves.slots.find((slot) => slot.text === "Run");
    const lunch = halves.slots.find((slot) => slot.text === "Lunch");
    expect([formatRange(run), formatRange(lunch)]).toEqual(["7:00 AM – 7:45 AM", "12:00 PM – 1:00 PM"]);
    // The empty time after Run lines up with the clock again.
    expect(ranges(halves).slice(indexAt(halves, h(7, 45)), indexAt(halves, h(7, 45)) + 2)).toEqual(["7:45 AM – 8:00 AM", "8:00 AM – 8:30 AM"]);
  });
});

describe("when the day starts and ends", () => {
  it("6:00 AM to 10:00 PM trims the night, and back again fills it", () => {
    const s = ok(setDayBounds(newSchedule(), h(6), h(22)));
    expect(ranges(s)[0]).toBe("6:00 AM – 7:00 AM");
    expect(ranges(s).at(-1)).toBe("9:00 PM – 10:00 PM");
    expect(s.slots).toHaveLength(16);
    expect(ranges(ok(setDayBounds(s, 0, DAY)))).toEqual(ranges(newSchedule()));
  });

  it("an edge in the middle of an empty slot cuts it short", () => {
    expect(ranges(ok(setDayBounds(newSchedule(), h(6, 30), h(21, 30))))[0]).toBe("6:30 AM – 7:00 AM");
  });

  it("won't drop a filled slot", () => {
    const s = fill(newSchedule(), h(5), "Gym");
    expect(setDayBounds(s, h(6), h(22)).error).toBe("“Gym” (5:00 AM – 6:00 AM) is outside 6:00 AM – 10:00 PM. Change or clear it first.");
    expect(setDayBounds(s, h(22), h(6)).error).toBe("The day has to end after it starts (10:00 PM).");
  });
});

describe("split and remove", () => {
  it("splits near the middle, on a round number, and keeps the text in the first half", () => {
    const s = ok(splitSlot(fill(newSchedule(), h(7), "Breakfast"), 7));
    expect(ranges(s).slice(7, 9)).toEqual(["7:00 AM – 7:30 AM", "7:30 AM – 8:00 AM"]);
    expect(s.slots[7].text).toBe("Breakfast");
    expect(s.slots[8].text).toBe("");
    const gapped = ok(splitSlot(ok(setGap(newSchedule(), 5)), 7));
    expect(ranges(gapped).slice(7, 9)).toEqual(["7:00 AM – 7:25 AM", "7:30 AM – 7:55 AM"]);
  });

  it("removing moves the slots after it up, or lets the slot before take its time", () => {
    const s = fill(newSchedule(), h(9), "Class");
    const moved = ok(removeSlot(s, 7));
    expect(moved.slots.find((slot) => slot.text === "Class").start).toBe(h(8));
    expect(ranges(moved).at(-1)).toBe("11:00 PM – 12:00 AM");
    const kept = ok(removeSlot(next(s), 7));
    expect(ranges(kept).slice(6, 8)).toEqual(["6:00 AM – 8:00 AM", "8:00 AM – 9:00 AM"]);
    expect(kept.slots.find((slot) => slot.text === "Class").start).toBe(h(9));
  });

  it("won't remove the only slot, or split one too short", () => {
    const one = ok(setDayBounds(newSchedule(), h(7), h(8)));
    expect(removeSlot(one, 0).error).toBe("A schedule needs at least one slot. Turn Schedule off instead.");
    expect(splitSlot(ok(changeEnd(one, 0, h(7, 1))), 0).error).toBe("That slot is too short to split.");
  });
});

describe("placing an entry at exact times", () => {
  it("puts it in, and cuts the empty time around it into slots", () => {
    const s = ok(placeEntry(newSchedule(), h(7), h(7, 30), "Breakfast"));
    expect(ranges(s).slice(6, 10)).toEqual(["6:00 AM – 7:00 AM", "7:00 AM – 7:30 AM", "7:30 AM – 8:00 AM", "8:00 AM – 9:00 AM"]);
    expect(s.slots[7].text).toBe("Breakfast");
  });

  it("spanning several slots, and at the same times as one replaces its text", () => {
    const s = ok(placeEntry(newSchedule(), h(9, 15), h(12, 45), "Exam"));
    expect(ranges(s).slice(9, 12)).toEqual(["9:00 AM – 9:15 AM", "9:15 AM – 12:45 PM", "12:45 PM – 1:00 PM"]);
    const renamed = ok(placeEntry(s, h(9, 15), h(12, 45), "Final exam"));
    expect(renamed.slots[10].text).toBe("Final exam");
    expect(renamed.slots).toHaveLength(s.slots.length);
  });

  it("won't run into a filled slot", () => {
    const s = fill(newSchedule(), h(8), "Standup");
    expect(placeEntry(s, h(7, 30), h(8, 15), "Walk").error).toBe("“Walk” (7:30 AM – 8:15 AM) runs into “Standup” (8:00 AM – 9:00 AM).");
  });

  it("keeps the gap either side", () => {
    const s = ok(placeEntry(ok(setGap(newSchedule(), 5)), h(7), h(7, 30), "Breakfast"));
    expect(ranges(s).slice(6, 10)).toEqual(["6:00 AM – 6:55 AM", "7:00 AM – 7:30 AM", "7:35 AM – 7:55 AM", "8:00 AM – 8:55 AM"]);
  });

  it("outside the day stretches it", () => {
    const short = ok(setDayBounds(newSchedule(), h(8), h(18)));
    const s = ok(placeEntry(short, h(19), h(20), "Dinner"));
    expect(ranges(s).slice(-2)).toEqual(["6:00 PM – 7:00 PM", "7:00 PM – 8:00 PM"]);
    const early = ok(placeEntry(short, h(6), h(7), "Gym"));
    expect(ranges(early).slice(0, 2)).toEqual(["6:00 AM – 7:00 AM", "7:00 AM – 8:00 AM"]);
  });

  it("clear all empties every slot and cuts the day again", () => {
    const s = ok(clearAll(ok(placeEntry(newSchedule(), h(7), h(7, 30), "Breakfast"))));
    expect(ranges(s)).toEqual(ranges(newSchedule()));
    expect(s.slots.every((slot) => !slot.text)).toBe(true);
  });
});

describe("times", () => {
  it("reads and writes the way the fields show them", () => {
    expect([formatClock(0), formatClock(h(7, 5)), formatClock(h(12)), formatClock(h(23, 59)), formatClock(DAY)]).toEqual([
      "12:00 AM",
      "7:05 AM",
      "12:00 PM",
      "11:59 PM",
      "12:00 AM",
    ]);
    expect(formatClock(h(19, 30), { compact: true })).toBe("7:30PM");
    expect(clockParts(DAY)).toEqual({ hour: 12, minute: 0, pm: false });
    expect(clockParts(h(13, 7))).toEqual({ hour: 1, minute: 7, pm: true });
    expect(partsToMinutes({ hour: 12, minute: 0, pm: false })).toBe(0);
    expect(partsToMinutes({ hour: 12, minute: 0, pm: false }, { end: true })).toBe(DAY);
    expect(partsToMinutes({ hour: 12, minute: 30, pm: true })).toBe(h(12, 30));
  });

  it("parses what an AI app writes", () => {
    expect(["7:30AM", "7:30 am", "7pm", "7 p.m.", "19:30", "0:00", "12:00AM"].map((t) => parseClock(t))).toEqual([
      h(7, 30),
      h(7, 30),
      h(19),
      h(19),
      h(19, 30),
      0,
      0,
    ]);
    expect(parseClock("12:00AM", { end: true })).toBe(DAY);
    expect(parseClock("24:00", { end: true })).toBe(DAY);
    expect(["13pm", "7:60", "7", "noon", "25:00"].map((t) => parseClock(t))).toEqual([null, null, null, null, null]);
  });
});

describe("stored schedules", () => {
  it("round-trip, and anything unsound reads as none", () => {
    const s = newSchedule();
    expect(parseSchedule(JSON.stringify(s))).toEqual(s);
    expect(parseSchedule("")).toBeNull();
    expect(parseSchedule("{not json")).toBeNull();
    const overlap = { ...s, slots: s.slots.map((slot, i) => (i === 3 ? { ...slot, start: slot.start - 1 } : slot)) };
    expect(scheduleProblem(overlap)).toBe("has slots that overlap or leave gaps");
    expect(scheduleProblem({ ...s, extra: 1 })).toBe('has an unknown setting "extra"');
    expect(scheduleProblem({ ...s, slots: [{ ...s.slots[0], html: "<b>" }] })).toBe('has a slot with an unknown field "html"');
    expect(activeSchedule({ schedule_json: JSON.stringify({ ...s, enabled: false }) })).toBeNull();
    expect(activeSchedule({ schedule_json: JSON.stringify(s) })).toEqual(s);
  });

  it("previews the first filled slots", () => {
    expect(schedulePreview(newSchedule())).toBe("Empty schedule");
    const s = fill(fill(newSchedule(), h(7), "Breakfast"), h(9), "Work");
    expect(schedulePreview(s)).toBe("7:00 AM Breakfast · 9:00 AM Work");
  });
});

describe("pinned settings", () => {
  it("start a new schedule where they say, and give way when they can't all hold", () => {
    const s = scheduleFromDefaults({ dayStart: h(7), dayEnd: h(22), gap: 5, slot: 30, cascade: "next", now: false });
    expect(scheduleProblem(s)).toBeNull();
    expect(settingsOf(s)).toEqual({ dayStart: h(7), dayEnd: h(22), gap: 5, slot: 30, cascade: "next", now: false });
    expect(ranges(s)[0]).toBe("7:00 AM – 7:25 AM");
    expect(ranges(scheduleFromDefaults({}))).toEqual(ranges(newSchedule()));
    // An end pinned before a start pinned elsewhere: the day runs to midnight.
    expect(settingsOf(scheduleFromDefaults({ dayStart: h(9), dayEnd: h(6) }))).toMatchObject({ dayStart: h(9), dayEnd: DAY });
    // A gap as long as the slots: no gap.
    expect(scheduleFromDefaults({ gap: 30, slot: 30 }).gap).toBe(0);
    expect(cleanDefaults({ gap: -1, slot: 2, dayStart: "7", cascade: "up", extra: true })).toEqual({});
  });
});

describe("cutting empty time", () => {
  it("lines up with the clock and joins slivers to their neighbour", () => {
    expect(cutTime(h(7, 30), h(10), 60, 0)).toEqual([
      { start: h(7, 30), end: h(8) },
      { start: h(8), end: h(9) },
      { start: h(9), end: h(10) },
    ]);
    expect(cutTime(h(7, 58), h(10, 2), 60, 0)).toEqual([
      { start: h(7, 58), end: h(9) },
      { start: h(9), end: h(10, 2) },
    ]);
    expect(cutTime(h(7), h(7, 3), 60, 0)).toEqual([{ start: h(7), end: h(7, 3) }]);
  });
});

/**
 * Hundreds of random edits, in both modes and with gaps: after every one
 * the schedule is sound, and no filled slot has gone missing unless the
 * edit was removing or overwriting it.
 */
describe("whatever you do to it", () => {
  // A small seeded generator, so a failure repeats.
  let seed = 20260930;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
  const pick = (n) => Math.floor(rand() * n);
  const minute = () => pick(DAY + 1);

  it("stays sound and keeps what's written", () => {
    let s = newSchedule();
    let refused = 0;
    for (let step = 0; step < 4000; step += 1) {
      const i = pick(s.slots.length);
      const texts = s.slots.map((slot) => slot.text).filter(Boolean).sort();
      const op = pick(11);
      let result;
      let lost = null;
      // Times near the slot, like a person typing: some just past the next
      // slot or two, some before its own start (refused).
      if (op === 0) result = changeEnd(s, i, Math.min(DAY, s.slots[i].start + pick(240) - 10));
      else if (op === 1) result = changeStart(s, i, Math.max(0, s.slots[i].end - pick(240) + 10));
      else if (op === 2) result = setGap(s, [0, 5, 10, 15, 30][pick(5)]);
      else if (op === 3) result = setSlotLength(s, [15, 30, 45, 60, 90, 120][pick(6)]);
      else if (op === 4) {
        const a = minute();
        const b = minute();
        result = setDayBounds(s, Math.min(a, b), Math.max(a, b));
      } else if (op === 5) result = splitSlot(s, i);
      else if (op === 6) {
        lost = s.slots[i].text;
        result = removeSlot(s, i);
      } else if (op === 7 || op === 8) {
        lost = s.slots[i].text;
        result = setSlotText(s, i, rand() < 0.3 ? "" : `item ${step}`);
      } else if (op === 9) {
        const a = minute();
        const b = Math.min(DAY, a + 5 + pick(90));
        const exact = s.slots.find((slot) => slot.start === Math.min(a, b) && slot.end === Math.max(a, b));
        lost = exact?.text ?? null;
        result = placeEntry(s, Math.min(a, b), Math.max(a, b), `placed ${step}`);
      } else {
        s = { ...s, cascade: s.cascade === "shift" ? "next" : "shift" };
        continue;
      }
      if (result.error) {
        refused += 1;
        continue;
      }
      expect(scheduleProblem(result.schedule), `step ${step}, op ${op}`).toBeNull();
      const after = result.schedule.slots.map((slot) => slot.text).filter(Boolean);
      const missing = [...texts];
      for (const text of after) {
        const at = missing.indexOf(text);
        if (at >= 0) missing.splice(at, 1);
      }
      expect(missing.filter((text) => text !== lost), `step ${step}, op ${op}`).toEqual([]);
      s = result.schedule;
    }
    // Enough edits went through for this to mean something.
    expect(refused).toBeLessThan(1500);
  });
});
