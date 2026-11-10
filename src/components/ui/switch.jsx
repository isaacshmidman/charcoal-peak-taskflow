// @ts-nocheck
/**
 * @file The one on/off switch. Ink when on in the light, sun in the dark
 * — the same rule as the primary button.
 *
 * @param {{
 *   checked: boolean,
 *   onChange: (next: boolean) => void,
 *   disabled?: boolean,
 *   label: string,          // what the switch turns on — its accessible name
 *   className?: string,
 * }} props
 */
import { cn } from "@/lib/utils";

export function Switch({ checked, onChange, disabled, label, className, ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink-900/15 dark:focus-visible:ring-sun-400/30",
        checked ? "bg-ink-900 dark:bg-sun-400" : "bg-ink-300 dark:bg-night-line-bold",
        disabled && "cursor-not-allowed opacity-40",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 dark:bg-ink-950",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
