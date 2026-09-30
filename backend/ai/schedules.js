// @ts-check
/**
 * @file A note's schedule as AI apps see and change it: times written the
 * app's way (7:30AM), settings by plain names, and exactly the changes the
 * Notes page makes (backend/lib/schedule.js), so a schedule behaves the
 * same whoever edits it — the same cascades, the same refusals, and a slot
 * with text is never dropped or pushed out of the day as a side effect.
 */
import { ToolError } from "./args.js";
import {
  MAX_GAP,
  MAX_SLOT_LENGTH,
  MAX_SLOT_TEXT,
  MIN_SLOT_LENGTH,
  changeEnd,
  changeStart,
  clearAll,
  formatClock,
  isFilled,
  newSchedule,
  parseClock,
  placeEntry,
  setDayBounds,
  setGap,
  setSlotLength,
  setSlotText,
} from "../lib/schedule.js";

/** @typedef {import("../lib/schedule.js").Schedule} Schedule */

const TIME = { type: "string", maxLength: 20 };
const CASCADE = /** @type {Record<string, "shift" | "next">} */ ({ move_others: "shift", next_only: "next" });
const MOST_SLOTS_SHOWN = 300;

/** The app's time format: 7:30AM. 1440 is 12:00AM, midnight at the end of the day. */
const at = (/** @type {number} */ minutes) => formatClock(minutes, { compact: true });

/**
 * @param {string} text
 * @param {string} field
 * @param {boolean} [end]  midnight means the end of the day
 */
function clock(text, field, end = false) {
  const minutes = parseClock(text, { end });
  if (minutes == null) throw new ToolError(`"${field}" must be a time like 7:30AM or 19:30.`);
  return minutes;
}

/** Everything that changes a schedule, shared by edit_schedule and create_note. */
export const SCHEDULE_CHANGES = {
  gap_minutes: {
    type: "integer",
    minimum: 0,
    maximum: MAX_GAP,
    description: "Minutes between one slot's end and the next one's start; 0 (the default) for none. Every slot keeps its start.",
  },
  slot_minutes: {
    type: "integer",
    minimum: MIN_SLOT_LENGTH,
    maximum: MAX_SLOT_LENGTH,
    description: "How long empty slots are (a new schedule uses 60): empty time is cut again into slots this long, on the clock. Slots with text stay put.",
  },
  day_start: { ...TIME, description: "When the day starts, like 6:00AM. A slot with text outside the new day is refused." },
  day_end: { ...TIME, description: "When the day ends, like 10:00PM. 12:00AM is midnight at the end of the day." },
  when_time_changes: {
    type: "string",
    enum: ["move_others", "next_only"],
    description:
      "What changing a slot's time does to the others (in change_time, and when the person edits a time in the app). " +
      "move_others (the default): every slot after a changed end, or before a changed start, moves too and keeps its length. " +
      "next_only: only the slot next to it gets longer or shorter.",
  },
  highlight_now: { type: "boolean", description: "Whether the app highlights the slot happening now." },
  clear_all: { type: "boolean", description: "Empty every slot and cut the day again into slots of slot_minutes — to build a schedule from scratch." },
  clear: {
    type: "array",
    maxItems: 200,
    items: { ...TIME },
    description: "Empty these slots, named by their start times. Their time stays, as empty slots.",
  },
  fill: {
    type: "array",
    maxItems: 200,
    items: {
      type: "object",
      properties: {
        start: { ...TIME, description: "Like 7:00AM." },
        end: { ...TIME, description: "Like 7:30AM." },
        text: { type: "string", maxLength: MAX_SLOT_TEXT, description: "What's happening then." },
      },
      required: ["start", "end", "text"],
      additionalProperties: false,
    },
    description:
      "Put what's happening at exactly these times. Empty slots in the way are cut short or dropped and the empty time around it is cut into slots; " +
      "a slot with text in the way is refused (clear it first). The same times as a slot already there replace its text. Times outside the day stretch it.",
  },
  change_time: {
    type: "object",
    properties: {
      slot: { ...TIME, description: "The slot, by its start time." },
      start: { ...TIME, description: "Its new start." },
      end: { ...TIME, description: "Its new end." },
    },
    required: ["slot"],
    additionalProperties: false,
    description: "Change one slot's start or end the way the person does in the app; the other slots follow per when_time_changes.",
  },
};

/**
 * Apply the changes an AI app asked for, in a fixed order (settings, day,
 * slot length and gap, clearing, filling, a time change), all or nothing.
 * @param {Schedule} start
 * @param {Record<string, any>} args
 * @returns {{ schedule: Schedule, done: string[], changedSlot?: string }}
 *   changedSlot: the slot change_time moved on purpose.
 */
