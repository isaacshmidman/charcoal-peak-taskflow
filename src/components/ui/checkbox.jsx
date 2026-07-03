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
 * @typedef {Omit<import("react").ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
 *   checked?: boolean,
 *   onCheckedChange?: (checked: boolean) => void,
 *   size?: "default" | "task",
 * }} CheckboxProps
 */

const sizeClasses = {
  default: "w-5 h-5 [&_svg]:w-3 [&_svg]:h-3",
  task: "w-7 h-7 [&_svg]:w-3.5 [&_svg]:h-3.5", // TaskCard's touch-friendly size
}

/** @type {import("react").ForwardRefExoticComponent<CheckboxProps & import("react").RefAttributes<HTMLButtonElement>>} */
const Checkbox = React.forwardRef(function Checkbox(
  { className, checked = false, onCheckedChange, size = "default", disabled, ...props },
  ref
) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "shrink-0 rounded-md border-2 flex items-center justify-center transition-all touch-manipulation",
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
