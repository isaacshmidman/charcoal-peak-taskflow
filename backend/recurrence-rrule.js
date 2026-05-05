// @ts-check
/**
 * Convert Zephyrly's native recurrence fields into an RFC 5545 RRULE string,
 * suitable for pushing to Google Calendar (event.recurrence array) or Apple
 * Calendar (RRULE line in VEVENT). This is the OUTBOUND mirror of
 * `parseRecurrence` in sync.js — that one parses an inbound RRULE into our
 * native fields, this one serializes our fields back out.
 *
 * Why a separate file:
 *   The mapping is small but has to live somewhere both push.js (Apple +
 *   Google paths) can import. Keeping it isolated means changes don't
 *   cascade into push.js's already-busy module.
 *
 * Native recurrence values handled (matches src/lib/recurrence.js):
 *   - none, daily, weekdays, custom_days (+ recurrence_days[]),
 *     weekly, biweekly, monthly, quarterly, yearly
 *
 * Out-of-band:
 *   - If an imported task uses a recurrence Zephyrly cannot represent
 *     natively (`recurrence: "custom"`), we round-trip its
 *     `source_recurrence_rule` verbatim. For native recurrence values,
 *     Zephyrly's fields win so user edits are reflected on the provider
 *     instead of being overwritten by stale imported RRULE text.
 *
 * UNTIL handling:
 *   - All-day tasks (no `task_time`): emit `UNTIL=YYYYMMDD` (date form).
 *   - Timed tasks: emit `UNTIL=YYYYMMDDT235959Z` (UTC end-of-day on the
 *     recurrence_end_date). Both Google and Apple accept these forms.
 *   - Without recurrence_end_date the rule has no UNTIL/COUNT and runs
 *     forever — same as Zephyrly's native semantics.
 */

// date-fns getDay() returns 0=Sun..6=Sat; map to RFC 5545 BYDAY codes.
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const CODE_TO_WEEKDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * Build the "RRULE:..." line for a task, or null if the task isn't recurring.
 *
 * @param {any} task
 * @returns {string|null}
 */
export function taskToRruleLine(task) {
  if (!task) return null;

  if (task.task_type !== "recurring") return null;
  const rec = task.recurrence;
  if (!rec || rec === "none") return null;

  const sourceLine = ensureRruleLine(task.source_recurrence_rule);
  if (rec === "custom" && sourceLine) return sourceLine;

  /** @type {string[]} */
  const parts = [];

  switch (rec) {
    case "daily":
      parts.push("FREQ=DAILY");
      break;
    case "weekdays":
      parts.push("FREQ=WEEKLY", "BYDAY=MO,TU,WE,TH,FR");
      break;
    case "custom_days": {
      const days = Array.isArray(task.recurrence_days) ? task.recurrence_days : [];
      const codes = days
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
        .map((n) => WEEKDAY_CODES[n]);
      // Without explicit days a custom-days rule is meaningless — fall
      // back to a plain weekly so we don't emit a malformed RRULE.
      if (codes.length === 0) {
        parts.push("FREQ=WEEKLY");
      } else {
        parts.push("FREQ=WEEKLY", `BYDAY=${codes.join(",")}`);
      }
      break;
    }
    case "weekly":
      parts.push("FREQ=WEEKLY");
      break;
    case "biweekly":
      parts.push("FREQ=WEEKLY", "INTERVAL=2");
      break;
    case "monthly":
      parts.push("FREQ=MONTHLY");
      break;
    case "quarterly":
      parts.push("FREQ=MONTHLY", "INTERVAL=3");
      break;
    case "yearly":
      parts.push("FREQ=YEARLY");
      break;
    default:
      return sourceLine;
  }

  // UNTIL — type must match DTSTART per RFC 5545 §3.3.10.
  const end = String(task.recurrence_end_date || "").trim();
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    const compact = end.replace(/-/g, "");
    if (task.task_time) {
      // Timed event → UNTIL is a UTC datetime. Use end-of-day so the
      // last occurrence on `recurrence_end_date` is included regardless
      // of timezone offset between the user's wall clock and UTC.
      parts.push(`UNTIL=${compact}T235959Z`);
    } else {
      // All-day → UNTIL is a date.
      parts.push(`UNTIL=${compact}`);
    }
  }

  return `RRULE:${parts.join(";")}`;
}

/**
 * Convert an RFC 5545 RRULE into the recurrence shape Zephyrly can execute.
 * Unsupported rules intentionally become `custom`: they remain marked as a
 * recurring provider item and can still round-trip through source_recurrence_rule,
 * but Zephyrly will not pretend it can auto-roll a rule it cannot model.
 *
 * @param {string} rule
 * @param {{ dtstartYmd?: string }} [opts]
 * @returns {{ recurrence: string, recurrence_days: number[], recurrence_end_date: string } | null}
 */
