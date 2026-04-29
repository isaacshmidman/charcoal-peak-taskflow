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
 *   - If the task carries a `source_recurrence_rule` (i.e. was imported
 *     from a provider as a recurring event), we round-trip THAT verbatim
 *     instead of re-deriving from native fields. This avoids lossy
 *     re-encoding of complex RRULEs (BYMONTHDAY, BYSETPOS, COUNT, etc.)
 *     that Zephyrly's native model can't represent.
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

/**
 * Build the "RRULE:..." line for a task, or null if the task isn't
 * recurring (or already carries an imported source rule the caller
 * should reuse).
 *
 * @param {any} task
 * @returns {string|null}
 */
export function taskToRruleLine(task) {
  if (!task) return null;

  // Imported series — caller should use source_recurrence_rule directly.
  if (task.source_recurrence_rule && String(task.source_recurrence_rule).trim()) {
    const raw = String(task.source_recurrence_rule).trim();
    return raw.startsWith("RRULE:") ? raw : `RRULE:${raw}`;
  }

  if (task.task_type !== "recurring") return null;
  const rec = task.recurrence;
  if (!rec || rec === "none") return null;

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
      return null;
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
