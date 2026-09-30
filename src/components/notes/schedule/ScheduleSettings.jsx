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
 * Every setting can be pinned: every new schedule then starts with it
 * (saved to the account, backend/schedule-defaults.js). A pin is filled
 * when this schedule has the pinned value; changing that setting here then
 * changes the pinned value too. Where this schedule differs, the pin is
 * hollow and says what's pinned, and pressing it pins this value instead.
 * Schedules that already exist keep their own settings.
 *
 * Every change goes through the schedule editor, so it can be undone from
 * the toast like any other (a pinned value changed with it goes back too);
 * a change that can't be made says why right under that setting.
 */
import { useState } from "react";
import { Pin, SlidersHorizontal } from "lucide-react";
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
  settingsOf,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";
import TimeField from "./TimeField";

const minutesLabel = (n) => (n === 0 ? "None" : n < 60 || n % 30 !== 0 ? `${n} min` : `${n / 60} hr`);

/** A pinned value, as the pin's note says it. */
const PINNED_LABEL = {
  dayStart: (v) => formatClock(v),
  dayEnd: (v) => formatClock(v),
  gap: (v) => (v === 0 ? "no gap" : `${v} min`),
  slot: (v) => minutesLabel(v),
  cascade: (v) => (v === "shift" ? "move the slots after it" : "only the next slot"),
  now: (v) => (v ? "on" : "off"),
};

const SETTING_NAME = {
  dayStart: "when the day starts",
  dayEnd: "when the day ends",
  gap: "the gap between slots",
  slot: "the slot length",
  cascade: "what changing a time does",
  now: "highlighting the slot happening now",
};

/**
 * @param {{
 *   schedule: import("@/lib/schedule").Schedule,
 *   editor: ReturnType<typeof import("./useScheduleEditor").useScheduleEditor>,
 *   defaults: import("@/lib/schedule").ScheduleDefaults,
 *   saveDefaults: (next: import("@/lib/schedule").ScheduleDefaults) => Promise<boolean>,
 * }} props
 */
