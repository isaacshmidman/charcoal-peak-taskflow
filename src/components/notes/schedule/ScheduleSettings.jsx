// @ts-nocheck
/**
 * @file Advanced settings for a note's schedule, behind a small button in
 * the note's header. Self-contained — the trigger and everything it opens —
 * so it can move anywhere the header does.
 *
 *   Gap between slots  — asked for: breathing room between one slot and the next.
 *   Slot length        — people plan in half hours or quarters; empty time is
 *                        cut again, slots with something in them stay put.
 *   Day starts / ends  — most days don't need the night hours as rows.
 *   When you change a time — both readings of "adjust the rest" are right for
 *                        different schedules, so it's a choice, not a guess.
 *   Highlight now      — a routine is something to glance at during the day.
 *
 * Every change goes through the schedule editor, so it can be undone from
 * the toast like any other; a change that can't be made says why here.
 */
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import SettingsToggle from "@/components/settings/SettingsToggle";
import {
  GAP_CHOICES,
  MAX_GAP,
  MAX_SLOT_LENGTH,
  MIN_SLOT_LENGTH,
  SLOT_LENGTH_CHOICES,
  formatClock,
  setDayBounds,
  setGap,
  setSlotLength,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";
import TimeField from "./TimeField";

const minutesLabel = (n) => (n === 0 ? "None" : n < 60 || n % 30 !== 0 ? `${n} min` : `${n / 60} hr`);

/**
 * @param {{
 *   schedule: import("@/lib/schedule").Schedule,
 *   editor: ReturnType<typeof import("./useScheduleEditor").useScheduleEditor>,
 * }} props
 */
export default function ScheduleSettings({ schedule, editor }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const dayStart = schedule.slots[0].start;
  const dayEnd = schedule.slots[schedule.slots.length - 1].end;

  /** Apply a change; a refusal shows in the popover. */
  const run = (change, done) => {
    const refused = editor.apply(change, { done });
    setError(refused);
    return refused;
  };
  /** A setting that doesn't reshape anything (cascade, highlight). */
  const set = (changes, done) => run((s) => ({ schedule: { ...s, ...changes } }), done);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Advanced settings"
          title="Advanced settings"
          data-testid="schedule-settings"
          className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        // Scrolls inside itself on a short screen instead of running off it.
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-2rem))] space-y-4 overflow-y-auto border-border-hairline bg-surface-card p-4"
        data-testid="schedule-settings-panel"
      >
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Advanced settings</p>

        <Setting title="Gap between slots" hint="Each slot keeps its start and ends this long before the next one.">
          <Choices
            name="gap"
            value={schedule.gap}
            options={GAP_CHOICES}
            label={minutesLabel}
            min={0}
            max={MAX_GAP}
            onPick={(n) => run((s) => setGap(s, n), n === 0 ? "No gap between slots." : `A ${n}-minute gap between slots.`)}
          />
        </Setting>

        <Setting title="Slot length" hint="Empty time is cut into slots this long. Slots with something in them stay put.">
          <Choices
            name="slot length"
            value={schedule.slot}
            options={SLOT_LENGTH_CHOICES}
            label={minutesLabel}
            min={MIN_SLOT_LENGTH}
            max={MAX_SLOT_LENGTH}
            onPick={(n) => run((s) => setSlotLength(s, n), `Slots are ${minutesLabel(n)} long.`)}
          />
        </Setting>

        <Setting title="Day">
          <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-slate-400">Starts</span>
              <TimeField
                value={dayStart}
                label="Day starts"
                testId="day-start"
                className="rounded-md border border-border-hairline px-1.5 py-0.5"
                validate={(m) => (m >= dayEnd ? `The day has to start before it ends (${formatClock(dayEnd)}).` : null)}
                onCommit={(m) => run((s) => setDayBounds(s, m, s.slots[s.slots.length - 1].end), `The day starts at ${formatClock(m)}.`)}
                onProblem={setError}
              />
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-slate-400">Ends</span>
              <TimeField
                end
                value={dayEnd}
                label="Day ends"
                testId="day-end"
                className="rounded-md border border-border-hairline px-1.5 py-0.5"
                validate={(m) => (m <= dayStart ? `The day has to end after it starts (${formatClock(dayStart)}).` : null)}
                onCommit={(m) => run((s) => setDayBounds(s, s.slots[0].start, m), `The day ends at ${formatClock(m)}.`)}
                onProblem={setError}
              />
            </span>
          </div>
        </Setting>

        <Setting title="When you change a time">
          <div role="radiogroup" aria-label="When you change a time" className="space-y-1">
            <Option
              checked={schedule.cascade === "shift"}
              onSelect={() => set({ cascade: "shift" }, "Changing a time moves the slots after it.")}
              title="Move the slots after it"
              hint="Or before it, for a start. Every slot keeps its length."
            />
            <Option
              checked={schedule.cascade === "next"}
              onSelect={() => set({ cascade: "next" }, "Changing a time only changes the slot next to it.")}
              title="Only change the slot next to it"
              hint="It gets longer or shorter; nothing else moves."
            />
          </div>
        </Setting>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Highlight the slot happening now</p>
          </div>
          <SettingsToggle
            checked={schedule.now}
            onChange={(on) => set({ now: on })}
            label="Highlight the slot happening now"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs leading-snug text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Setting({ title, hint, children }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{title}</p>
      {children}
      {hint && <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

/** Preset minute counts, plus a box for any other number in range. */
function Choices({ name, value, options, label, min, max, onPick }) {
  const custom = !options.includes(value);
  const [draft, setDraft] = useState(custom ? String(value) : "");
  const commitDraft = () => {
    const n = Number(draft);
    if (draft === "" || !Number.isInteger(n) || n === value) return;
    onPick(Math.min(max, Math.max(min, n)));
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          data-testid={`${name.replace(/\s+/g, "-")}-${n}`}
          onClick={() => {
            setDraft("");
            if (value !== n) onPick(n);
          }}
          className={cn(
            "h-7 rounded-md border px-2 text-xs transition-colors",
            value === n
              ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
              : "border-border-hairline text-slate-600 hover:border-border-strong dark:text-slate-300"
          )}
        >
          {label(n)}
        </button>
      ))}
      <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft}
          placeholder="Other"
          aria-label={`Other ${name}, in minutes`}
          data-testid={`${name.replace(/\s+/g, "-")}-other`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
          className={cn(
            "h-7 w-[4.5rem] rounded-md border bg-transparent px-2 text-xs text-slate-700 outline-none focus:border-border-strong dark:text-slate-200",
            custom ? "border-slate-900 dark:border-slate-100" : "border-border-hairline"
          )}
        />
        min
      </label>
    </div>
  );
}

function Option({ checked, onSelect, title, hint }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
        checked ? "border-border-strong bg-slate-50 dark:bg-[#161616]" : "border-border-hairline hover:border-border-strong"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
          checked ? "border-slate-900 dark:border-slate-100" : "border-slate-300 dark:border-slate-600"
        )}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-slate-900 dark:bg-slate-100" />}
      </span>
      <span>
        <span className="block text-xs font-medium text-slate-800 dark:text-slate-200">{title}</span>
        <span className="block text-[11px] leading-snug text-slate-400 dark:text-slate-500">{hint}</span>
      </span>
    </button>
  );
}
