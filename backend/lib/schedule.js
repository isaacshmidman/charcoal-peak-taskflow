// @ts-check
/**
 * @file A note's schedule (the Schedule Builder): slots of time through one
 * day, each with what happens then. Pure functions over plain data, shared
 * by the Notes page (src/lib/schedule.js re-exports this file) and the
 * server (store validation, the AI tools), so a schedule changes the same
 * way whoever changes it.
 *
 * Times are minutes after midnight, 0–1440; 1440 is the midnight that ends
 * the day. A schedule never crosses midnight.
 *
 * The rule every function keeps: each slot starts exactly `gap` minutes
 * after the one before it ends, and lasts at least a minute. So there are
 * never overlaps, and never gaps other than the one asked for. The day runs
 * from the first slot's start to the last slot's end.
 *
 * A slot with text is "filled". A filled slot is never removed or pushed
 * out of the day as a side effect of some other change: that change is
 * refused instead, with a sentence saying why. Empty slots are just time,
 * and give way.
 */

export const DAY = 24 * 60;
export const MAX_GAP = 240;
export const MIN_SLOT_LENGTH = 5;
export const MAX_SLOT_LENGTH = 720;
export const MAX_SLOTS = DAY;
export const MAX_SLOT_TEXT = 1000;
/** Offered in Advanced settings; any whole number in range works. */
export const GAP_CHOICES = [0, 5, 10, 15, 30];
export const SLOT_LENGTH_CHOICES = [15, 30, 45, 60, 90, 120];

/** Pieces of empty time shorter than this are joined to their neighbour when time is cut into slots. */
const MIN_PIECE = 5;

/**
 * @typedef {{ id: string, start: number, end: number, text: string }} Slot
 * @typedef {"shift" | "next"} Cascade
 *   shift: slots after a changed end (before a changed start) move along,
 *          keeping their lengths. next: only the neighbouring slot changes.
 * @typedef {{
 *   v: 1,
 *   enabled: boolean,
 *   gap: number,
 *   slot: number,
 *   cascade: Cascade,
 *   now: boolean,
 *   slots: Slot[],
 * }} Schedule
 *   enabled: the note shows as a schedule. Off keeps the slots.
 *   gap: minutes between one slot's end and the next one's start.
 *   slot: the length empty time is cut into.
 *   now: highlight the slot happening now.
 * @typedef {{ schedule: Schedule, error?: undefined } | { error: string, schedule?: undefined }} Result
 */

// ── Times ───────────────────────────────────────────────────────────────

/**
 * 7:00 AM. 1440 (the end of the day) is 12:00 AM, like midnight.
 * @param {number} minutes
 * @param {{ compact?: boolean }} [opts]  compact: 7:00AM, the app's stored time format
 */
export function formatClock(minutes, { compact = false } = {}) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${hour}:${String(m).padStart(2, "0")}${compact ? "" : " "}${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * "7:00 AM – 8:00 AM"
 * @param {{ start: number, end: number }} slot
 * @param {{ compact?: boolean }} [opts]
 */
export function formatRange(slot, opts) {
  return `${formatClock(slot.start, opts)} – ${formatClock(slot.end, opts)}`;
}

/**
 * The parts a time field shows: 1–12, 0–59, and whether it's PM.
 * @param {number} minutes
 */
export function clockParts(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  return { hour: h24 % 12 === 0 ? 12 : h24 % 12, minute: minutes % 60, pm: h24 >= 12 };
}

/**
 * Back from a time field's parts. For an end, 12:00 AM is the midnight
 * that ends the day: an end can't be the start of the day.
 * @param {{ hour: number, minute: number, pm: boolean }} parts
 * @param {{ end?: boolean }} [opts]
 */
export function partsToMinutes({ hour, minute, pm }, { end = false } = {}) {
  const minutes = ((hour % 12) + (pm ? 12 : 0)) * 60 + minute;
  return end && minutes === 0 ? DAY : minutes;
}

/**
 * "7:30AM", "7:30 am", "7pm", "19:30", "0:00", "24:00" → minutes, or null.
 * For an end, midnight (12:00AM, 0:00 or 24:00) is the end of the day.
 * @param {string} input
 * @param {{ end?: boolean }} [opts]
 */
export function parseClock(input, { end = false } = {}) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i.exec(String(input).trim()) || /^(\d{1,2}):(\d{2})$/.exec(String(input).trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hour > 24 || (hour === 24 && minute > 0)) {
    return null;
  }
  const minutes = hour * 60 + minute;
  if (minutes === DAY) return end ? DAY : 0;
  return end && minutes === 0 ? DAY : minutes;
}

