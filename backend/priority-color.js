// @ts-check
/**
 * Map Zephyrly's priority colors to provider-native event colors.
 *
 * Zephyrly's color palette (see src/lib/colors.js) has 20 named values
 * (red, blue, blue_alt, brown, …). This module narrows that down to:
 *   - Google Calendar's 11 fixed event `colorId`s (1..11). Anything Google
 *     can't represent natively snaps to the closest hue.
 *   - An RFC 7986 §5.9 COLOR property value for Apple ICS — emitted as a
 *     #RRGGBB hex string. The RFC technically expects CSS3 named colors,
 *     but every real-world Apple/iCloud implementation we've tested
 *     accepts hex too, and hex preserves shade fidelity for the *_alt
 *     variants the named palette can't express.
 *
 * Lookups happen in push.js per-task; the priorities table is small
 * (typically <10 rows) and we don't bother with a cache — a single
 * indexed SELECT per push is fine alongside the existing rate-limited
 * outbound queue.
 */

/**
 * Google Calendar event colorId reference (per Google's Events: insert
 * docs and the calendar.colors.get response):
 *   1  Lavender   #a4bdfc
 *   2  Sage       #7ae7bf
 *   3  Grape      #dbadff
 *   4  Flamingo   #ff887c
 *   5  Banana     #fbd75b
 *   6  Tangerine  #ffb878
 *   7  Peacock    #46d6db
 *   8  Graphite   #e1e1e1
 *   9  Blueberry  #5484ed
 *   10 Basil      #51b749
 *   11 Tomato     #dc2127
 *
 * Mapping picks the closest hue/intensity match for each Zephyrly color.
 * The *_alt (deeper) variants share Google IDs with their base colors —
 * Google has no "deep" tier so we accept the lossy collapse rather than
 * leaving them uncolored.
 *
 * @type {Record<string, string>}
 */
const COLOR_TO_GOOGLE_ID = {
  red: "11",        // Tomato
  orange: "6",      // Tangerine
  yellow: "5",      // Banana
  green: "10",      // Basil
  blue: "9",        // Blueberry
  violet: "3",      // Grape
  pink: "4",        // Flamingo
  teal: "2",        // Sage
  cyan: "7",        // Peacock
  rose: "4",        // Flamingo (closest to coral/rose)
  slate: "8",       // Graphite
  black: "8",       // Graphite (no true black option)
  white: "8",       // Graphite (no true white option)
  brown: "6",       // Tangerine (Google has no brown)
  red_alt: "11",    // Tomato
  orange_alt: "6",  // Tangerine
  yellow_alt: "5",  // Banana
  green_alt: "10",  // Basil
  blue_alt: "9",    // Blueberry
  violet_alt: "3",  // Grape
};

/**
 * Hex equivalents of the Tailwind shades used in Zephyrly's swatch
 * picker (see src/lib/colors.js). Used for Apple's COLOR property and
 * any other consumer that wants a single hex per priority color.
 *
 * Numbers chosen to match the Tailwind palette swatches we render in
 * the picker so the calendar event color visually echoes what the
 * user sees in-app.
 *
 * @type {Record<string, string>}
 */
const COLOR_TO_HEX = {
  red: "#f87171",         // red-400
  orange: "#fb923c",      // orange-400
  yellow: "#facc15",      // yellow-400
  green: "#4ade80",       // green-400
  blue: "#60a5fa",        // blue-400
  violet: "#a78bfa",      // violet-400
  pink: "#f472b6",        // pink-400
  teal: "#2dd4bf",        // teal-400
  cyan: "#22d3ee",        // cyan-400
  rose: "#fb7185",        // rose-400
  slate: "#94a3b8",       // slate-400
  black: "#0f172a",       // slate-900
  white: "#ffffff",       // white
  brown: "#b45309",       // amber-700
  red_alt: "#dc2626",     // red-600
  orange_alt: "#ea580c",  // orange-600
  yellow_alt: "#ca8a04",  // yellow-600
  green_alt: "#15803d",   // green-700
  blue_alt: "#1d4ed8",    // blue-700
  violet_alt: "#6d28d9",  // violet-700
};

/**
 * Look up a priority's color name from the DB. Returns "" when the
 * task has no priority assigned, or the priority row is missing.
 *
 * @param {any} db
 * @param {string} appId
 * @param {string} priorityId
 * @returns {string}
 */
export function lookupPriorityColor(db, appId, priorityId) {
  if (!priorityId) return "";
  try {
    const row = db
      .prepare(`SELECT color FROM priorities WHERE app_id = ? AND id = ?`)
      .get(appId, priorityId);
    return row && typeof row === "object" && "color" in row
      ? String(row.color || "")
      : "";
  } catch {
    return "";
  }
}

/**
 * @param {string} colorName
 * @returns {string|undefined}  e.g. "11" for Tomato; undefined if no mapping.
 */
export function colorNameToGoogleColorId(colorName) {
  return COLOR_TO_GOOGLE_ID[colorName];
}

/**
 * @param {string} colorName
 * @returns {string|undefined}  e.g. "#f87171"; undefined if no mapping.
 */
export function colorNameToHex(colorName) {
  return COLOR_TO_HEX[colorName];
}
