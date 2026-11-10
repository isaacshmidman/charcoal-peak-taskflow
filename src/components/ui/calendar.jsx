import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

/** @typedef {import("react").ComponentProps<typeof DayPicker>} CalendarProps */

/**
 * The pop-up month for picking a date.
 *
 * Two marks, and they never compete:
 *   - the day you PICKED is the only filled one (ink in the light, sun in
 *     the dark), and it keeps that fill on hover and focus;
 *   - TODAY is a small sun dot under its number. Not a fill — a filled
 *     today next to a filled pick is two highlights in two colours, and
 *     on the day that is both, the two styles used to fight over the
 *     background and the text colour.
 *
 * @param {CalendarProps} props
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}) {
  return (
    (<DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-3",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-semibold",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 text-ink-500 dark:text-ink-400"
        ),
        nav_button_previous: "absolute left-0",
        nav_button_next: "absolute right-0",
        table: "w-full border-collapse",
        head_row: "flex",
        head_cell: "w-9 text-[11px] font-medium text-ink-400 dark:text-ink-500",
        row: "flex w-full mt-1",
        // Only a range paints the cell behind its days. A single pick is
        // one filled day and nothing else.
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          props.mode === "range" &&
            "[&:has([aria-selected])]:bg-selected [&:has(>.day-range-end)]:rounded-r-lg [&:has(>.day-range-start)]:rounded-l-lg first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg"
        ),
        // No text colour here: these class lists are joined, not merged, so
        // a colour on the day would outrank the paler one on outside days.
        day: "relative inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-sm tabular-nums transition-colors hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900/25 dark:focus-visible:ring-sun-400/40",
        day_range_start: "day-range-start",
        day_range_end: "day-range-end",
        day_selected: "!bg-primary !text-primary-foreground font-semibold",
        day_today:
          "font-semibold after:absolute after:bottom-[5px] after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-sun-500 aria-selected:after:bg-sun-400 dark:after:bg-sun-400 dark:aria-selected:after:bg-ink-900",
        day_outside: "day-outside text-ink-400 dark:text-ink-500",
        day_disabled: "text-ink-400 dark:text-ink-500 opacity-50",
        day_range_middle: "!bg-transparent !text-ink-900 dark:!text-ink-100 !font-normal",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className: iconClassName, ...iconProps }) => (
          <ChevronLeft className={cn("h-4 w-4", iconClassName)} {...iconProps} />
        ),
        IconRight: ({ className: iconClassName, ...iconProps }) => (
          <ChevronRight className={cn("h-4 w-4", iconClassName)} {...iconProps} />
        ),
      }}
      {...props} />)
  );
}
Calendar.displayName = "Calendar"

export { Calendar }