// ── Building ────────────────────────────────────────────────────────────

let idCounter = 0;
/** A slot id that is new in this schedule. */
function newId(/** @type {Set<string>} */ taken) {
  for (;;) {
    idCounter = (idCounter + 1) % 1_000_000;
    const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
    const id = `s_${random}${idCounter.toString(36)}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/**
 * Empty time from `from` to `to`, cut into slots of `length` minutes lined
 * up with the clock (every hour, every half hour…), each ending `gap`
 * minutes before the next begins. A sliver at either end is joined to its
 * neighbour rather than left as a slot of its own.
 * @param {number} from
 * @param {number} to
 * @param {number} length
 * @param {number} gap
 * @returns {Array<{ start: number, end: number }>}
 */
export function cutTime(from, to, length, gap) {
  if (to - from < 1) return [];
  const starts = [from];
  for (let t = (Math.floor(from / length) + 1) * length; t < to; t += length) starts.push(t);
  // A first piece too short to be a slot joins the next one; likewise the last.
  while (starts.length > 1 && starts[1] - gap - starts[0] < MIN_PIECE) starts.splice(1, 1);
  while (starts.length > 1 && to - starts[starts.length - 1] < MIN_PIECE) starts.pop();
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] - gap : to }));
}

/**
 * @param {Array<{ start: number, end: number }>} pieces
 * @param {Set<string>} taken
 * @returns {Slot[]}
 */
const emptySlots = (pieces, taken) => pieces.map((p) => ({ id: newId(taken), start: p.start, end: p.end, text: "" }));

/**
 * An empty slot cut again, with more time, into slots of the schedule's
 * length. The piece at `side` keeps the slot's id: it's the same slot,
 * reshaped, and the rest are new.
 * @param {Schedule} s
 * @param {Slot} slot
 * @param {number} from
 * @param {number} to
 * @param {Set<string>} taken
 * @param {"first" | "last"} side
 * @returns {Slot[]}
 */
function recut(s, slot, from, to, taken, side) {
  const pieces = emptySlots(cutTime(from, to, s.slot, s.gap), taken);
  pieces[side === "first" ? 0 : pieces.length - 1].id = slot.id;
  return pieces;
}

/**
 * A new schedule: the whole day in hour-long slots, unless told otherwise.
 * @param {{ gap?: number, slot?: number, cascade?: Cascade, now?: boolean, start?: number, end?: number }} [opts]
 * @returns {Schedule}
 */
export function newSchedule({ gap = 0, slot = 60, cascade = "shift", now = true, start = 0, end = DAY } = {}) {
  return { v: 1, enabled: true, gap, slot, cascade, now, slots: emptySlots(cutTime(start, end, slot, gap), new Set()) };
}

// ── Reading ─────────────────────────────────────────────────────────────

/** @param {Slot} slot */
export const isFilled = (slot) => slot.text.trim() !== "";

/**
 * “Lunch”
 * @param {Slot} slot
 */
function quoted(slot) {
  const text = slot.text.trim().replace(/\s+/g, " ");
  return `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”`;
}

/**
 * “Lunch” (12:00 PM – 1:00 PM)
 * @param {Slot} slot
 */
const named = (slot) => `${quoted(slot)} (${formatRange(slot)})`;

/**
 * What's wrong with a schedule, or null when it's sound.
 * @param {any} s
 * @returns {string | null}
 */
export function scheduleProblem(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return "isn't a schedule";
  const allowed = new Set(["v", "enabled", "gap", "slot", "cascade", "now", "slots"]);
  for (const key of Object.keys(s)) if (!allowed.has(key)) return `has an unknown setting "${key}"`;
  if (s.v !== 1) return "is from a newer version";
  if (typeof s.enabled !== "boolean" || typeof s.now !== "boolean") return "has a setting that isn't true or false";
  if (!Number.isInteger(s.gap) || s.gap < 0 || s.gap > MAX_GAP) return `has a gap that isn't 0–${MAX_GAP} minutes`;
  if (!Number.isInteger(s.slot) || s.slot < MIN_SLOT_LENGTH || s.slot > MAX_SLOT_LENGTH) {
    return `has a slot length that isn't ${MIN_SLOT_LENGTH}–${MAX_SLOT_LENGTH} minutes`;
  }
  if (s.gap >= s.slot) return "has a gap as long as its slots";
  if (s.cascade !== "shift" && s.cascade !== "next") return "has an unknown way of changing times";
  if (!Array.isArray(s.slots) || s.slots.length < 1 || s.slots.length > MAX_SLOTS) return `must have 1–${MAX_SLOTS} slots`;
  const ids = new Set();
  for (let i = 0; i < s.slots.length; i += 1) {
    const slot = s.slots[i];
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) return "has a slot that isn't a slot";
    for (const key of Object.keys(slot)) if (!["id", "start", "end", "text"].includes(key)) return `has a slot with an unknown field "${key}"`;
    if (typeof slot.id !== "string" || !slot.id || slot.id.length > 40 || ids.has(slot.id)) return "has a slot without its own id";
    ids.add(slot.id);
    if (!Number.isInteger(slot.start) || !Number.isInteger(slot.end) || slot.start < 0 || slot.end > DAY) return "has a time outside the day";
    if (slot.end - slot.start < 1) return "has a slot that ends before it starts";
    if (typeof slot.text !== "string" || slot.text.length > MAX_SLOT_TEXT) return `has a slot whose text isn't at most ${MAX_SLOT_TEXT} characters`;
    if (i > 0 && slot.start !== s.slots[i - 1].end + s.gap) return "has slots that overlap or leave gaps";
  }
  return null;
}

