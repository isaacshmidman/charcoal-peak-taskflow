// @ts-nocheck
/**
 * @file The top of every page: its title, a line under it, and its
 * actions — one component, so every page opens the same way.
 *
 * It stays put while the page scrolls (`.ds-page-head` in index.css): the
 * title doesn't leave with the content, and what scrolls passes under it.
 * It carries the page wash exactly as the page behind it does, so at rest
 * it has no visible edge.
 *
 *   <PageHeader title="Today" sub="6 tasks">
 *     <PageSearch … />
 *     <Button>New task</Button>
 *   </PageHeader>
 *
 * `below` is a second row for pages that need one (the calendar's range
 * and view switch). `back` puts a back arrow before the title.
 */
import { ChevronLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { cn } from "@/lib/utils";

/** The look of a quiet icon button in a page header. */
export const headerIconButton =
  "h-9 w-9 text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100";

export default function PageHeader({ title, sub, back, backLabel = "Back", children, below, className }) {
  return (
    <header className={cn("ds-page-head", className)}>
      <div className="flex min-h-[2.75rem] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {back && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(headerIconButton, "-ml-2 shrink-0")}
              onClick={back}
              aria-label={backLabel}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="ds-page-title truncate">{title}</h1>
            {sub != null && sub !== "" && <p className="ds-page-sub truncate">{sub}</p>}
          </div>
        </div>
        {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
      </div>
      {below}
    </header>
  );
}

/**
 * The search box every list page has: a magnifier that opens a field
 * beside it. Closing it clears the search.
 *
 * @param {{ open: boolean, onOpenChange: (open: boolean) => void, value: string,
 *   onChange: (value: string) => void, label?: string, placeholder?: string }} props
 */
export function PageSearch({ open, onOpenChange, value, onChange, label = "Search", placeholder }) {
  return (
    <>
      <AnimatedSearchInput open={open} value={value} onChange={onChange} onClose={() => onOpenChange(false)} placeholder={placeholder} />
      <Button
        aria-label={open ? "Close search" : label}
        variant="ghost"
        size="icon"
        data-search-toggle
        className={headerIconButton}
        // Keep the field focused while this closes it, so its own blur
        // handler doesn't close it first and this click re-open it.
        onMouseDown={(event) => { if (open) event.preventDefault(); }}
        onClick={() => { if (open) onChange(""); onOpenChange(!open); }}
      >
        <Search className="h-4 w-4" />
      </Button>
    </>
  );
}
