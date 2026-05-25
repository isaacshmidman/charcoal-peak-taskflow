// @ts-check
/**
 * @file Outbound writes against an iCloud calendar: PUT event, DELETE
 * event, PROPPATCH calendar color, plus the href + UID generators used
 * to address new events. All wrap caldavRequest.
 */
import { randomUUID } from "node:crypto";
import { HttpStatusError } from "../../lib/http-status-error.js";
import { caldavRequest, stripEtag } from "./caldav.js";

/**
 * @param {{ email: string, password: string, origin: string }} ctx
 * @param {string} href — absolute URL of the event resource
 * @param {string} ics
 * @param {string} [etag] If-Match for safe updates
 * @returns {Promise<{ status: number, etag: string }>}
 */
export async function putEvent(ctx, href, ics, etag) {
  const headers = { "Content-Type": "text/calendar; charset=utf-8" };
  if (etag) headers["If-Match"] = etag;
  else headers["If-None-Match"] = "*";
  const resp = await caldavRequest(ctx, "PUT", href, { headers, body: ics, allowStatuses: [412] });
  // 412 = our If-Match lost the race, or If-None-Match found an existing UID.
  // Fall back to unconditional PUT so the user's edit lands.
  if (resp.status === 412) {
    const retry = await caldavRequest(ctx, "PUT", href, {
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
      body: ics,
    });
    return { status: retry.status, etag: stripEtag(retry.headers.get("etag")) };
  }
  return { status: resp.status, etag: stripEtag(resp.headers.get("etag")) };
}

/**
 * Delete an event. Quiet on 404/410.
 *
 * @param {{ email: string, password: string, origin: string }} ctx
 * @param {string} href
 * @param {string} [etag]
 */
export async function deleteEvent(ctx, href, etag) {
  const headers = etag ? { "If-Match": etag } : {};
  try {
    await caldavRequest(ctx, "DELETE", href, { headers });
  } catch (err) {
    const s = /** @type {any} */ (err).statusCode;
    if (s === 404 || s === 410) return;
    if (s === 412) {
      // etag race — retry without If-Match.
      await caldavRequest(ctx, "DELETE", href, {});
      return;
    }
    throw err;
  }
}

/**
 * PROPPATCH a calendar's color. iCloud uses Apple's namespaced
 * `apple-calendar-color` property. The value is an 8-digit hex
 * `#RRGGBBAA` — we accept a normal `#RRGGBB` and append `FF` for full
 * alpha (transparent calendars wouldn't be useful here).
 *
 * @param {{ email: string, password: string, origin: string }} ctx
 * @param {string} calendarUrl  the absolute CalDAV calendar URL
 * @param {string} hex          "#RRGGBB"
 */
export async function setCalendarColor(ctx, calendarUrl, hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new HttpStatusError(`Invalid hex color: ${hex}`, 400);
  }
  const value = `${hex}FF`; // RRGGBBAA — full alpha
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <A:calendar-color>${value}</A:calendar-color>
    </D:prop>
  </D:set>
</D:propertyupdate>`;
  await caldavRequest(ctx, "PROPPATCH", calendarUrl, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body,
  });
}

/**
 * Build the absolute href where a new event should live: the calendar URL
 * with a `<UID>.ics` suffix. iCloud accepts arbitrary paths inside a
 * calendar collection, but using `<UID>.ics` is the universal convention.
 */
export function eventHrefForUid(calendarUrl, uid) {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return `${base}${encodeURIComponent(uid)}.ics`;
}

/** Generate a UID for a new Zephyrly-originated event. */
export function newEventUid() {
  return `zephyrly-${randomUUID()}@zephyrly`;
}
