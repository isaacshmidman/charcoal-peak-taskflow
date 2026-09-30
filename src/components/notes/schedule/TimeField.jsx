// @ts-nocheck
/**
 * @file A time you change by typing, for the Schedule Builder. Click the
 * hour or the minute and type two digits; click AM/PM (or type A or P) to
 * flip it. No list of fixed times to scroll through.
 *
 * Typing: a first digit that can't begin a two-digit value finishes the
 * part at once (hour 2–9 → 2–9 o'clock, minute 6–9 → :06–:09). A finished
 * hour moves on to the minutes, finished minutes to AM/PM. Arrow keys
 * step the part, Left/Right move between parts, Esc puts the time back.
 *
 * Nothing changes the schedule until the time is finished: the minutes
 * typed in full, AM/PM flipped, Enter, or leaving the field. Only a time
 * that passes `validate` is committed; while one doesn't, the field says
 * why right under it, and leaving puts the last good time back.
 *
 * The hour and minute are real inputs with inputMode="numeric", so a
 * phone brings up its number pad.
 *
 * What's being typed lives in refs, not state: focus moves between the
 * parts inside a single keypress, and those handlers must see the digit
 * typed a moment ago, not the one from the last render.
 */
import { useEffect, useReducer, useRef } from "react";
import { clockParts, partsToMinutes } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const PARTS = ["hour", "minute", "ampm"];
const NOTHING = { part: null, digit: "" };

/**
 * @param {{
 *   value: number,                        // minutes after midnight (1440 = end of day)
 *   end?: boolean,                        // an end time: 12:00 AM means the end of the day
 *   label: string,                        // e.g. "Start of 7:00 AM – 8:00 AM"
 *   validate?: (minutes: number) => string | null,
 *   onCommit: (minutes: number) => string | null,   // a refusal comes back as a sentence
 *   onProblem?: (message: string) => void,          // a time was put back, and why
 *   testId?: string,
 *   className?: string,
 * }} props
 */
