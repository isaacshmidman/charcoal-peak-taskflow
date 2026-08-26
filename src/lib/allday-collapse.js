// @ts-check
/**
 * @file When collapsing the all-day row is actually worth doing.
 *
 * Collapsing hides rows but adds an "N more" button in their place, and
 * that button is nearly as tall as a row (24px vs 26px). So hiding a
 * SINGLE task saved 26px and spent 24px — expanding grew the strip by
 * two pixels, which reads as the toggle being broken.
 *
 * Collapse therefore only applies when at least two rows would be
 * hidden. Below that the tasks are simply all shown, with no button and
 * no expand affordance to press.
 */

/** Rows kept visible while collapsed. */
export const COLLAPSED_ALLDAY_VISIBLE = 2;

/**
 * @param {number} count how many all-day tasks the cell holds
 * @returns {boolean} whether collapsing this cell saves meaningful space
 */
export function canCollapseAllDay(count) {
  return count > COLLAPSED_ALLDAY_VISIBLE + 1;
}