export default function ScheduleSettings({ schedule, editor, defaults = {}, saveDefaults }) {
  const [open, setOpen] = useState(false);
  // A refusal, shown under the setting it came from.
  const [error, setError] = useState({ at: null, text: null });
  const current = settingsOf(schedule);
  const dayStart = current.dayStart;
  const dayEnd = current.dayEnd;

  /** Pinned, and this schedule has the pinned value. */
  const holds = (key) => Object.hasOwn(defaults, key) && defaults[key] === current[key];

  /**
   * Apply a change to setting(s) `keys`. Where this schedule had the pinned
   * value, the pinned value follows it (and goes back with Undo).
   */
  const run = (keys, change, done) => {
    const following = keys.filter(holds);
    const before = defaults;
    const refused = editor.apply(change, {
      done,
      alsoUndo: following.length ? () => saveDefaults(before) : undefined,
    });
    setError(refused ? { at: keys[0], text: refused } : { at: null, text: null });
    if (!refused && following.length) {
      const now = settingsOf(editor.get());
      saveDefaults({ ...before, ...Object.fromEntries(following.map((key) => [key, now[key]])) });
    }
    return refused;
  };
  /** A setting that doesn't reshape anything (cascade, highlight). */
  const set = (key, value, done) => run([key], (s) => ({ schedule: { ...s, [key]: value } }), done);

  const togglePin = (key) => {
    if (holds(key)) {
      const next = { ...defaults };
      delete next[key];
      saveDefaults(next);
    } else {
      saveDefaults({ ...defaults, [key]: current[key] });
    }
  };
  const pin = (key) => <PinButton setting={key} pinned={Object.hasOwn(defaults, key) ? defaults[key] : undefined} holds={holds(key)} onToggle={() => togglePin(key)} />;
  const errorFor = (key) => (error.at === key ? error.text : null);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError({ at: null, text: null });
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
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Advanced settings</p>
          <p className="flex items-start gap-1 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
            <Pin aria-hidden="true" className="mt-px h-3 w-3 shrink-0" />
            <span>Pin a setting to start every new schedule with it. Schedules you already have keep their own.</span>
          </p>
        </div>

        <Setting title="Gap between slots" pin={pin("gap")} error={errorFor("gap")} hint="Each slot keeps its start and ends this long before the next one.">
          <Choices
            name="gap"
            value={schedule.gap}
            options={GAP_CHOICES}
            label={minutesLabel}
            min={0}
            max={MAX_GAP}
            onPick={(n) => run(["gap"], (s) => setGap(s, n), n === 0 ? "No gap between slots." : `A ${n}-minute gap between slots.`)}
          />
        </Setting>

        <Setting title="Slot length" pin={pin("slot")} error={errorFor("slot")} hint="Empty time is cut into slots this long. Slots with something in them stay put.">
          <Choices
            name="slot length"
            value={schedule.slot}
            options={SLOT_LENGTH_CHOICES}
            label={minutesLabel}
            min={MIN_SLOT_LENGTH}
            max={MAX_SLOT_LENGTH}
            onPick={(n) => run(["slot"], (s) => setSlotLength(s, n), `Slots are ${minutesLabel(n)} long.`)}
          />
        </Setting>

        <Setting title="Day" error={errorFor("dayStart") || errorFor("dayEnd")}>
          <div className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <span className="w-10 text-xs text-slate-500 dark:text-slate-400">Starts</span>
              <TimeField
                value={dayStart}
                label="Day starts"
                testId="day-start"
                className="rounded-md border border-border-hairline px-1.5 py-0.5"
                validate={(m) => (m >= dayEnd ? `The day has to start before it ends (${formatClock(dayEnd)}).` : null)}
                onCommit={(m) => run(["dayStart"], (s) => setDayBounds(s, m, s.slots[s.slots.length - 1].end), `The day starts at ${formatClock(m)}.`)}
                onProblem={(text) => setError({ at: "dayStart", text })}
              />
              <span className="ml-auto">{pin("dayStart")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 text-xs text-slate-500 dark:text-slate-400">Ends</span>
              <TimeField
                end
                value={dayEnd}
                label="Day ends"
                testId="day-end"
                className="rounded-md border border-border-hairline px-1.5 py-0.5"
                validate={(m) => (m <= dayStart ? `The day has to end after it starts (${formatClock(dayStart)}).` : null)}
                onCommit={(m) => run(["dayEnd"], (s) => setDayBounds(s, s.slots[0].start, m), `The day ends at ${formatClock(m)}.`)}
                onProblem={(text) => setError({ at: "dayEnd", text })}
              />
              <span className="ml-auto">{pin("dayEnd")}</span>
            </div>
          </div>
        </Setting>

        <Setting title="When you change a time" pin={pin("cascade")}>
          <div role="radiogroup" aria-label="When you change a time" className="space-y-1">
            <Option
              checked={schedule.cascade === "shift"}
              onSelect={() => set("cascade", "shift", "Changing a time moves the slots after it.")}
              title="Move the slots after it"
              hint="Or before it, for a start. Every slot keeps its length."
            />
            <Option
              checked={schedule.cascade === "next"}
              onSelect={() => set("cascade", "next", "Changing a time only changes the slot next to it.")}
              title="Only change the slot next to it"
              hint="It gets longer or shorter; nothing else moves."
            />
          </div>
        </Setting>

        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-300">Highlight the slot happening now</p>
          {pin("now")}
          <SettingsToggle checked={schedule.now} onChange={(on) => set("now", on)} label="Highlight the slot happening now" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Setting({ title, hint, pin, error, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-300">{title}</p>
        {pin}
      </div>
      {children}
      {error && (
        <p role="alert" className="text-xs leading-snug text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {hint && <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * Pin a setting for every new schedule. Filled: this schedule has the
 * pinned value (press to unpin). Hollow with a note: something else is
 * pinned (press to pin this one instead). Hollow alone: nothing pinned.
 */
function PinButton({ setting, pinned, holds, onToggle }) {
  const elsewhere = pinned !== undefined && !holds;
  const name = SETTING_NAME[setting];
  return (
    <span className="flex shrink-0 items-center gap-1">
      {elsewhere && (
        <span className="text-[10px] text-slate-400 dark:text-slate-500" data-testid={`pinned-${setting}`}>
          Pinned: {PINNED_LABEL[setting](pinned)}
        </span>
      )}
      <button
        type="button"
        aria-pressed={holds}
        aria-label={`Pin ${name} for every new schedule`}
        title={
          holds
            ? "Every new schedule starts with this. Click to unpin."
            : elsewhere
              ? "Pin this instead, for every new schedule"
              : "Pin: start every new schedule with this"
        }
        data-testid={`pin-${setting}`}
        onClick={onToggle}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
          holds
            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            : "text-slate-300 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-[#1f1f1f] dark:hover:text-slate-300"
        )}
      >
        <Pin className={cn("h-3.5 w-3.5", holds && "fill-current")} />
      </button>
    </span>
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