export default function TimeField({ value, end = false, label, validate, onCommit, onProblem, testId, className }) {
  const [, rerender] = useReducer((n) => n + 1, 0);
  // The time being edited; null while showing `value`.
  const draftRef = useRef(null);
  // A digit typed that may still get a second one ("1" → 10, 11, 12).
  const pendingRef = useRef(NOTHING);
  // Enter and Esc finish the edit themselves; the blur they cause mustn't again.
  const skipBlurRef = useRef(false);
  const refs = { hour: useRef(null), minute: useRef(null), ampm: useRef(null) };
  const groupRef = useRef(null);

  const saved = clockParts(value);
  const draft = draftRef.current;
  const pending = pendingRef.current;
  const parts = draft || saved;
  const problem = draft ? validate?.(partsToMinutes(draft, { end })) ?? null : null;

  // A new value from outside (a cascade, Undo) shows unless mid-edit.
  useEffect(() => {
    if (!draftRef.current && !pendingRef.current.part) return;
    if (document.activeElement && groupRef.current?.contains(document.activeElement)) return;
    draftRef.current = null;
    pendingRef.current = NOTHING;
    rerender();
  }, [value]);

  const setDraft = (next) => {
    draftRef.current = next;
    rerender();
  };
  const setPending = (next) => {
    pendingRef.current = next;
    rerender();
  };

  /** The time as typed so far, with a half-typed part taken as it stands. */
  const current = () => {
    const base = draftRef.current || clockParts(value);
    const { part, digit } = pendingRef.current;
    if (!part) return base;
    const n = Number(digit);
    if (part === "hour") return n >= 1 ? { ...base, hour: n } : base;
    return { ...base, minute: n };
  };

  const takePending = () => {
    if (!pendingRef.current.part) return;
    const next = current();
    pendingRef.current = NOTHING;
    setDraft(next);
  };

  const focusPart = (part) => {
    const el = refs[part]?.current;
    if (!el) return;
    el.focus();
    el.select?.();
  };

  /**
   * Put `next` into the schedule if it's good. Returns false only when
   * it isn't valid yet (so the edit carries on).
   */
  const commit = (next) => {
    const at = partsToMinutes(next, { end });
    if (at !== value) {
      if (validate?.(at)) return false;
      const refused = onCommit(at);
      if (refused) onProblem?.(refused);
    }
    setDraft(null);
    return true;
  };

  /** Leaving the field, or Enter: commit, or put the last good time back. */
  const finish = () => {
    const touched = draftRef.current || pendingRef.current.part;
    const next = current();
    pendingRef.current = NOTHING;
    if (!touched) return rerender();
    const at = partsToMinutes(next, { end });
    const bad = at === value ? null : validate?.(at);
    if (bad) {
      setDraft(null);
      onProblem?.(bad);
      return;
    }
    commit(next);
  };

  /** One digit into `part`; returns the part the next digit goes to. */
  const typeDigit = (part, digit) => {
    const d = Number(digit);
    const { part: waiting, digit: first } = pendingRef.current;
    if (part === "hour") {
      if (waiting === "hour") {
        const n = Number(first + digit);
        pendingRef.current = NOTHING;
        if (n >= 1 && n <= 12) {
          setDraft({ ...current(), hour: n });
          focusPart("minute");
          return "minute";
        }
      }
      takePending();
      if (d <= 1) {
        setPending({ part: "hour", digit });
        return "hour";
      }
      setDraft({ ...current(), hour: d });
      focusPart("minute");
      return "minute";
    }
    if (part !== "minute") return part;
    let next;
    if (waiting === "minute") {
      pendingRef.current = NOTHING;
      next = { ...current(), minute: Number(first + digit) };
    } else {
      takePending();
      if (d <= 5) {
        setPending({ part: "minute", digit });
        return "minute";
      }
      next = { ...current(), minute: d };
    }
    setDraft(next);
    // The minutes are the last thing typed: a good time goes in now.
    commit(next);
    focusPart("ampm");
    return "ampm";
  };

  /** Several digits at once (pasted, dictated, a phone's suggestion), in order. */
  const typeDigits = (part, digits) => {
    let at = part;
    for (const digit of digits) at = typeDigit(at, digit);
  };

  const step = (part, by) => {
    takePending();
    const now = current();
    if (part === "hour") setDraft({ ...now, hour: ((now.hour - 1 + by + 12) % 12) + 1 });
    else if (part === "minute") setDraft({ ...now, minute: (now.minute + by + 60) % 60 });
    else setMeridiem(!now.pm);
  };

  const setMeridiem = (pm) => {
    takePending();
    const next = { ...current(), pm };
    setDraft(next);
    commit(next);
  };

  const onKeyDown = (part) => (event) => {
    const { key } = event;
    if (/^\d$/.test(key) && part !== "ampm") {
      event.preventDefault();
      typeDigit(part, key);
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      step(part, key === "ArrowUp" ? 1 : -1);
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      const at = PARTS.indexOf(part) + (key === "ArrowRight" ? 1 : -1);
      if (at >= 0 && at < PARTS.length) {
        event.preventDefault();
        focusPart(PARTS[at]);
      }
    } else if (key === "Enter") {
      event.preventDefault();
      finish();
      skipBlurRef.current = true;
      event.currentTarget.blur();
    } else if (key === "Escape") {
      event.preventDefault();
      pendingRef.current = NOTHING;
      setDraft(null);
      skipBlurRef.current = true;
      event.currentTarget.blur();
    } else if (key === "Backspace" || key === "Delete") {
      event.preventDefault();
      setPending(NOTHING);
    } else if (part === "ampm" && /^[ap]$/i.test(key)) {
      event.preventDefault();
      setMeridiem(key.toLowerCase() === "p");
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey) {
      // Nothing else can be typed into a time.
      event.preventDefault();
    }
  };

  // Text that arrives without a key for each digit — a phone keyboard that
  // doesn't report keys, paste, dictation: take what landed, in order.
  const onChange = (part) => (event) => {
    const shown = part === "hour" ? hourText : minuteText;
    const typed = event.target.value;
    const added = (typed.startsWith(shown) ? typed.slice(shown.length) : typed).replace(/\D/g, "");
    if (added) typeDigits(part, added);
    else rerender();
  };

  const onFocus = (part) => (event) => {
    // Moving to another part keeps a half-typed digit as it stands.
    if (pendingRef.current.part && pendingRef.current.part !== part) takePending();
    event.target.select?.();
  };

  const onBlur = (event) => {
    if (groupRef.current?.contains(event.relatedTarget)) return;
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    finish();
  };

  const hourText = pending.part === "hour" ? pending.digit : String(parts.hour);
  const minuteText = pending.part === "minute" ? pending.digit : String(parts.minute).padStart(2, "0");
  const partClass =
    "rounded-[3px] bg-transparent p-0 text-inherit caret-transparent outline-none selection:bg-transparent focus:bg-slate-200 focus:text-slate-900 dark:focus:bg-[#2c2c2c] dark:focus:text-slate-100";
  // The digits are 16px on phones (iOS zooms into any smaller field) and
  // 14px wider; AM/PM sits smaller beside them, like a clock.
  const digitClass = "text-base tabular-nums md:text-sm";

  return (
    <span
      ref={groupRef}
      role="group"
      aria-label={label}
      aria-invalid={problem ? true : undefined}
      data-testid={testId}
      data-value={value}
      onBlur={onBlur}
      className={cn(
        "relative inline-flex items-center rounded px-0.5 tabular-nums",
        problem && "ring-1 ring-red-400 dark:ring-red-500",
        className
      )}
    >
      <input
        ref={refs.hour}
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${label}, hour`}
        data-part="hour"
        value={hourText}
        onChange={onChange("hour")}
        onKeyDown={onKeyDown("hour")}
        onFocus={onFocus("hour")}
        className={cn(partClass, digitClass, "w-[2ch] text-right")}
      />
      <span aria-hidden="true">:</span>
      <input
        ref={refs.minute}
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${label}, minutes`}
        data-part="minute"
        value={minuteText}
        onChange={onChange("minute")}
        onKeyDown={onKeyDown("minute")}
        onFocus={onFocus("minute")}
        className={cn(partClass, digitClass, "w-[2ch] text-left")}
      />
      <button
        ref={refs.ampm}
        type="button"
        aria-label={`${label}, ${parts.pm ? "PM" : "AM"}`}
        data-part="ampm"
        onClick={() => setMeridiem(!current().pm)}
        onKeyDown={onKeyDown("ampm")}
        onFocus={onFocus("ampm")}
        className={cn(partClass, "ml-[0.3ch] px-[1px] text-xs")}
      >
        {parts.pm ? "PM" : "AM"}
      </button>
      {problem && (
        <span
          role="alert"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-max max-w-[16rem] rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium leading-snug text-white shadow-md dark:bg-red-500"
        >
          {problem}
        </span>
      )}
    </span>
  );
}