export function applyScheduleChanges(start, args) {
  let s = start;
  /** @type {string[]} */
  const done = [];
  /** @type {string | undefined} */
  let changedSlot;
  const take = (/** @type {{ schedule?: Schedule, error?: string }} */ result) => {
    if (result.error || !result.schedule) throw new ToolError(result.error || "That can't be done to this schedule.");
    s = result.schedule;
  };

  if (args.when_time_changes) {
    s = { ...s, cascade: CASCADE[args.when_time_changes] };
    done.push(args.when_time_changes === "move_others" ? "changing a time moves the slots after it" : "changing a time only changes the slot next to it");
  }
  if (args.highlight_now != null) {
    s = { ...s, now: args.highlight_now };
    done.push(args.highlight_now ? "the slot happening now is highlighted" : "the slot happening now isn't highlighted");
  }
  if (args.day_start || args.day_end) {
    const from = args.day_start ? clock(args.day_start, "day_start") : s.slots[0].start;
    const to = args.day_end ? clock(args.day_end, "day_end", true) : s.slots[s.slots.length - 1].end;
    take(setDayBounds(s, from, to));
    done.push(`the day runs ${at(from)}–${at(to)}`);
  }
  if (args.slot_minutes != null || args.gap_minutes != null) {
    /** @type {Array<(x: Schedule) => { schedule?: Schedule, error?: string }>} */
    const steps = [];
    if (args.slot_minutes != null) steps.push((x) => setSlotLength(x, args.slot_minutes));
    if (args.gap_minutes != null) steps.push((x) => setGap(x, args.gap_minutes));
    // A longer gap and a longer slot only fit one way round, and shorter
    // ones only the other: try both.
    const run = (/** @type {typeof steps} */ order) => {
      let x = s;
      for (const step of order) {
        const result = step(x);
        if (result.error || !result.schedule) return result;
        x = result.schedule;
      }
      return { schedule: x };
    };
    let result = run(steps);
    if (result.error && steps.length === 2) {
      const other = run([steps[1], steps[0]]);
      if (!other.error) result = other;
    }
    take(result);
    if (args.slot_minutes != null) done.push(`empty time is in ${args.slot_minutes}-minute slots`);
    if (args.gap_minutes != null) done.push(args.gap_minutes ? `${args.gap_minutes} minutes between slots` : "no gap between slots");
  }
  if (args.clear_all) {
    take(clearAll(s));
    done.push("emptied every slot");
  }
  for (const time of args.clear || []) {
    const minutes = clock(time, "clear");
    const index = s.slots.findIndex((slot) => slot.start === minutes);
    if (index < 0) throw new ToolError(`No slot starts at ${at(minutes)}. get_note shows every slot's times.`);
    take(setSlotText(s, index, ""));
  }
  if (args.clear?.length) done.push(`emptied ${args.clear.length} slot${args.clear.length === 1 ? "" : "s"}`);
  for (const [i, entry] of (args.fill || []).entries()) {
    take(placeEntry(s, clock(entry.start, `fill[${i}].start`), clock(entry.end, `fill[${i}].end`, true), entry.text));
  }
  if (args.fill?.length) done.push(`filled ${args.fill.length} slot${args.fill.length === 1 ? "" : "s"}`);
  if (args.change_time) {
    const { slot, start: newStart, end: newEnd } = args.change_time;
    if (!newStart && !newEnd) throw new ToolError('"change_time" needs a new start or end.');
    const minutes = clock(slot, "change_time.slot");
    const id = s.slots.find((x) => x.start === minutes)?.id;
    if (!id) throw new ToolError(`No slot starts at ${at(minutes)}. get_note shows every slot's times.`);
    const indexOf = () => s.slots.findIndex((x) => x.id === id);
    if (newEnd) take(changeEnd(s, indexOf(), clock(newEnd, "change_time.end", true)));
    if (newStart) take(changeStart(s, indexOf(), clock(newStart, "change_time.start")));
    const moved = s.slots[indexOf()];
    done.push(`the ${at(minutes)} slot now runs ${at(moved.start)}–${at(moved.end)}`);
    changedSlot = id;
  }
  return { schedule: s, done, changedSlot };
}

/**
 * A new schedule with changes applied (create_note with schedule).
 * @param {Record<string, any>} args
 */
export function newScheduleWith(args) {
  return applyScheduleChanges(newSchedule(), args);
}

/**
 * A schedule as structured data for an AI app.
 * @param {Schedule} s
 */
export function scheduleData(s) {
  return {
    on: s.enabled,
    gap_minutes: s.gap,
    slot_minutes: s.slot,
    day_start: at(s.slots[0].start),
    day_end: at(s.slots[s.slots.length - 1].end),
    when_time_changes: s.cascade === "shift" ? "move_others" : "next_only",
    highlight_now: s.now,
    slots: s.slots.map((slot) => ({ start: at(slot.start), end: at(slot.end), text: slot.text })),
  };
}

/**
 * A schedule as lines of text: its settings, then every slot.
 * @param {Schedule} s
 */
export function scheduleText(s) {
  const filled = s.slots.filter(isFilled).length;
  const head =
    `${s.slots.length} slots (${filled} with something in them), ${at(s.slots[0].start)}–${at(s.slots[s.slots.length - 1].end)}. ` +
    `${s.gap ? `${s.gap} minutes between slots` : "No gap between slots"}; empty time in ${s.slot}-minute slots; ` +
    `changing a time ${s.cascade === "shift" ? "moves the slots after it" : "only changes the slot next to it"}.`;
  const lines = s.slots.slice(0, MOST_SLOTS_SHOWN).map((slot) => `- ${at(slot.start)}–${at(slot.end)}${isFilled(slot) ? `: ${slot.text.trim()}` : " (empty)"}`);
  if (s.slots.length > MOST_SLOTS_SHOWN) lines.push(`(${s.slots.length - MOST_SLOTS_SHOWN} more slots, in data.schedule)`);
  return [head, ...lines].join("\n");
}
