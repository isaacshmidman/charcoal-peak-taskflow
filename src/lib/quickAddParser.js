// @ts-check
/**
 * @file Natural-language quick-add parser. Pure and deterministic —
 * `now` is injected, no module state, no DOM. The QuickAdd input calls
 * this on every keystroke for the live chips preview and on submit.
 *
 * Grammar (scope-fenced on purpose):
 * - Sigils (explicit intent): `#tag`, `#"multi word tag"`, `!priority`.
 *   `!name` fuzzy-matches the USER'S custom priorities (exact > prefix >
 *   substring > edit-distance ≤ 2); below-threshold stays literal in the
 *   title — never guess a priority silently.
 * - Dates (implicit, stricter bar): today, tomorrow/tmrw, weekday names
 *   (nearest occurrence, today counts), "next week" (next Monday),
 *   "jun 12"/"12 jun" (month names ONLY with an adjacent day number),
 *   ISO YYYY-MM-DD, M/D. Past month-days roll to next year.
 * - Times: 2pm, 2:30pm, 14:30 (colon required for 24h), "at 2" (bare
 *   hour only with "at"), ranges 2-3pm / 2pm-3:30pm → start + end.
 * - Recurrence ONLY via "every …": day/weekday(s)/week/other week/
 *   2 weeks/month/quarter/year/<weekday>/<mon,wed,fri list>. Bare
 *   "daily" never tokenizes — "daily standup" is a title.
 * - One slot per field, LAST occurrence wins; earlier same-type matches
 *   stay literal in the title (predictable + visible).
 * - Double quotes are the universal literal escape: quoted text is never
 *   tokenized; the quotes themselves are stripped from the title.
 * - `ignoredTokens` (Set of "type:lowercased-raw") suppresses specific
 *   natural-language matches — the chips' "keep as text" dismissal.
 *
 * Output fields map 1:1 onto Task: due_date "YYYY-MM-DD", task_time /
 * task_end_time "9:00AM" strings (minutesToTaskTime), tags[],
 * priority_id, and for recurrence: task_type "recurring" + recurrence +
 * recurrence_days (Sun=0..Sat=6, matching RecurrenceFields).
 */

import { minutesToTaskTime } from "@/lib/sort-helpers";

const WEEKDAYS = [
  { day: 0, names: ["sunday", "sun"] },
  { day: 1, names: ["monday", "mon"] },
  { day: 2, names: ["tuesday", "tue", "tues"] },
  { day: 3, names: ["wednesday", "wed"] },
  { day: 4, names: ["thursday", "thu", "thur", "thurs"] },
  { day: 5, names: ["friday", "fri"] },
  { day: 6, names: ["saturday", "sat"] },
];
const WEEKDAY_LOOKUP = new Map(WEEKDAYS.flatMap(({ day, names }) => names.map((n) => [n, day])));
const WEEKDAY_ALT = WEEKDAYS.flatMap((w) => w.names).sort((a, b) => b.length - a.length).join("|");

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MONTH_ALT = MONTHS.map((m) => `${m.slice(0, 3)}[a-z]*`).join("|");

