// @ts-nocheck
/**
 * @file What every Settings page is built from, so the pages inside
 * Settings look like the page that leads to them.
 *
 *   <SettingsSection label="Navigation order" hint="…">
 *     <div className="ds-list">
 *       <SettingRow label="Theme"><Select … /></SettingRow>
 *       <SettingsLink icon={Bell} label="Notifications" onClick={…} />
 *     </div>
 *   </SettingsSection>
 *
 * The rules, which are the design system's (docs/design-system.md):
 * a section is a quiet label over ONE surface; rows share that surface,
 * divided by hairlines (`.ds-list`), never a card each; a row is a name
 * on the left and its control on the right; one grey for labels, hints
 * and icons; no colour that isn't ink, sun, or a warning.
 */
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The quiet label over a group of settings. */
export const settingsLabel = "px-1 text-xs font-medium text-ink-500 dark:text-ink-400";
/** A sentence of explanation under a label or a group. */
export const settingsHint = "px-1 text-xs leading-5 text-ink-500 dark:text-ink-400";
/** A small quiet tag beside a name ("Default", "This device"). */
export const settingsTag =
  "shrink-0 rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-night-high dark:text-ink-300";

/**
 * A labelled group. `hint` is a sentence under the label; `footnote` one
 * under the content.
 */
export function SettingsSection({ label, hint, footnote, children, className, id }) {
  return (
    <section id={id} className={className}>
      <h2 className={cn(settingsLabel, "mb-2")}>{label}</h2>
      {hint ? <p className={cn(settingsHint, "-mt-1 mb-2.5")}>{hint}</p> : null}
      {children}
      {footnote ? <p className={cn(settingsHint, "mt-2")}>{footnote}</p> : null}
    </section>
  );
}

/** One setting on a `.ds-list`: its name (and a hint) left, its control right. */
export function SettingRow({ label, hint, children, className, htmlFor }) {
  const Name = htmlFor ? "label" : "p";
  return (
    <div className={cn("flex min-h-[3.25rem] items-center justify-between gap-4 px-4 py-2.5", className)}>
      <div className="min-w-0">
        <Name htmlFor={htmlFor} className="block text-sm font-medium text-ink-900 dark:text-ink-100">{label}</Name>
        {hint ? <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** A row that leads to another page: icon, name, a line about it, a chevron. */
export function SettingsLink({ icon: Icon, label, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 bg-surface-card px-4 py-3 text-left transition-colors hover:bg-ink-50 dark:hover:bg-night-raised"
    >
      {Icon ? <Icon className="h-5 w-5 shrink-0 text-ink-500 dark:text-ink-400" /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900 dark:text-ink-100">{label}</p>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">{subtitle}</p> : null}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 dark:text-ink-600" />
    </button>
  );
}

const reorderButton =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-25 dark:text-ink-500 dark:hover:bg-night-high dark:hover:text-ink-100";

/** Move a row up or down its list. `name` is what's being moved, for screen readers. */
export function ReorderButtons({ name, onUp, onDown, first, last }) {
  return (
    <span className="inline-flex shrink-0 items-center">
      <button type="button" aria-label={`Move ${name} up`} title="Move up" onClick={onUp} disabled={first} className={reorderButton}>
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label={`Move ${name} down`} title="Move down" onClick={onDown} disabled={last} className={reorderButton}>
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