/**
 * A stored schedule (the note's schedule_json), or null for none or one
 * that isn't sound.
 * @param {unknown} json
 * @returns {Schedule | null}
 */
export function parseSchedule(json) {
  if (typeof json !== "string" || !json.trim()) return null;
  try {
    const parsed = JSON.parse(json);
    return scheduleProblem(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * The schedule a note shows, or null when it isn't a schedule right now.
 * @param {{ schedule_json?: unknown }} note
 */
export function activeSchedule(note) {
  const schedule = parseSchedule(note?.schedule_json);
  return schedule?.enabled ? schedule : null;
}

/**
 * The filled slots, as "7:00 AM – 8:00 AM  Breakfast" lines.
 * @param {Schedule} s
 */
export function filledLines(s) {
  return s.slots.filter(isFilled).map((slot) => `${formatRange(slot)}  ${slot.text.trim()}`);
}

/**
 * Every filled slot's text, for search.
 * @param {Schedule | null} s
 */
export function scheduleSearchText(s) {
  return s ? s.slots.filter(isFilled).map((slot) => slot.text).join("\n") : "";
}

/**
 * A line for a note list: the first filled slots.
 * @param {Schedule} s
 */
export function schedulePreview(s) {
  const filled = s.slots.filter(isFilled);
  if (!filled.length) return "Empty schedule";
  return filled
    .slice(0, 3)
    .map((slot) => `${formatClock(slot.start)} ${slot.text.trim()}`)
    .join(" · ");
}

/**
 * What a change did to the slots other than `editedId`, as a sentence
 * ("Adjusted 16 other slots and added 1 empty slot."), or null when it
 * touched nothing else.
 * @param {Schedule} before
 * @param {Schedule} after
 * @param {string} [editedId]
 */
export function describeChange(before, after, editedId) {
  const was = new Map(before.slots.map((slot) => [slot.id, slot]));
  const now = new Set(after.slots.map((slot) => slot.id));
  let adjusted = 0;
  let added = 0;
  for (const slot of after.slots) {
    const old = was.get(slot.id);
    if (!old) added += 1;
    else if (slot.id !== editedId && (old.start !== slot.start || old.end !== slot.end)) adjusted += 1;
  }
  const removed = before.slots.filter((slot) => !now.has(slot.id)).length;
  const count = (/** @type {number} */ n, /** @type {string} */ what) => `${n} ${what}${n === 1 ? "" : "s"}`;
  const parts = [];
  if (adjusted) parts.push(`adjusted ${count(adjusted, editedId ? "other slot" : "slot")}`);
  if (removed) parts.push(`removed ${count(removed, "empty slot")}`);
  if (added) parts.push(`added ${count(added, "empty slot")}`);
  if (!parts.length) return null;
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

// ── Changing ────────────────────────────────────────────────────────────

/**
 * @param {Schedule} s
 * @param {Slot[]} slots
 * @param {Partial<Schedule>} [changes]
 * @returns {Result}
 */
const done = (s, slots, changes = {}) => ({ schedule: { ...s, ...changes, slots } });

/** @param {string} error @returns {Result} */
const refuse = (error) => ({ error });

/** @param {Schedule} s */
const copySlots = (s) => s.slots.map((slot) => ({ ...slot }));

/** @param {Slot[]} slots */
const idsOf = (slots) => new Set(slots.map((slot) => slot.id));

/**
 * After slots moved later, trim what now runs past `limit`: empty slots
 * are cut short or dropped, a filled one refuses.
 * @param {Slot[]} slots
 * @param {number} limit
 * @param {number} keep  slots up to this index are never touched
 * @returns {string | null}
 */
function trimTail(slots, limit, keep) {
  while (slots.length - 1 > keep && slots[slots.length - 1].end > limit) {
    const last = slots[slots.length - 1];
    if (isFilled(last)) return `That would push ${quoted(last)} past the end of the day (${formatClock(limit)}).`;
    if (limit - last.start >= 1) {
      last.end = limit;
      break;
    }
    slots.pop();
  }
  return null;
}

/**
 * After slots moved earlier, trim what now starts before `limit`.
 * @param {Slot[]} slots
 * @param {number} limit
 * @param {number} keep  how many slots at the end are never touched
 * @returns {string | null}
 */
function trimHead(slots, limit, keep) {
  while (slots.length > keep && slots[0].start < limit) {
    const first = slots[0];
    if (isFilled(first)) return `That would push ${quoted(first)} before the start of the day (${formatClock(limit)}).`;
    if (first.end - limit >= 1) {
      first.start = limit;
      break;
    }
    slots.shift();
  }
  return null;
}

/**
 * After slots moved earlier, the day's end still at `dayEnd`: the time
 * freed at the end becomes empty slots. An empty last slot is cut again
 * together with it, so empty time lines up with the clock.
 * @param {Schedule} s
 * @param {Slot[]} slots
 * @param {number} dayEnd
 */
function fillTail(s, slots, dayEnd) {
  const last = slots[slots.length - 1];
  if (dayEnd - last.end < 1) return;
  const taken = idsOf(slots);
  if (!isFilled(last) && slots.length > 1) {
    slots.splice(slots.length - 1, 1, ...recut(s, last, last.start, dayEnd, taken, "first"));
  } else if (!isFilled(last)) {
    last.end = dayEnd;
  } else if (dayEnd - (last.end + s.gap) >= 1) {
    slots.push(...emptySlots(cutTime(last.end + s.gap, dayEnd, s.slot, s.gap), taken));
  }
}

/**
 * After slots moved later, the day's start still at `dayStart`: the time
 * freed at the start becomes empty slots.
 * @param {Schedule} s
 * @param {Slot[]} slots
 * @param {number} dayStart
 */
function fillHead(s, slots, dayStart) {
  const first = slots[0];
  if (first.start - dayStart < 1) return;
  const taken = idsOf(slots);
  if (!isFilled(first) && slots.length > 1) {
    slots.splice(0, 1, ...recut(s, first, dayStart, first.end, taken, "last"));
  } else if (!isFilled(first)) {
    first.start = dayStart;
  } else if (first.start - s.gap - dayStart >= 1) {
    slots.unshift(...emptySlots(cutTime(dayStart, first.start - s.gap, s.slot, s.gap), taken));
  }
}

const IN_THE_WAY = "Change that slot first, or choose “Move the slots after it” in Advanced settings.";

/**
 * Change when a slot ends, the way the Notes page does it: the slots after
 * it follow, per the schedule's cascade setting.
 * @param {Schedule} s
 * @param {number} index
 * @param {number} end
 * @returns {Result}
 */
export function changeEnd(s, index, end) {
  const slots = copySlots(s);
  const slot = slots[index];
  if (!slot) return refuse("That slot isn't there any more.");
  if (!Number.isInteger(end) || end < 0 || end > DAY) return refuse("A schedule ends by midnight.");
  if (end <= slot.start) return refuse(`The end has to be after the start (${formatClock(slot.start)}).`);
  if (end === slot.end) return done(s, slots);
  const lastIndex = slots.length - 1;
  const dayEnd = slots[lastIndex].end;
  if (index === lastIndex) {
    slot.end = end;
    return done(s, slots);
  }
  if (s.cascade === "next") {
    slot.end = end;
    const nextStart = end + s.gap;
    const j = index + 1;
    // Slots the new end runs right over: empty ones go, a filled one stops it.
    while (j < slots.length && slots[j].end - nextStart < 1) {
      if (isFilled(slots[j])) return refuse(`${named(slots[j])} is in the way. ${IN_THE_WAY}`);
      slots.splice(j, 1);
    }
    if (j < slots.length) slots[j].start = nextStart;
    return done(s, slots);
  }
  const delta = end - slot.end;
  slot.end = end;
  for (let j = index + 1; j < slots.length; j += 1) {
    slots[j].start += delta;
    slots[j].end += delta;
  }
  if (delta > 0) {
    const error = trimTail(slots, Math.max(dayEnd, end), index);
    if (error) return refuse(error);
  } else {
    fillTail(s, slots, dayEnd);
  }
  return done(s, slots);
}

/**
 * Change when a slot starts: the slots before it follow.
 * @param {Schedule} s
 * @param {number} index
 * @param {number} start
 * @returns {Result}
 */
export function changeStart(s, index, start) {
  const slots = copySlots(s);
  const slot = slots[index];
  if (!slot) return refuse("That slot isn't there any more.");
  if (!Number.isInteger(start) || start < 0 || start > DAY) return refuse("A schedule starts at midnight at the earliest.");
  if (start >= slot.end) return refuse(`The start has to be before the end (${formatClock(slot.end)}).`);
  if (start === slot.start) return done(s, slots);
  const dayStart = slots[0].start;
  if (index === 0) {
    slot.start = start;
    return done(s, slots);
  }
  if (s.cascade === "next") {
    slot.start = start;
    const prevEnd = start - s.gap;
    let j = index - 1;
    while (j >= 0 && prevEnd - slots[j].start < 1) {
      if (isFilled(slots[j])) return refuse(`${named(slots[j])} is in the way. ${IN_THE_WAY}`);
      slots.splice(j, 1);
      j -= 1;
    }
    if (j >= 0) slots[j].end = prevEnd;
    return done(s, slots);
  }
  const delta = start - slot.start;
  slot.start = start;
  for (let j = 0; j < index; j += 1) {
    slots[j].start += delta;
    slots[j].end += delta;
  }
  if (delta < 0) {
    const error = trimHead(slots, Math.min(dayStart, start), slots.length - index);
    if (error) return refuse(error);
  } else {
    fillHead(s, slots, dayStart);
  }
  return done(s, slots);
}

/**
 * A new gap between slots. Every slot keeps its start and ends `gap`
 * minutes before the next begins; an empty slot left with no time goes.
 * @param {Schedule} s
 * @param {number} gap
 * @returns {Result}
 */
export function setGap(s, gap) {
  if (!Number.isInteger(gap) || gap < 0 || gap > MAX_GAP) return refuse(`The gap can be 0 to ${MAX_GAP} minutes.`);
  if (gap >= s.slot) return refuse(`The gap has to be shorter than a slot (${s.slot} minutes).`);
  const slots = copySlots(s);
  let i = 0;
  while (i < slots.length - 1) {
    const end = slots[i + 1].start - gap;
    if (end - slots[i].start >= 1) {
      slots[i].end = end;
      i += 1;
    } else if (isFilled(slots[i])) {
      return refuse(`A ${gap}-minute gap leaves no time for ${named(slots[i])}.`);
    } else {
      slots.splice(i, 1);
      if (i > 0) i -= 1;
    }
  }
  return done(s, slots, { gap });
}

/**
 * A new slot length. Filled slots stay where they are; every run of empty
 * slots is cut again into slots this long, lined up with the clock.
 * @param {Schedule} s
 * @param {number} length
 * @returns {Result}
 */
export function setSlotLength(s, length) {
  if (!Number.isInteger(length) || length < MIN_SLOT_LENGTH || length > MAX_SLOT_LENGTH) {
    return refuse(`A slot can be ${MIN_SLOT_LENGTH} to ${MAX_SLOT_LENGTH} minutes long.`);
  }
  if (length <= s.gap) return refuse(`Slots have to be longer than the gap between them (${s.gap} minutes).`);
  const taken = idsOf(s.slots);
  /** @type {Slot[]} */
  const slots = [];
  let i = 0;
  while (i < s.slots.length) {
    if (isFilled(s.slots[i])) {
      slots.push({ ...s.slots[i] });
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < s.slots.length && !isFilled(s.slots[j + 1])) j += 1;
    slots.push(...emptySlots(cutTime(s.slots[i].start, s.slots[j].end, length, s.gap), taken));
    i = j + 1;
  }
  return done(s, slots, { slot: length });
}

/**
 * When the day starts and ends. Time added is cut into empty slots; time
 * taken away drops empty slots, or cuts one short. A filled slot outside
 * the new day refuses.
 * @param {Schedule} s
 * @param {number} start
 * @param {number} end
 * @returns {Result}
 */
export function setDayBounds(s, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > DAY) return refuse("The day has to fit between midnight and midnight.");
  if (end <= start) return refuse(`The day has to end after it starts (${formatClock(start)}).`);
  const slots = copySlots(s);
  const taken = idsOf(slots);
  const outside = slots.find((slot) => isFilled(slot) && (slot.start < start || slot.end > end));
  if (outside) return refuse(`${named(outside)} is outside ${formatClock(start)} – ${formatClock(end)}. Change or clear it first.`);
  // Drop empty slots wholly outside, cut short the ones across an edge.
  const kept = slots.filter((slot) => slot.end - start >= 1 && end - slot.start >= 1);
  if (!kept.length) return done(s, emptySlots(cutTime(start, end, s.slot, s.gap), taken));
  if (kept[0].start < start) kept[0].start = start;
  if (kept[kept.length - 1].end > end) kept[kept.length - 1].end = end;
  // Time added at either edge: fill it the way freed time is filled.
  if (kept[0].start > start) {
    const before = kept.length;
    fillHead(s, kept, start);
    // Too little room for a gap and a slot before a filled first slot:
    // it starts where the day does.
    if (kept.length === before && kept[0].start > start) kept[0].start = start;
  }
  if (kept[kept.length - 1].end < end) {
    const before = kept.length;
    fillTail(s, kept, end);
    if (kept.length === before && kept[kept.length - 1].end < end) kept[kept.length - 1].end = end;
  }
  return done(s, kept);
}

/**
 * Split a slot in two, near its middle. Its text stays in the first half.
 * @param {Schedule} s
 * @param {number} index
 * @returns {Result}
 */
export function splitSlot(s, index) {
  const slots = copySlots(s);
  const slot = slots[index];
  if (!slot) return refuse("That slot isn't there any more.");
  const room = slot.end - slot.start - s.gap;
  if (room < 2) return refuse("That slot is too short to split.");
  let middle = slot.start + Math.floor(room / 2);
  const rounded = Math.round(middle / 5) * 5;
  if (rounded - slot.start >= 1 && slot.end - (rounded + s.gap) >= 1) middle = rounded;
  const second = { id: newId(idsOf(slots)), start: middle + s.gap, end: slot.end, text: "" };
  slot.end = middle;
  slots.splice(index + 1, 0, second);
  return done(s, slots);
}

/**
 * Take a slot out. With "move the slots after it", the slots after it
 * move up into its time and the end of the day is filled with empty
 * time; otherwise the slot before it (or after, for the first) takes its
 * time.
 * @param {Schedule} s
 * @param {number} index
 * @returns {Result}
 */
export function removeSlot(s, index) {
  const slots = copySlots(s);
  const slot = slots[index];
  if (!slot) return refuse("That slot isn't there any more.");
  if (slots.length === 1) return refuse("A schedule needs at least one slot. Turn Schedule off instead.");
  const dayEnd = slots[slots.length - 1].end;
  if (s.cascade === "next") {
    if (index > 0) slots[index - 1].end = slot.end;
    else slots[1].start = slot.start;
    slots.splice(index, 1);
    return done(s, slots);
  }
  if (index === slots.length - 1) {
    slots.splice(index, 1);
    fillTail(s, slots, dayEnd);
    return done(s, slots);
  }
  const delta = slot.start - slots[index + 1].start;
  slots.splice(index, 1);
  for (let j = index; j < slots.length; j += 1) {
    slots[j].start += delta;
    slots[j].end += delta;
  }
  fillTail(s, slots, dayEnd);
  return done(s, slots);
}

/**
 * What happens in a slot. One line; trimmed to the limit.
 * @param {Schedule} s
 * @param {number} index
 * @param {string} text
 * @returns {Result}
 */
export function setSlotText(s, index, text) {
  const slots = copySlots(s);
  if (!slots[index]) return refuse("That slot isn't there any more.");
  slots[index].text = String(text).replace(/[\r\n]+/g, " ").slice(0, MAX_SLOT_TEXT);
  return done(s, slots);
}

/**
 * Empty every slot and cut the day again into slots of the schedule's
 * length.
 * @param {Schedule} s
 * @returns {Result}
 */
export function clearAll(s) {
  const start = s.slots[0].start;
  const end = s.slots[s.slots.length - 1].end;
  return done(s, emptySlots(cutTime(start, end, s.slot, s.gap), new Set()));
}

/**
 * Put `text` in the day at exactly `start`–`end` (how an AI app fills a
 * schedule). The same times as a slot already there: that slot's text is
 * replaced. Empty slots in the way are cut short or dropped, and the empty
 * time left either side is cut into slots; a filled slot in the way
 * refuses. Times outside the day stretch it.
 * @param {Schedule} s
 * @param {number} start
 * @param {number} end
 * @param {string} text
 * @returns {Result}
 */
export function placeEntry(s, start, end, text) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > DAY) return refuse("A slot has to fit between midnight and midnight.");
  if (end <= start) return refuse(`The end has to be after the start (${formatClock(start)}).`);
  const exact = s.slots.findIndex((slot) => slot.start === start && slot.end === end);
  if (exact >= 0) return setSlotText(s, exact, text);
  const { gap } = s;
  const slots = copySlots(s);
  const taken = idsOf(slots);
  const entry = { id: newId(taken), start, end, text: String(text).replace(/[\r\n]+/g, " ").slice(0, MAX_SLOT_TEXT) };
  // Slots too close to keep the gap either side of the new one.
  const clash = (/** @type {Slot} */ slot) => slot.end > start - gap && slot.start < end + gap;
  const inTheWay = slots.find((slot) => clash(slot) && isFilled(slot));
  if (inTheWay) return refuse(`“${entry.text.trim() || "That"}” (${formatRange(entry)}) runs into ${named(inTheWay)}.`);
  const first = slots.findIndex(clash);
  let prevIndex = first - 1;
  if (first < 0) for (let i = 0; i < slots.length && slots[i].end <= start - gap; i += 1) prevIndex = i;
  const nextIndex = first >= 0 ? slots.findIndex((slot, i) => i > first && !clash(slot)) : slots.findIndex((slot) => slot.start >= end + gap);
  const prev = prevIndex >= 0 ? slots[prevIndex] : null;
  const next = nextIndex >= 0 ? slots[nextIndex] : null;
  const dayStart = slots[0].start;
  const dayEnd = slots[slots.length - 1].end;
  // The empty stretch the new slot lands in, from the slot before to the slot after.
  const from = prev ? prev.end + gap : Math.min(start, dayStart);
  const to = next ? next.start - gap : Math.max(end, dayEnd);
  /** @type {Slot[]} */
  let left = [];
  if (start - gap - from >= 1) left = emptySlots(cutTime(from, start - gap, s.slot, gap), taken);
  else if (prev && from !== start) {
    // Not room for a slot between them: the slot before stretches to meet it.
    if (isFilled(prev)) return refuse(`There isn't room for a ${gap}-minute gap between ${named(prev)} and “${entry.text.trim()}”.`);
    prev.end = start - gap;
  }
  /** @type {Slot[]} */
  let right = [];
  if (to - (end + gap) >= 1) right = emptySlots(cutTime(end + gap, to, s.slot, gap), taken);
  else if (next && to !== end) {
    if (isFilled(next)) return refuse(`There isn't room for a ${gap}-minute gap between “${entry.text.trim()}” and ${named(next)}.`);
    next.start = end + gap;
  }
  const head = prevIndex >= 0 ? slots.slice(0, prevIndex + 1) : [];
  const tail = nextIndex >= 0 ? slots.slice(nextIndex) : [];
  return done(s, [...head, ...left, entry, ...right, ...tail]);
}

// ── Pinned settings: where every new schedule starts ───────────────────

/**
 * The settings a person can pin, so every new schedule starts with them.
 * Schedules that already exist keep their own.
 * @typedef {{ dayStart?: number, dayEnd?: number, gap?: number, slot?: number, cascade?: Cascade, now?: boolean }} ScheduleDefaults
 */
export const PINNABLE = /** @type {const} */ (["dayStart", "dayEnd", "gap", "slot", "cascade", "now"]);

/**
 * A schedule's settings, under the names they're pinned by.
 * @param {Schedule} s
 * @returns {Required<ScheduleDefaults>}
 */
export function settingsOf(s) {
  return { dayStart: s.slots[0].start, dayEnd: s.slots[s.slots.length - 1].end, gap: s.gap, slot: s.slot, cascade: s.cascade, now: s.now };
}

/**
 * Only the pinned settings that make sense; anything else is dropped.
 * @param {any} input
 * @returns {ScheduleDefaults}
 */
export function cleanDefaults(input) {
  /** @type {ScheduleDefaults} */
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const whole = (/** @type {unknown} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
  if (whole(input.dayStart, 0, DAY - 1)) out.dayStart = input.dayStart;
  if (whole(input.dayEnd, 1, DAY)) out.dayEnd = input.dayEnd;
  if (whole(input.gap, 0, MAX_GAP)) out.gap = input.gap;
  if (whole(input.slot, MIN_SLOT_LENGTH, MAX_SLOT_LENGTH)) out.slot = input.slot;
  if (input.cascade === "shift" || input.cascade === "next") out.cascade = input.cascade;
  if (typeof input.now === "boolean") out.now = input.now;
  return out;
}

/**
 * A new schedule, starting from the pinned settings. Pins that can't all
 * hold at once (pinned in different schedules) give way: a day that would
 * end before it starts runs to midnight, and a gap as long as a slot goes.
 * @param {ScheduleDefaults | null | undefined} defaults
 * @returns {Schedule}
 */
export function scheduleFromDefaults(defaults) {
  const d = cleanDefaults(defaults);
  const start = d.dayStart ?? 0;
  const end = (d.dayEnd ?? DAY) > start ? d.dayEnd ?? DAY : DAY;
  const slot = d.slot ?? 60;
  const gap = (d.gap ?? 0) < slot ? d.gap ?? 0 : 0;
  return newSchedule({ gap, slot, cascade: d.cascade ?? "shift", now: d.now ?? true, start, end });
}
