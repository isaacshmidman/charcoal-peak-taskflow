/**
 * Shared color palette for priority swatches and task card backgrounds.
 * Used by Settings (swatch picker), TaskCard (card bg), and RecentlyDeleted
 * (DeletedTaskCard bg). Keep in sync — adding a color here adds it everywhere.
 */

/**
 * @typedef {{ value: string, label: string, class: string }} ColorOption
 */

/** @type {ColorOption[]} */
export const COLOR_OPTIONS = [
  { value: "red", label: "Red", class: "bg-red-400" },
  { value: "orange", label: "Orange", class: "bg-orange-400" },
  { value: "yellow", label: "Yellow", class: "bg-yellow-400" },
  { value: "green", label: "Green", class: "bg-green-400" },
  { value: "blue", label: "Blue", class: "bg-blue-400" },
  { value: "violet", label: "Violet", class: "bg-violet-400" },
  { value: "pink", label: "Pink", class: "bg-pink-400" },
  { value: "teal", label: "Teal", class: "bg-teal-400" },
  { value: "cyan", label: "Cyan", class: "bg-cyan-400" },
  { value: "rose", label: "Rose", class: "bg-rose-400" },
  { value: "slate", label: "Gray", class: "bg-slate-400" },
  { value: "black", label: "Black", class: "bg-slate-900 dark:bg-slate-100" },
  { value: "white", label: "White", class: "bg-white border border-slate-300 dark:border-slate-500" },
  { value: "brown", label: "Brown", class: "bg-amber-700" },
  { value: "red_alt", label: "Red (deep)", class: "bg-red-600" },
  { value: "orange_alt", label: "Orange (deep)", class: "bg-orange-600" },
  { value: "yellow_alt", label: "Yellow (deep)", class: "bg-yellow-600" },
  { value: "green_alt", label: "Green (deep)", class: "bg-green-700" },
  { value: "blue_alt", label: "Blue (deep)", class: "bg-blue-700" },
  { value: "violet_alt", label: "Violet (deep)", class: "bg-violet-700" },
];

/** Small circular dot class per color — used by inline priority indicators. */
/** @type {Record<string, string>} */
export const colorDot = {
  red: "bg-red-400",
  orange: "bg-orange-400",
  yellow: "bg-yellow-400",
  green: "bg-green-400",
  blue: "bg-blue-400",
  violet: "bg-violet-400",
  pink: "bg-pink-400",
  teal: "bg-teal-400",
  cyan: "bg-cyan-400",
  rose: "bg-rose-400",
  slate: "bg-slate-400",
  black: "bg-slate-900 dark:bg-slate-100",
  white: "bg-white border border-slate-300 dark:border-slate-500",
  brown: "bg-amber-700",
  red_alt: "bg-red-600",
  orange_alt: "bg-orange-600",
  yellow_alt: "bg-yellow-600",
  green_alt: "bg-green-700",
  blue_alt: "bg-blue-700",
  violet_alt: "bg-violet-700",
};

/** Task card background + border class, tuned to match the dot hue at low saturation. */
/** @type {Record<string, string>} */
export const colorBg = {
  red: "bg-red-50 border-red-100 dark:bg-[#2a1116] dark:border-[#6f2634]",
  orange: "bg-orange-50 border-orange-100 dark:bg-[#2b180f] dark:border-[#76401c]",
  yellow: "bg-yellow-50 border-yellow-100 dark:bg-[#29230e] dark:border-[#73621d]",
  green: "bg-green-50 border-green-100 dark:bg-[#10261b] dark:border-[#2f6f4b]",
  blue: "bg-blue-50 border-blue-100 dark:bg-[#101f34] dark:border-[#2f5f9c]",
  violet: "bg-violet-50 border-violet-100 dark:bg-[#201735] dark:border-[#61419e]",
  pink: "bg-pink-50 border-pink-100 dark:bg-[#2a1220] dark:border-[#743057]",
  teal: "bg-teal-50 border-teal-100 dark:bg-[#102723] dark:border-[#2f756b]",
  cyan: "bg-cyan-50 border-cyan-100 dark:bg-[#102630] dark:border-[#2f7086]",
  rose: "bg-rose-50 border-rose-100 dark:bg-[#2b1219] dark:border-[#763044]",
  slate: "bg-slate-50 border-slate-100 dark:bg-[#111111] dark:border-[#303030]",
  black: "bg-slate-900 border-slate-900 text-white dark:bg-[#080808] dark:border-[#343434] dark:text-slate-100",
  white: "bg-white border-slate-200 dark:bg-[#161616] dark:border-[#3a3a3a]",
  brown: "bg-amber-50 border-amber-100 dark:bg-[#2a1a0d] dark:border-[#7a4b1c]",
  red_alt: "bg-red-100 border-red-200 dark:bg-[#341219] dark:border-[#8a2f3c]",
  orange_alt: "bg-orange-100 border-orange-200 dark:bg-[#351a0d] dark:border-[#93501f]",
  yellow_alt: "bg-yellow-100 border-yellow-200 dark:bg-[#30270b] dark:border-[#8b711b]",
  green_alt: "bg-green-100 border-green-200 dark:bg-[#0e2f1c] dark:border-[#347f4e]",
  blue_alt: "bg-blue-100 border-blue-200 dark:bg-[#0f2340] dark:border-[#346bad]",
  violet_alt: "bg-violet-100 border-violet-200 dark:bg-[#251746] dark:border-[#6b46b3]",
};

/** True when the given color has a dark background and needs light text. */
/**
 * @param {string | undefined} colorKey
 * @returns {boolean}
 */
export function isDarkColor(colorKey) {
  return colorKey === "black";
}

/**
 * Parse a #RRGGBB / #RGB hex string to an `{r,g,b}` object.
 * Returns null when the input doesn't match.
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number } | null}
 */
export function parseHexColor(hex) {
  if (typeof hex !== "string") return null;
  const m = hex.trim().toLowerCase().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Produce an `rgba(...)` string from a hex color + alpha (0..1). */
/**
 * @param {string} hex
 * @param {number} [alpha]
 * @returns {string | null}
 */
export function hexToRgba(hex, alpha = 1) {
  const c = parseHexColor(hex);
  if (!c) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/** Mix a hex color with a solid target color and return a solid #rrggbb value. */
/**
 * @param {string} hex
 * @param {string} targetHex
 * @param {number} [sourceWeight]
 * @returns {string | null}
 */
export function mixHexColor(hex, targetHex, sourceWeight = 0.5) {
  const source = parseHexColor(hex);
  const target = parseHexColor(targetHex);
  if (!source || !target) return null;
  const w = Math.max(0, Math.min(1, sourceWeight));
  const mix = (a, b) => Math.round(a * w + b * (1 - w));
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(source.r, target.r))}${toHex(mix(source.g, target.g))}${toHex(mix(source.b, target.b))}`;
}

/**
 * True when an arbitrary hex color is "dark" (perceptual luminance below 50%).
 * Used to choose between light / dark text on a hex-colored surface.
 * @param {string} hex
 * @returns {boolean}
 */
export function isHexDark(hex) {
  const c = parseHexColor(hex);
  if (!c) return false;
  // Standard relative luminance approximation (sRGB).
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return lum < 0.55;
}
