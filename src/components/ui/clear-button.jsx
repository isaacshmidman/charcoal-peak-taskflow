// @ts-check
/**
 * @file The small "x" that empties a box or removes a row.
 *
 * One look for all of them: a faint x that turns red under the pointer,
 * the same as the x beside a priority or a tag in Settings. In a text box
 * it sits at the right edge and only appears once something is typed.
 */
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The colours of a quiet remove/clear x (resting, and under the pointer). */
export const quietRemove =
  "text-ink-300 dark:text-ink-600 hover:text-red-400 dark:hover:text-red-300 transition-colors";

/**
 * @param {{ label?: string, onClick: () => void, className?: string }} props
 */
export function ClearButton({ label = "Clear search", onClick, className }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // The box keeps its caret: pressing here must not take focus away.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md", quietRemove, className)}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
