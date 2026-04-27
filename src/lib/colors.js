// @ts-nocheck
/**
 * Shared color palette for priority swatches and task card backgrounds.
 * Used by Settings (swatch picker), TaskCard (card bg), and RecentlyDeleted
 * (DeletedTaskCard bg). Keep in sync — adding a color here adds it everywhere.
 */

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
  { value: "black", label: "Black", class: "bg-slate-900" },
  { value: "white", label: "White", class: "bg-white border border-slate-300" },
  { value: "brown", label: "Brown", class: "bg-amber-700" },
  { value: "red_alt", label: "Red (deep)", class: "bg-red-600" },
  { value: "orange_alt", label: "Orange (deep)", class: "bg-orange-600" },
  { value: "yellow_alt", label: "Yellow (deep)", class: "bg-yellow-600" },
  { value: "green_alt", label: "Green (deep)", class: "bg-green-700" },
  { value: "blue_alt", label: "Blue (deep)", class: "bg-blue-700" },
  { value: "violet_alt", label: "Violet (deep)", class: "bg-violet-700" },
];

/** Small circular dot class per color — used by inline priority indicators. */
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
  black: "bg-slate-900",
  white: "bg-white border border-slate-300",
  brown: "bg-amber-700",
  red_alt: "bg-red-600",
  orange_alt: "bg-orange-600",
  yellow_alt: "bg-yellow-600",
  green_alt: "bg-green-700",
  blue_alt: "bg-blue-700",
  violet_alt: "bg-violet-700",
};

/** Task card background + border class, tuned to match the dot hue at low saturation. */
export const colorBg = {
  red: "bg-red-50 border-red-100",
  orange: "bg-orange-50 border-orange-100",
  yellow: "bg-yellow-50 border-yellow-100",
  green: "bg-green-50 border-green-100",
  blue: "bg-blue-50 border-blue-100",
  violet: "bg-violet-50 border-violet-100",
  pink: "bg-pink-50 border-pink-100",
  teal: "bg-teal-50 border-teal-100",
  cyan: "bg-cyan-50 border-cyan-100",
  rose: "bg-rose-50 border-rose-100",
  slate: "bg-slate-50 border-slate-100",
  black: "bg-slate-900 border-slate-900 text-white",
  white: "bg-white border-slate-200",
  brown: "bg-amber-50 border-amber-100",
  red_alt: "bg-red-100 border-red-200",
  orange_alt: "bg-orange-100 border-orange-200",
  yellow_alt: "bg-yellow-100 border-yellow-200",
  green_alt: "bg-green-100 border-green-200",
  blue_alt: "bg-blue-100 border-blue-200",
  violet_alt: "bg-violet-100 border-violet-200",
};

/** True when the given color has a dark background and needs light text. */
export function isDarkColor(colorKey) {
  return colorKey === "black";
}

/**
 * Parse a #RRGGBB / #RGB hex string to an `{r,g,b}` object.
 * Returns null when the input doesn't match.
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
export function hexToRgba(hex, alpha = 1) {
  const c = parseHexColor(hex);
  if (!c) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/**
 * True when an arbitrary hex color is "dark" (perceptual luminance below 50%).
 * Used to choose between light / dark text on a hex-colored surface.
 */
export function isHexDark(hex) {
  const c = parseHexColor(hex);
  if (!c) return false;
  // Standard relative luminance approximation (sRGB).
  const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return lum < 0.55;
}
