/**
 * Shared colour palette for priorities: the swatch (colorDot), the tick
 * box of a task row (colorCheck) and the soft tint of a calendar chip
 * (colorBg). Keep the three in step — a colour added here needs all of them.
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
  { value: "slate", label: "Gray", class: "bg-ink-400" },
  { value: "black", label: "Black", class: "bg-ink-900 dark:bg-ink-100" },
  { value: "white", label: "White", class: "bg-white border border-ink-300 dark:border-ink-500" },
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
  slate: "bg-ink-400",
  black: "bg-ink-900 dark:bg-ink-100",
  white: "bg-white border border-ink-300 dark:border-ink-500",
  brown: "bg-amber-700",
  red_alt: "bg-red-600",
  orange_alt: "bg-orange-600",
  yellow_alt: "bg-yellow-600",
  green_alt: "bg-green-700",
  blue_alt: "bg-blue-700",
  violet_alt: "bg-violet-700",
};

/**
 * A soft tint of the priority's colour, for the places where colour IS the
 * point: chips on the calendar, the swatch behind a priority's name. Task
 * rows in a list don't use it — there the colour sits on the tick box
 * (colorCheck below) and the row stays plain.
 *
 * Dark mode is the same hue at low opacity, so a tint reads as a tint of
 * the surface it sits on rather than a block of its own.
 */
/** @type {Record<string, string>} */
export const colorBg = {
  red: "bg-red-50 border-red-100 dark:bg-red-400/[0.12] dark:border-red-400/20",
  orange: "bg-orange-50 border-orange-100 dark:bg-orange-400/[0.12] dark:border-orange-400/20",
  yellow: "bg-yellow-50 border-yellow-100 dark:bg-yellow-400/[0.12] dark:border-yellow-400/20",
  green: "bg-green-50 border-green-100 dark:bg-green-400/[0.12] dark:border-green-400/20",
  blue: "bg-blue-50 border-blue-100 dark:bg-blue-400/[0.12] dark:border-blue-400/20",
  violet: "bg-violet-50 border-violet-100 dark:bg-violet-400/[0.12] dark:border-violet-400/20",
  pink: "bg-pink-50 border-pink-100 dark:bg-pink-400/[0.12] dark:border-pink-400/20",
  teal: "bg-teal-50 border-teal-100 dark:bg-teal-400/[0.12] dark:border-teal-400/20",
  cyan: "bg-cyan-50 border-cyan-100 dark:bg-cyan-400/[0.12] dark:border-cyan-400/20",
  rose: "bg-rose-50 border-rose-100 dark:bg-rose-400/[0.12] dark:border-rose-400/20",
  slate: "bg-ink-100 border-ink-200 dark:bg-night-raised dark:border-night-line",
  black: "bg-ink-900 border-ink-900 text-white dark:bg-night-sunken dark:border-night-line-strong dark:text-ink-100",
  white: "bg-white border-ink-200 dark:bg-night-raised dark:border-night-line-strong",
  brown: "bg-amber-50 border-amber-100 dark:bg-amber-600/[0.14] dark:border-amber-600/25",
  red_alt: "bg-red-100 border-red-200 dark:bg-red-500/20 dark:border-red-500/30",
  orange_alt: "bg-orange-100 border-orange-200 dark:bg-orange-500/20 dark:border-orange-500/30",
  yellow_alt: "bg-yellow-100 border-yellow-200 dark:bg-yellow-500/20 dark:border-yellow-500/30",
  green_alt: "bg-green-100 border-green-200 dark:bg-green-500/20 dark:border-green-500/30",
  blue_alt: "bg-blue-100 border-blue-200 dark:bg-blue-500/20 dark:border-blue-500/30",
  violet_alt: "bg-violet-100 border-violet-200 dark:bg-violet-500/20 dark:border-violet-500/30",
};

/**
 * The tick box of a task that isn't done yet, in its priority's colour: a
 * ring of it, and a breath of it inside. This is how a list shows priority.
 */
/** @type {Record<string, string>} */
export const colorCheck = {
  red: "border-red-400 bg-red-400/10 hover:bg-red-400/25",
  orange: "border-orange-400 bg-orange-400/10 hover:bg-orange-400/25",
  yellow: "border-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/25",
  green: "border-green-400 bg-green-400/10 hover:bg-green-400/25",
  blue: "border-blue-400 bg-blue-400/10 hover:bg-blue-400/25",
  violet: "border-violet-400 bg-violet-400/10 hover:bg-violet-400/25",
  pink: "border-pink-400 bg-pink-400/10 hover:bg-pink-400/25",
  teal: "border-teal-400 bg-teal-400/10 hover:bg-teal-400/25",
  cyan: "border-cyan-400 bg-cyan-400/10 hover:bg-cyan-400/25",
  rose: "border-rose-400 bg-rose-400/10 hover:bg-rose-400/25",
  slate: "border-ink-400 bg-ink-400/10 hover:bg-ink-400/25",
  black: "border-ink-900 bg-ink-900/5 hover:bg-ink-900/15 dark:border-ink-100 dark:bg-white/5 dark:hover:bg-white/15",
  white: "border-ink-300 bg-white hover:bg-ink-100 dark:border-ink-400 dark:bg-white/5 dark:hover:bg-white/15",
  brown: "border-amber-700 bg-amber-700/10 hover:bg-amber-700/25",
  red_alt: "border-red-600 bg-red-600/10 hover:bg-red-600/25",
  orange_alt: "border-orange-600 bg-orange-600/10 hover:bg-orange-600/25",
  yellow_alt: "border-yellow-600 bg-yellow-600/10 hover:bg-yellow-600/25",
  green_alt: "border-green-700 bg-green-700/10 hover:bg-green-700/25",
  blue_alt: "border-blue-700 bg-blue-700/10 hover:bg-blue-700/25",
  violet_alt: "border-violet-700 bg-violet-700/10 hover:bg-violet-700/25",
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
