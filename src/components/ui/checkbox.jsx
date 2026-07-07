import * as React from "react"
import { CheckSquare } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The signature Zephyrly ink-fill checkbox: a bordered square that fills
 * slate-900 when checked (inverting to slate-100 in dark mode), matching
 * the task-completion toggle in TaskCard. Contract: design system README
 * (design_handoff_zephyrly_site) — "fills slate-900 when checked".
 *
 * Controlled only: pass `checked` + `onCheckedChange`.
 *
 * A consumer `onClick` (e.g. stopPropagation inside swipeable task rows)
 * runs BEFORE the toggle, and both always fire — preventDefault does not
 * suppress the toggle, because row consumers call it as part of their
 * normal click hygiene, not to cancel the check.
 *
 * Sizes: `task` = TaskCard's touch-friendly w-7 · `default` = w-5 for
 * forms and lists · `sm` = w-4 for dense calendar rows (4px radius —
 * the contract's 6px reads blobby at that box size).
 *
 * @typedef {Omit<import("react").ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
 *   checked?: boolean,
 *   onCheckedChange?: (checked: boolean) => void,
 *   size?: "sm" | "default" | "task",
 * }} CheckboxProps
 */

const sizeClasses = {
  sm: "w-4 h-4 rounded [&_svg]:w-2.5 [&_svg]:h-2.5",
  default: "w-5 h-5 rounded-md [&_svg]:w-3 [&_svg]:h-3",
  task: "w-7 h-7 rounded-md [&_svg]:w-3.5 [&_svg]:h-3.5",
}

/** @type {import("react").ForwardRefExoticComponent<CheckboxProps & import("react").RefAttributes<HTMLButtonElement>>} */
const Checkbox = React.forwardRef(function Checkbox(
  { className, checked = false, onCheckedChange, onClick, size = "default", disabled, ...props },
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
        "shrink-0 border-2 flex items-center justify-center transition-all touch-manipulation",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:opacity-50 disabled:pointer-events-none",
        checked
          ? "bg-slate-900 border-slate-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900"
          : "border-slate-300 dark:border-slate-600 hover:border-slate-500 bg-white dark:bg-[#0c0c0c]",
        sizeClasses[size] || sizeClasses.default,
        className
      )}
      ref={ref}
      {...props}
    >
      {checked && <CheckSquare />}
    </button>
  );
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
