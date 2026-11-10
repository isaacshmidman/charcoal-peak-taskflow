// @ts-nocheck
/**
 * @file The pieces every task-shaped form is built from, so the task
 * form and the subtask form are the same thing at two sizes:
 *
 *   FormDialog  the dialog itself — a quiet heading, a body that scrolls,
 *               and a footer that stays put (delete left, actions right).
 *   Field       one property on one line: a quiet label, then its control.
 *   DateField   the date button and its pop-up calendar (DatePopover is
 *               the pop-up alone, for a date that isn't shown as a field).
 */
import { useId, useState } from "react";
import { addDays } from "date-fns/addDays";
import { format } from "date-fns/format";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fromDateStr, toDateStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   title: string,
 *   testid?: string,
 *   onKeyDown?: (e: KeyboardEvent) => void,
 *   focusTitle?: boolean,                      // put the caret in the title on open
 *   footerStart?: import("react").ReactNode,   // the delete button
 *   footerEnd: import("react").ReactNode,      // cancel + the main action
 *   children: import("react").ReactNode,
 * }} props
 */
export function FormDialog({ open, onOpenChange, title, testid, onKeyDown, focusTitle, footerStart, footerEnd, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The body scrolls, not the dialog: the title bar and the buttons
        // stay where they are however long the form gets.
        className="flex max-h-[min(92dvh,46rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        // Radix would focus the first control whatever it is. A new item
        // wants the caret in its title; an existing one wants nothing
        // focused (on a phone that would throw the keyboard up over it).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (focusTitle && window.matchMedia?.("(pointer: fine)").matches) {
            e.currentTarget.querySelector("[data-title-input]")?.focus();
          }
        }}
        aria-describedby={undefined}
        data-testid={testid}
      >
        <form onSubmit={(e) => e.preventDefault()} onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
          <DialogTitle className="px-5 pb-1 pt-4 text-[13px] font-medium leading-none tracking-normal text-ink-500 dark:text-ink-400">
            {title}
          </DialogTitle>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-5 pt-1" data-testid="form-body">
            {children}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border-hairline px-5 py-3">
            <div className="flex items-center">{footerStart}</div>
            <div className="flex items-center gap-2">{footerEnd}</div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One property, one line. The label sits in a fixed column so every
 * control starts at the same edge.
 *
 * @param {{
 *   label: string,
 *   hint?: import("react").ReactNode,   // a line of help under the control
 *   className?: string,
 *   children: import("react").ReactNode,
 * }} props
 */
export function Field({ label, hint, className, children, ...props }) {
  const id = useId();
  return (
    <div className={cn("grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3", className)} {...props}>
      <span id={id} className="select-none text-[13px] leading-9 text-ink-500 dark:text-ink-400">
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="min-w-0">
        {children}
        {hint ? <p className="mt-1.5 text-[11px] leading-snug text-ink-400 dark:text-ink-500">{hint}</p> : null}
      </div>
    </div>
  );
}

/** The big, boxless title at the top of a form. */
export const formTitleClass =
  "py-1 text-xl font-semibold leading-7 tracking-tight placeholder:font-medium placeholder:text-ink-300 dark:placeholder:text-ink-600";

/** "Mon, Nov 9" — with the year only when it isn't this one. */
export function friendlyDate(dateStr) {
  const date = fromDateStr(dateStr);
  const todayStr = toDateStr(new Date());
  if (dateStr === todayStr) return `Today · ${format(date, "EEE, MMM d")}`;
  if (dateStr === toDateStr(addDays(new Date(), 1))) return `Tomorrow · ${format(date, "EEE, MMM d")}`;
  return format(date, date.getFullYear() === new Date().getFullYear() ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

/**
 * The pop-up month, around whatever opens it. Picking a day closes it —
 * one click, done. `children` is the trigger (one element).
 *
 * @param {{
 *   value: string,                       // "yyyy-MM-dd" or ""
 *   onChange: (next: string) => void,    // "" when cleared
 *   clearLabel?: string,                 // omit to offer no way to clear
 *   shortcuts?: boolean,                 // Today / Tomorrow / Next week
 *   clearTestid?: string,
 *   align?: "start" | "center" | "end",
 *   children: import("react").ReactNode,
 * }} props
 */
export function DatePopover({ value, onChange, clearLabel, shortcuts = true, clearTestid, align = "start", children }) {
  const [open, setOpen] = useState(false);
  const pick = (next) => { onChange(next); setOpen(false); };
  const today = new Date();
  const quick = [
    ["Today", toDateStr(today)],
    ["Tomorrow", toDateStr(addDays(today, 1))],
    ["Next week", toDateStr(addDays(today, 7))],
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align} onClick={(e) => e.stopPropagation()}>
        <Calendar
          mode="single"
          selected={value ? fromDateStr(value) : undefined}
          defaultMonth={value ? fromDateStr(value) : undefined}
          onSelect={(date) => { if (date) pick(toDateStr(date)); }}
          showOutsideDays
          fixedWeeks
        />
        {(shortcuts || (clearLabel && value)) && (
          <div className="flex items-center gap-1 border-t border-border-hairline p-2">
            {shortcuts && quick.map(([label, dateStr]) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="sm"
                className={cn("h-7 px-2 text-xs", value === dateStr && "bg-selected")}
                onClick={() => pick(dateStr)}
              >
                {label}
              </Button>
            ))}
            {clearLabel && value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={clearTestid}
                className="ml-auto h-7 px-2 text-xs text-ink-500 dark:text-ink-400"
                onClick={() => pick("")}
              >
                {clearLabel}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The date button of a form: a DatePopover behind a full-width button.
 *
 * @param {{
 *   value: string,
 *   onChange: (next: string) => void,
 *   placeholder?: string,
 *   clearLabel?: string,
 *   shortcuts?: boolean,
 *   testid?: string,
 *   clearTestid?: string,
 *   className?: string,
 * }} props
 */
export function DateField({ value, onChange, placeholder = "No date", clearLabel, shortcuts = true, testid, clearTestid, className }) {
  return (
    <DatePopover value={value} onChange={onChange} clearLabel={clearLabel} shortcuts={shortcuts} clearTestid={clearTestid}>
      <Button
        type="button"
        variant="outline"
        data-testid={testid}
        className={cn(
          "h-9 w-full justify-start gap-2 px-3 text-sm font-normal",
          !value && "text-ink-400 dark:text-ink-500",
          className
        )}
      >
        <CalendarIcon className="h-4 w-4 shrink-0 text-ink-400 dark:text-ink-500" />
        <span className="truncate">{value ? friendlyDate(value) : placeholder}</span>
      </Button>
    </DatePopover>
  );
}
