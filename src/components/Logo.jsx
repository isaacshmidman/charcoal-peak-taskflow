// @ts-check
import React, { useId } from "react";

/**
 * The Zephyrly mark: an ink Z with its ends cut on the slant of its own
 * stroke — a letter leaning into the wind — on a tile of the brand
 * yellow, pale corner to full corner. Drawn rather than loaded so it is
 * sharp at every size and never a missing image offline.
 *
 * The same drawing is public/icon.svg; the PNG app icons in public/ are
 * renders of it (scripts/render-icons.mjs).
 *
 * @param {{ size?: number, className?: string, title?: string }} props
 */
export default function Logo({ size = 28, className, title = "Zephyrly" }) {
  const gradient = useId();
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff9c7" />
          <stop offset="1" stopColor="#f3e23f" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="24" fill={`url(#${gradient})`} />
      <path d="M30 27H74L71 39 46 61H73L70 73H26L29 61 54 39H27Z" fill="#1a1915" />
    </svg>
  );
}