function monthIndexFrom(raw) {
  const three = raw.slice(0, 3).toLowerCase();
  return MONTHS.findIndex((m) => m.startsWith(three));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Nearest occurrence of `weekday` on/after `now` (today counts). */
function nearestWeekday(now, weekday) {
  const base = startOfDay(now);
  const delta = (weekday - base.getDay() + 7) % 7;
  base.setDate(base.getDate() + delta);
  return base;
}

/** Small classic Levenshtein — only ever called on short strings. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3; // early out past our threshold
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Fuzzy-match a `!query` against the user's priorities.
 * @returns {{ id: string, name: string } | null}
 */
export function fuzzyMatchPriority(query, priorities) {
  const q = query.toLowerCase();
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const p of priorities || []) {
    const name = String(p.name || "").toLowerCase();
    if (!name) continue;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (q.length >= 3 && editDistance(name, q) <= 2) score = 40;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return bestScore >= 40 ? { id: best.id, name: best.name } : null;
}

const RECURRENCE_PHRASES = [
  { re: /\bevery\s+day\b/i, value: () => ({ recurrence: "daily" }) },
  { re: /\bevery\s+weekdays?\b/i, value: () => ({ recurrence: "weekdays" }) },
  { re: /\bevery\s+(?:other\s+week|2\s+weeks|two\s+weeks)\b/i, value: () => ({ recurrence: "biweekly" }) },
  { re: /\bevery\s+week\b/i, value: () => ({ recurrence: "weekly" }) },
  { re: /\bevery\s+month\b/i, value: () => ({ recurrence: "monthly" }) },
  { re: /\bevery\s+(?:quarter|3\s+months|three\s+months)\b/i, value: () => ({ recurrence: "quarterly" }) },
  { re: /\bevery\s+year\b/i, value: () => ({ recurrence: "yearly" }) },
];
// every mon,wed,fri (2+ days, comma/and separated) — before single-day.
const RECUR_DAYLIST_RE = new RegExp(
  `\\bevery\\s+((?:${WEEKDAY_ALT})(?:\\s*(?:,|and)\\s*(?:${WEEKDAY_ALT}))+)\\b`,
  "i"
);
const RECUR_SINGLE_DAY_RE = new RegExp(`\\bevery\\s+(${WEEKDAY_ALT})\\b`, "i");

const DATE_PATTERNS = [
  { type: "iso", re: /\b(\d{4})-(\d{2})-(\d{2})\b/g },
  { type: "slash", re: /\b(\d{1,2})\/(\d{1,2})\b/g },
  {
    type: "monthday",
    re: new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\b`, "gi"),
  },
  { type: "nextweek", re: /\bnext\s+week\b/gi },
  { type: "word", re: /\b(today|tomorrow|tmrw)\b/gi },
  { type: "weekday", re: new RegExp(`\\b(${WEEKDAY_ALT})\\b(?!'|’)`, "gi") },
];

// Ranges first so "2pm" inside "2-3pm" isn't matched alone. End must
// carry a meridiem (a bare "2-3" is a quantity, not a time).
const TIME_RANGE_RE = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\s*[-–]\s*(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi;
const TIME_12H_RE = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi;
const TIME_24H_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
const TIME_AT_RE = /\bat\s+(1[0-2]|0?[1-9])\b(?!\s*(?::|am|pm))/gi;

/**
 * @param {string} input
 * @param {{
 *   priorities?: Array<{id: string, name: string}>,
 *   now?: Date,
 *   ignoredTokens?: Set<string>,
 * }} [options]
 */
export function parseQuickAdd(input, { priorities = [], now = new Date(), ignoredTokens } = {}) {
  const text = String(input || "");
  const ignored = ignoredTokens || new Set();
  /** @type {Array<{type: string, raw: string, start: number, end: number, value: any}>} */
  const tokens = [];
  /** @type {Array<[number, number]>} */
  const consumed = [];
  /** @type {Array<[number, number]>} */
  const protectedSpans = [];
  /** ranges to strip from the title without being tokens (bare quotes) */
  const stripOnly = [];

  const overlaps = (start, end, ranges) => ranges.some(([s, e]) => start < e && end > s);
  const isFree = (start, end) => !overlaps(start, end, protectedSpans) && !overlaps(start, end, consumed);
  const isIgnored = (type, raw) => ignored.has(`${type}:${raw.toLowerCase()}`);

  // ── Pass 0: quoted literals. `#"…"` is a quoted TAG; a bare "…" is
  // pure protection — contents stay in the title, quotes stripped.
  const quoteRe = /"([^"]*)"/g;
  let qm;
  while ((qm = quoteRe.exec(text))) {
    const start = qm.index;
    if (text[start - 1] === "#") continue; // handled by the tag pass
    protectedSpans.push([start, start + qm[0].length]);
    stripOnly.push([start, start + 1], [start + qm[0].length - 1, start + qm[0].length]);
  }

  // ── Pass 1: tags ──
  const tagRe = /#"([^"]+)"|#([^\s#!"]+)/g;
  let tm;
  const tags = [];
  while ((tm = tagRe.exec(text))) {
    const start = tm.index;
    const end = start + tm[0].length;
    if (!isFree(start, end)) continue;
    const value = (tm[1] ?? tm[2]).trim();
    if (!value) continue;
    tokens.push({ type: "tag", raw: tm[0], start, end, value });
    consumed.push([start, end]);
    if (!tags.includes(value)) tags.push(value);
  }

  // ── Pass 2: priority (fuzzy against the user's own names) ──
  const priRe = /!([^\s#!"]+)/g;
  let pm;
  let priorityToken = null;
  while ((pm = priRe.exec(text))) {
    const start = pm.index;
    const end = start + pm[0].length;
    if (!isFree(start, end)) continue;
    const match = fuzzyMatchPriority(pm[1], priorities);
    if (!match) continue; // below threshold → stays literal in the title
    priorityToken = { type: "priority", raw: pm[0], start, end, value: match };
  }
  if (priorityToken) {
    tokens.push(priorityToken);
    consumed.push([priorityToken.start, priorityToken.end]);
  }

  // ── Pass 3: recurrence ("every …" only) — before dates so the day
  // name inside "every monday" isn't double-parsed as a date.
  /** @type {{type: string, raw: string, start: number, end: number, value: any} | null} */
  let recurrenceToken = null;
  const tryRecurrence = (start, end, raw, value) => {
    if (!isFree(start, end) || isIgnored("recurrence", raw)) return;
    recurrenceToken = { type: "recurrence", raw, start, end, value };
  };
  const dayList = RECUR_DAYLIST_RE.exec(text);
  if (dayList) {
    const days = [...new Set(
      dayList[1].toLowerCase().split(/\s*(?:,|and)\s*/).map((d) => WEEKDAY_LOOKUP.get(d.trim())).filter((d) => d != null)
    )].sort((a, b) => a - b);
    if (days.length >= 2) {
      tryRecurrence(dayList.index, dayList.index + dayList[0].length, dayList[0], {
        recurrence: "custom_days",
        recurrence_days: days,
      });
    }
  }
  if (!recurrenceToken) {
    for (const { re, value } of RECURRENCE_PHRASES) {
      const m = re.exec(text);
      if (m) {
        tryRecurrence(m.index, m.index + m[0].length, m[0], value());
        if (recurrenceToken) break;
      }
    }
  }
  if (!recurrenceToken) {
    const single = RECUR_SINGLE_DAY_RE.exec(text);
    if (single) {
      const day = WEEKDAY_LOOKUP.get(single[1].toLowerCase());
      tryRecurrence(single.index, single.index + single[0].length, single[0], {
        recurrence: "weekly",
        anchorDay: day,
      });
    }
  }
  if (recurrenceToken) {
    tokens.push(recurrenceToken);
    consumed.push([recurrenceToken.start, recurrenceToken.end]);
  }

  // ── Pass 4: dates (last occurrence wins the slot) ──
  /** @type {Array<{type: string, raw: string, start: number, end: number, value: string}>} */
  const dateCandidates = [];
  for (const { type, re } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!isFree(start, end)) continue;
      if (isIgnored("date", m[0])) continue;
      let date = null;
      if (type === "iso") {
        date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else if (type === "slash") {
        const mo = Number(m[1]) - 1;
        const day = Number(m[2]);
        if (mo > 11 || day > 31 || day === 0) continue;
        date = new Date(now.getFullYear(), mo, day);
        if (startOfDay(date) < startOfDay(now)) date.setFullYear(date.getFullYear() + 1);
      } else if (type === "monthday") {
        const monthRaw = m[1] ?? m[4];
        const dayRaw = m[2] ?? m[3];
        const mo = monthIndexFrom(monthRaw);
        const day = Number(dayRaw);
        if (mo < 0 || day > 31 || day === 0) continue;
        date = new Date(now.getFullYear(), mo, day);
        if (startOfDay(date) < startOfDay(now)) date.setFullYear(date.getFullYear() + 1);
      } else if (type === "nextweek") {
        const base = nearestWeekday(now, 1); // next Monday…
        if (toDateStr(base) === toDateStr(startOfDay(now))) base.setDate(base.getDate() + 7);
        date = base;
      } else if (type === "word") {
        const w = m[1].toLowerCase();
        date = startOfDay(now);
        if (w !== "today") date.setDate(date.getDate() + 1);
      } else if (type === "weekday") {
        date = nearestWeekday(now, WEEKDAY_LOOKUP.get(m[1].toLowerCase()));
      }
      if (date && !Number.isNaN(date.getTime())) {
        dateCandidates.push({ type: "date", raw: m[0], start, end, value: toDateStr(date) });
      }
    }
  }
  const dateToken = dateCandidates.sort((a, b) => a.start - b.start).at(-1) || null;
  if (dateToken) {
    tokens.push(dateToken);
    consumed.push([dateToken.start, dateToken.end]);
  }

  // ── Pass 5: times (ranges before singles; last single wins) ──
  /** @type {{type: string, raw: string, start: number, end: number, value: any} | null} */
  let timeToken = null;
  TIME_RANGE_RE.lastIndex = 0;
  let rm;
  while ((rm = TIME_RANGE_RE.exec(text))) {
    const start = rm.index;
    const end = start + rm[0].length;
    if (!isFree(start, end) || isIgnored("time", rm[0])) continue;
    const endMeridiem = rm[6].toLowerCase();
    let startMeridiem = (rm[3] || endMeridiem).toLowerCase();
    const toMins = (h, mins, mer) => ((h % 12) + (mer === "pm" ? 12 : 0)) * 60 + (mins ? Number(mins) : 0);
    let startMins = toMins(Number(rm[1]), rm[2], startMeridiem);
    const endMins = toMins(Number(rm[4]), rm[5], endMeridiem);
    if (!rm[3] && startMins >= endMins) {
      // "11-1pm" → start flips to the other meridiem so the range is sane.
      startMeridiem = startMeridiem === "pm" ? "am" : "pm";
      startMins = toMins(Number(rm[1]), rm[2], startMeridiem);
    }
    timeToken = {
      type: "time", raw: rm[0], start, end,
      value: { task_time: minutesToTaskTime(startMins), task_end_time: minutesToTaskTime(endMins) },
    };
  }
  if (!timeToken) {
    /** @type {Array<{type: string, raw: string, start: number, end: number, value: any}>} */
    const singles = [];
    for (const re of [TIME_12H_RE, TIME_24H_RE, TIME_AT_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const start = m.index;
        const end = start + m[0].length;
        if (!isFree(start, end) || overlaps(start, end, singles.map((s) => [s.start, s.end]))) continue;
        if (isIgnored("time", m[0])) continue;
        let mins;
        if (re === TIME_12H_RE) {
          mins = ((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + (m[2] ? Number(m[2]) : 0);
        } else if (re === TIME_24H_RE) {
          mins = Number(m[1]) * 60 + Number(m[2]);
        } else {
          const h = Number(m[1]);
          mins = (h <= 7 ? h + 12 : h) * 60; // "at 2" → 2 PM; "at 9" → 9 AM
        }
        singles.push({ type: "time", raw: m[0], start, end, value: { task_time: minutesToTaskTime(mins) } });
      }
    }
    timeToken = singles.sort((a, b) => a.start - b.start).at(-1) || null;
  }
  if (timeToken) {
    tokens.push(timeToken);
    consumed.push([timeToken.start, timeToken.end]);
  }

  // ── Assemble fields ──
  /** @type {Record<string, any>} */
  const fields = {};
  if (tags.length) fields.tags = tags;
  if (priorityToken) fields.priority_id = priorityToken.value.id;
  if (dateToken) fields.due_date = dateToken.value;
  if (timeToken) Object.assign(fields, timeToken.value);
  if (recurrenceToken) {
    const { recurrence, recurrence_days, anchorDay } = recurrenceToken.value;
    fields.task_type = "recurring";
    fields.recurrence = recurrence;
    if (recurrence_days) fields.recurrence_days = recurrence_days;
    if (!fields.due_date) {
      // Recurring tasks need a due_date to advance from — first occurrence.
      if (anchorDay != null) fields.due_date = toDateStr(nearestWeekday(now, anchorDay));
      else if (recurrence === "custom_days" && recurrence_days?.length) {
        const next = recurrence_days
          .map((d) => nearestWeekday(now, d))
          .sort((a, b) => a.getTime() - b.getTime())[0];
        fields.due_date = toDateStr(next);
      } else if (recurrence === "weekdays") {
        const base = startOfDay(now);
        while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
        fields.due_date = toDateStr(base);
      } else {
        fields.due_date = toDateStr(startOfDay(now));
      }
    }
  }
  // A time implies "today" when no date was given.
  if (fields.task_time && !fields.due_date) fields.due_date = toDateStr(startOfDay(now));

  // ── Title = input minus consumed token ranges and quote characters ──
  const removals = [...consumed, ...stripOnly].sort((a, b) => a[0] - b[0]);
  let title = "";
  let cursor = 0;
  for (const [s, e] of removals) {
    if (s > cursor) title += text.slice(cursor, s);
    cursor = Math.max(cursor, e);
  }
  title += text.slice(cursor);
  title = title.replace(/\s+/g, " ").trim();

  return { title, fields, tokens: tokens.sort((a, b) => a.start - b.start) };
}
