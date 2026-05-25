// @ts-check
/**
 * @file VEVENT parsing + mapping into Zephyrly's Task shape. Pure ICS
 * string work on the parse side; mapping consults the calendar's
 * timezone + access role to produce the right display fields.
 */
import {
  unescapeIcsText,
  parseIcsDateTime,
  formatYmdInTz,
  formatTaskTimeInTz,
} from "./ics.js";
import { parseRruleValueToTaskRecurrence } from "../../recurrence-rrule.js";

/**
 * Parse a single VEVENT out of an ICS string.
 *
 * Modified-instance overrides (with RECURRENCE-ID) and aggregated series
 * of a recurring series) are simplified by taking the first VEVENT block.
 *
 * @param {string} ics
 * @returns {null | {
 *   uid: string,
 *   summary: string,
 *   description: string,
 *   dtstart: { value: string, isDate: boolean, tzid: string },
 *   dtend: { value: string, isDate: boolean, tzid: string } | null,
 *   rrule: string,
 *   status: string,
 *   recurrenceId: string,
 * }}
 */
export function parseVEvent(ics) {
  if (!ics) return null;
  // RFC 5545 line folding: any CRLF followed by a SPACE or TAB continues the
  // previous line. Unfold first, then split.
  const unfolded = String(ics).replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  /** @type {Record<string, { value: string, params: Record<string, string> }>} */
  const props = {};
  for (const line of lines) {
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      if (inEvent) break; // first VEVENT only — skip overrides
      inEvent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent) break;
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = head.indexOf(";");
    const name = (semi === -1 ? head : head.slice(0, semi)).toUpperCase();
    /** @type {Record<string, string>} */
    const params = {};
    if (semi !== -1) {
      for (const part of head.slice(semi + 1).split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
      }
    }
    if (!props[name]) props[name] = { value, params };
  }
  if (!props.UID) return null;
  if (!props.DTSTART) return null;

  const parseDt = (p) => {
    const isDate = p.params.VALUE === "DATE" || /^\d{8}$/.test(p.value);
    return {
      value: p.value,
      isDate,
      tzid: p.params.TZID || "",
    };
  };

  return {
    uid: props.UID.value,
    summary: unescapeIcsText(props.SUMMARY?.value || ""),
    description: unescapeIcsText(props.DESCRIPTION?.value || ""),
    dtstart: parseDt(props.DTSTART),
    dtend: props.DTEND ? parseDt(props.DTEND) : null,
    rrule: props.RRULE?.value || "",
    status: (props.STATUS?.value || "").toUpperCase(),
    recurrenceId: props["RECURRENCE-ID"]?.value || "",
  };
}

/**
 * Convert a parsed VEVENT into a Zephyrly Task input.
 *
 * @param {ReturnType<typeof parseVEvent>} ev
 * @param {any} calendarRow
 * @returns {any | null}
 */
export function mapVEventToTaskInput(ev, calendarRow) {
  if (!ev) return null;

  // Display zone — what wallclock should show up in Zephyrly.
  // Prefer the per-calendar tz (from VTIMEZONE in calendar-timezone PROPFIND),
  // fall back to UTC. Final fallback prevents a missing tz from crashing
  // formatInTimeZone.
  const displayTz = String(calendarRow?.time_zone || "UTC") || "UTC";

  let due_date = "";
  let task_time = "";
  let task_end_time = "";

  if (ev.dtstart.isDate) {
    // YYYYMMDD → YYYY-MM-DD
    const v = ev.dtstart.value;
    if (v.length !== 8) return null;
    due_date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  } else {
    const startDt = parseIcsDateTime(ev.dtstart.value, ev.dtstart.tzid, displayTz);
    if (!startDt) return null;
    due_date = formatYmdInTz(startDt, displayTz);
    task_time = formatTaskTimeInTz(startDt, displayTz);
    if (ev.dtend) {
      const endDt = parseIcsDateTime(ev.dtend.value, ev.dtend.tzid, displayTz);
      if (endDt && formatYmdInTz(endDt, displayTz) === due_date) {
        task_end_time = formatTaskTimeInTz(endDt, displayTz);
      }
    }
  }

  // Apple iCloud personal calendars are the user's own — anything writable is
  // a "task"-equivalent. Read-only (subscribed/shared) calendars become "event".
  const writable = !calendarRow || calendarRow.access_role === "writer" || calendarRow.access_role === "owner";
  const sourceKind = writable ? "task" : "event";

  // Recurrence — same parser shape as Google's so the UI renders the violet dot.
  const recurrenceMapped = ev.rrule
    ? parseRruleValueToTaskRecurrence(ev.rrule, { dtstartYmd: due_date })
    : null;
  const taskType = recurrenceMapped?.recurrence ? "recurring" : "one_time";

  return {
    title: String(ev.summary || "(No title)").slice(0, 200),
    description: String(ev.description || "").slice(0, 5000),
    due_date,
    task_time,
    task_end_time,
    status: "todo",
    task_type: taskType,
    recurrence: recurrenceMapped?.recurrence || "none",
    recurrence_days: recurrenceMapped?.recurrence_days || [],
    recurrence_end_date: recurrenceMapped?.recurrence_end_date || "",
    source_provider: "apple",
    source_kind: sourceKind,
    source_calendar_id: calendarRow?.external_calendar_id || "",
    source_calendar_name: calendarRow?.summary || "",
    source_color_hex: calendarRow?.color_hex || "",
    source_writable: writable,
    source_recurrence_rule: ev.rrule ? `RRULE:${ev.rrule}` : "",
  };
}
