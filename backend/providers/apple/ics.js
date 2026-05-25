// @ts-check
/**
 * @file ICS (iCalendar) string serialization + parsing. Pure string work,
 * no HTTP. Used by:
 *   - apple/events.js (parseVEvent + mapVEventToTaskInput when applying
 *     inbound deltas)
 *   - apple/write.js (buildVEvent when pushing outbound)
 *   - apple/sync.js (toIcsDateTime when computing windowed initial
 *     calendar-query bounds)
 */
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { buildVTimezone } from "../_vtimezones.js";

/**
 * UTC datetime in ICS format: YYYYMMDDTHHmmssZ
 * @param {Date} date
 */
export function toIcsDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function unescapeIcsText(s) {
  return String(s)
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

export function escapeIcsText(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Parse a CalDAV/ICS DTSTART/DTEND value into a real UTC-anchored Date.
 *
 * Three cases per RFC 5545 §3.3.5:
 *   - "YYYYMMDDTHHmmssZ"               — already UTC
 *   - "YYYYMMDDTHHmmss" with TZID=…    — wallclock in that IANA zone
 *   - "YYYYMMDDTHHmmss" floating       — undefined zone; we interpret it as
 *                                        `fallbackTz` (the calendar's display
 *                                        zone), which matches how iCloud and
 *                                        most CalDAV servers render floating
 *                                        events to the user.
 *
 * date-fns-tz handles DST correctly using Node's bundled IANA tz database
 * (Intl), so a 2026-03-08T02:30 in America/New_York correctly resolves to
 * 06:30 UTC even though that wallclock technically doesn't exist (DST jump).
 *
 * @param {string} value
 * @param {string} tzid
 * @param {string} fallbackTz
 * @returns {Date | null}
 */
export function parseIcsDateTime(value, tzid, fallbackTz) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [, Y, M, D, h, mi, s, z] = m;
  if (z === "Z") {
    return new Date(Date.UTC(+Y, +M - 1, +D, +h, +mi, +s));
  }
  const zone = tzid || fallbackTz || "UTC";
  // fromZonedTime expects a "YYYY-MM-DDTHH:mm:ss" wallclock and a zone.
  const wall = `${Y}-${M}-${D}T${h}:${mi}:${s}`;
  try {
    return fromZonedTime(wall, zone);
  } catch {
    // Bad zone → fall back to floating-as-UTC so the event still imports.
    return new Date(Date.UTC(+Y, +M - 1, +D, +h, +mi, +s));
  }
}

export function formatYmdInTz(date, tz) {
  try {
    return formatInTimeZone(date, tz || "UTC", "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(date, "UTC", "yyyy-MM-dd");
  }
}

export function formatTaskTimeInTz(date, tz) {
  // Zephyrly's task_time format is "H:MMAM|PM" with no leading zero on the
  // hour. date-fns format `h:mma` matches "1:00PM"; we lowercase-uppercase to
  // get "AM"/"PM" instead of "am"/"pm".
  try {
    return formatInTimeZone(date, tz || "UTC", "h:mmaaa")
      .replace("am", "AM")
      .replace("pm", "PM");
  } catch {
    return formatInTimeZone(date, "UTC", "h:mmaaa")
      .replace("am", "AM")
      .replace("pm", "PM");
  }
}

/**
 * Build a minimal VCALENDAR/VEVENT body. Used for both create and update.
 *
 * @param {{
 *   uid: string,
 *   summary: string,
 *   description?: string,
 *   start: { date?: string, dateTime?: string, tzid?: string },
 *   end?: { date?: string, dateTime?: string, tzid?: string },
 *   rrule?: string,
 *   color?: string,
 * }} ev
 */
export function buildVEvent(ev) {
  const now = new Date();
  const dtstamp = toIcsDateTime(now);
  const startLine = ev.start.date
    ? `DTSTART;VALUE=DATE:${ev.start.date.replace(/-/g, "")}`
    : ev.start.tzid
      ? `DTSTART;TZID=${ev.start.tzid}:${ev.start.dateTime}`
      : `DTSTART:${ev.start.dateTime}`;
  const endLine = ev.end
    ? ev.end.date
      ? `DTEND;VALUE=DATE:${ev.end.date.replace(/-/g, "")}`
      : ev.end.tzid
        ? `DTEND;TZID=${ev.end.tzid}:${ev.end.dateTime}`
        : `DTEND:${ev.end.dateTime}`
    : "";

  // Collect TZIDs referenced by this event so we can prepend matching
  // VTIMEZONE blocks before VEVENT. Servers that interpret TZID strictly
  // (Outlook/Exchange, some shared CalDAV servers) require this; iCloud
  // tolerates omissions, but it's never wrong to include them.
  const tzids = new Set();
  if (ev.start.tzid) tzids.add(ev.start.tzid);
  if (ev.end?.tzid) tzids.add(ev.end.tzid);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zephyrly//Zephyrly 1.0//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const tzid of tzids) {
    const block = buildVTimezone(tzid);
    if (block) lines.push(...block);
    // If we don't have a hardcoded definition, fall through silently —
    // Apple will resolve the TZID by name. Future Outlook support should
    // reject events here instead.
  }
  lines.push(
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${dtstamp}`,
    startLine,
    endLine,
    `SUMMARY:${escapeIcsText(ev.summary || "")}`,
  );
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
  if (ev.rrule) lines.push(`RRULE:${ev.rrule.replace(/^RRULE:/i, "")}`);
  // RFC 7986 §5.9 — per-event color override. iOS/macOS Calendar honors
  // this for individual events; Apple Web (iCloud.com) is hit or miss.
  // Spec calls for a CSS3 color name, but every implementation we've
  // tested also accepts #RRGGBB hex, which preserves shade fidelity for
  // the deeper Tailwind variants.
  if (ev.color) lines.push(`COLOR:${ev.color}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  // Re-fold long lines at 75 octets per RFC 5545 §3.1.
  return lines.filter(Boolean).map(foldIcsLine).join("\r\n") + "\r\n";
}

export function foldIcsLine(line) {
  if (line.length <= 75) return line;
  const chunks = [];
  let i = 0;
  while (i < line.length) {
    chunks.push((i === 0 ? "" : " ") + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}
