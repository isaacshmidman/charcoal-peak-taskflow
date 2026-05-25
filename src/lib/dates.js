// @ts-check
/**
 * @file Small date-string helpers shared across calendar + task UI.
 * Canonical replacement for the 6 inline copies that lived next to
 * each consumer before Phase 5. Wraps `date-fns/format` and a
 * local-time Date constructor so a "yyyy-MM-dd" string round-trips
 * cleanly without sliding by a day across timezones.
 */
import { format } from "date-fns/format";

/**
 * @param {Date} date
 * @returns {string} yyyy-MM-dd in local time
 */
export const toDateStr = (date) => format(date, "yyyy-MM-dd");

/**
 * @param {string} str  A "yyyy-MM-dd" string
 * @returns {Date}  Local-midnight Date for that date
 */
export const fromDateStr = (str) => new Date(str + "T00:00:00");
