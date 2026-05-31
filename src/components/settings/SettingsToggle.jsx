// @ts-nocheck
/**
 * @file Pill-style toggle shared across the Settings panels. Mirrors
 * the "Set time" toggle in TaskForm/TimeFields.jsx so iOS-style
 * switches feel consistent across the whole app.
 *
 * @param {{
 *   checked: boolean,
 *   onChange: (next: boolean) => void,
 *   disabled?: boolean,
 * }} props
 */
import { cn } from "@/lib/utils";

export default function SettingsToggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none shrink-0",
        checked ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-200 dark:bg-[#222222]",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-900 shadow transition-transform duration-200",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