export function parseRruleValueToTaskRecurrence(rule, opts = {}) {
  const parts = parseRruleParts(rule);
  if (!parts.FREQ) return null;

  const freq = parts.FREQ;
  const interval = parsePositiveInt(parts.INTERVAL || "1") || 1;
  const until = parts.UNTIL ? rruleUntilToYmd(parts.UNTIL) : "";
  const days = parseByDay(parts.BYDAY || "");
  const hasOrdinalDay = hasOrdinalByday(parts.BYDAY || "");

  const custom = () => ({
    recurrence: "custom",
    recurrence_days: [],
    recurrence_end_date: until,
  });

  // Zephyrly does not have COUNT semantics. Keeping these as custom avoids
  // importing a finite provider series as an infinite native series.
  if (parts.COUNT) return custom();

  if (freq === "DAILY") {
    if (hasUnsupportedParts(parts, ["FREQ", "INTERVAL", "UNTIL", "WKST", "BYDAY"])) {
      return custom();
    }
    if (hasOrdinalDay) return custom();
    if (interval !== 1) return custom();
    if (sameNumberSet(days, WEEKDAYS)) {
      return { recurrence: "weekdays", recurrence_days: [], recurrence_end_date: until };
    }
    if (days.length > 0) {
      return { recurrence: "custom_days", recurrence_days: days, recurrence_end_date: until };
    }
    return { recurrence: "daily", recurrence_days: [], recurrence_end_date: until };
  }

  if (freq === "WEEKLY") {
    if (hasUnsupportedParts(parts, ["FREQ", "INTERVAL", "UNTIL", "WKST", "BYDAY"])) {
      return custom();
    }
    if (hasOrdinalDay) return custom();
    if (interval === 1) {
      if (sameNumberSet(days, WEEKDAYS)) {
        return { recurrence: "weekdays", recurrence_days: [], recurrence_end_date: until };
      }
      if (days.length > 0) {
        return { recurrence: "custom_days", recurrence_days: days, recurrence_end_date: until };
      }
      return { recurrence: "weekly", recurrence_days: [], recurrence_end_date: until };
    }
    if (interval === 2 && days.length <= 1) {
      return { recurrence: "biweekly", recurrence_days: [], recurrence_end_date: until };
    }
    return custom();
  }

  if (freq === "MONTHLY") {
    if (hasUnsupportedParts(parts, ["FREQ", "INTERVAL", "UNTIL", "WKST", "BYMONTHDAY"])) {
      return custom();
    }
    if (!monthDayMatchesDtstart(parts.BYMONTHDAY || "", opts.dtstartYmd)) {
      return custom();
    }
    if (interval === 1) {
      return { recurrence: "monthly", recurrence_days: [], recurrence_end_date: until };
    }
    if (interval === 3) {
      return { recurrence: "quarterly", recurrence_days: [], recurrence_end_date: until };
    }
    return custom();
  }

  if (freq === "YEARLY") {
    if (hasUnsupportedParts(parts, ["FREQ", "INTERVAL", "UNTIL", "WKST", "BYMONTH", "BYMONTHDAY"])) {
      return custom();
    }
    if (interval !== 1) return custom();
    if (!yearlyByDateMatchesDtstart(parts, opts.dtstartYmd)) return custom();
    return { recurrence: "yearly", recurrence_days: [], recurrence_end_date: until };
  }

  return custom();
}

function ensureRruleLine(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  return /^RRULE:/i.test(trimmed) ? trimmed : `RRULE:${trimmed}`;
}

function parseRruleParts(rule) {
  const value = String(rule || "").trim().replace(/^RRULE:/i, "");
  return value.split(";").reduce((acc, piece) => {
    const idx = piece.indexOf("=");
    if (idx <= 0) return acc;
    const key = piece.slice(0, idx).trim().toUpperCase();
    const val = piece.slice(idx + 1).trim().toUpperCase();
    if (key && val) acc[key] = val;
    return acc;
  }, /** @type {Record<string, string>} */ ({}));
}

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseByDay(value) {
  const seen = new Set();
  for (const raw of String(value || "").split(",")) {
    const token = raw.trim().toUpperCase();
    if (!token) continue;
    const n = CODE_TO_WEEKDAY[token];
    if (n != null) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

function hasOrdinalByday(value) {
  return String(value || "")
    .split(",")
    .some((token) => /^[+-]?\d/.test(token.trim()));
}

function sameNumberSet(a, b) {
  if (a.length !== b.length) return false;
  const aa = [...a].sort((x, y) => x - y);
  const bb = [...b].sort((x, y) => x - y);
  return aa.every((n, i) => n === bb[i]);
}

function hasUnsupportedParts(parts, allowed) {
  const allowedSet = new Set(allowed);
  return Object.keys(parts).some((key) => !allowedSet.has(key));
}

function monthDayMatchesDtstart(byMonthDay, dtstartYmd) {
  if (!byMonthDay) return true;
  if (!dtstartYmd) return false;
  const values = byMonthDay.split(",").map((v) => parsePositiveInt(v)).filter((n) => n != null);
  if (values.length !== 1) return false;
  const day = Number.parseInt(dtstartYmd.slice(8, 10), 10);
  return values[0] === day;
}

function yearlyByDateMatchesDtstart(parts, dtstartYmd) {
  if (!parts.BYMONTH && !parts.BYMONTHDAY) return true;
  if (!dtstartYmd) return false;
  const month = Number.parseInt(dtstartYmd.slice(5, 7), 10);
  const day = Number.parseInt(dtstartYmd.slice(8, 10), 10);

  if (parts.BYMONTH) {
    const months = parts.BYMONTH.split(",").map((v) => parsePositiveInt(v)).filter((n) => n != null);
    if (months.length !== 1 || months[0] !== month) return false;
  }
  if (parts.BYMONTHDAY) {
    const days = parts.BYMONTHDAY.split(",").map((v) => parsePositiveInt(v)).filter((n) => n != null);
    if (days.length !== 1 || days[0] !== day) return false;
  }
  return true;
}

function rruleUntilToYmd(until) {
  const ymd = String(until || "").slice(0, 8);
  if (!/^\d{8}$/.test(ymd)) return "";
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}
