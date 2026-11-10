// @ts-check
/**
 * The height of the calendar's scrolling views (day, week): what is left
 * of the screen under the page header, so the hours scroll inside the
 * panel and the page itself stays still. One value, so the two views are
 * the same size and switching between them doesn't jump.
 */
export const CALENDAR_PANEL_HEIGHT = "h-[calc(100dvh-23rem)] min-h-[20rem] sm:h-[calc(100dvh-17.5rem)]";
