import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The Zephyrly tick box: a rounded square that fills with sun and takes an
 * ink tick when checked — the one place the brand yellow is a solid fill.
 * Unchecked it is a quiet ring; a task row passes `tone` to draw that ring
 * in the task's priority colour (colorCheck in src/lib/colors.js).
 *
 * Controlled only: pass `checked` + `onCheckedChange`.
 *
 * A consumer `onClick` (e.g. stopPropagation inside swipeable task rows)
 * runs BEFORE the toggle, and both always fire — preventDefault does not
 * suppress the toggle, because row consumers call it as part of their
 * normal click hygiene, not to cancel the check.
 *
 * Sizes: `task` = TaskCard's w-6 with a larger tap area · `default` = w-5 for
 * forms and lists · `sm` = w-4 for dense calendar rows (4px radius —
 * the contract's 6px reads blobby at that box size).
 *
 * @typedef {Omit<import("react").ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
 *   checked?: boolean,
 *   onCheckedChange?: (checked: boolean) => void,
 *   size?: "sm" | "default" | "task",
 *   tone?: string,   // classes for the unchecked ring; default is neutral
 * }} CheckboxProps
 */

const sizeClasses = {
  sm: "w-4 h-4 rounded [&_svg]:w-3 [&_svg]:h-3",
  default: "w-5 h-5 rounded-md [&_svg]:w-3.5 [&_svg]:h-3.5",
  // Drawn at 24px; the invisible ::before keeps the area a finger can hit
  // at 40px, so the smaller box is no harder to tap.
  task: "relative w-6 h-6 rounded-md [&_svg]:w-4 [&_svg]:h-4 before:absolute before:-inset-2 before:content-['']",
}

/** @type {import("react").ForwardRefExoticComponent<CheckboxProps & import("react").RefAttributes<HTMLButtonElement>>} */
const Checkbox = React.forwardRef(function Checkbox(
  { className, checked = false, onCheckedChange, onClick, size = "default", tone, disabled, ...props },
  ref
) {
  const handleClick = (event) => {
    onClick?.(event);
    onCheckedChange?.(!checked);
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "shrink-0 border-[1.5px] flex items-center justify-center transition-colors touch-manipulation",
        // A click on the tick must land on the box itself: inside a <label>,
        // a click on the tick made the label click the box a second time,
        // so a ticked box could never be unticked.
        "[&_svg]:pointer-events-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:opacity-50 disabled:pointer-events-none",
        checked
          ? "bg-sun-400 border-sun-500 text-ink-900 dark:border-sun-400"
          : tone || "border-ink-300 dark:border-ink-600 hover:border-ink-500 dark:hover:border-ink-400 bg-surface-card dark:bg-night-sunken",
        sizeClasses[size] || sizeClasses.default,
        className
      )}
      ref={ref}
      {...props}
    >
      {checked && <Check strokeWidth={3} />}
    </button>
  );
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
