// @ts-nocheck
/**
 * @file Every change to an open note's schedule goes through here: one
 * place that applies a change from backend/lib/schedule.js, keeps what it
 * replaced for Undo, and says what else moved ("Adjusted 16 other slots.")
 * in the app's usual toast, with Undo.
 *
 * Refusals come back as a sentence for the caller to show where the change
 * was made. Undo history is per note and lasts while the note is open.
 */
import { useCallback, useRef } from "react";
import { describeChange, setSlotText } from "@/lib/schedule";
import { showDeleteToast } from "@/components/tasks/DeleteToast";

const HISTORY = 30;

/**
 * @param {import("@/lib/schedule").Schedule} schedule
 * @param {(next: import("@/lib/schedule").Schedule) => void} onChange
 */
export function useScheduleEditor(schedule, onChange) {
  // Changes can land faster than React re-renders (a time committed, then
  // its field's blur): each one builds on the last, not on the last render.
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const historyRef = useRef([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const put = useCallback((next) => {
    scheduleRef.current = next;
    onChangeRef.current(next);
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (previous) put(previous);
  }, [put]);

  /**
   * @param {(s: any) => { schedule?: any, error?: string }} change
   * @param {{ editedId?: string, done?: string, quiet?: boolean }} [opts]
   *   editedId: the slot changed on purpose (not counted as "other").
   *   done: what was done, said first ("Split in two.").
   *   quiet: don't list what else moved.
   * @returns {string | null} a refusal, or null
   */
  const apply = useCallback(
    (change, { editedId, done, quiet = false } = {}) => {
      const before = scheduleRef.current;
      const result = change(before);
      if (result.error) return result.error;
      if (JSON.stringify(result.schedule) === JSON.stringify(before)) return null;
      historyRef.current = [...historyRef.current.slice(1 - HISTORY), before];
      put(result.schedule);
      const effect = quiet ? null : describeChange(before, result.schedule, editedId);
      const label = [done, effect].filter(Boolean).join(" ");
      if (label) showDeleteToast({ label, onUndo: undo, duration: 5000 });
      return null;
    },
    [put, undo]
  );

  /** Typing in a slot: saved as it goes, undone by the field's own Undo. */
  const setText = useCallback(
    (id, text) => {
      const s = scheduleRef.current;
      const result = setSlotText(s, s.slots.findIndex((slot) => slot.id === id), text);
      if (result.schedule) put(result.schedule);
    },
    [put]
  );

  /** A change that was refused or put back, and why. */
  const problem = useCallback((message) => {
    showDeleteToast({ label: message, hideUndo: true, duration: 6000 });
  }, []);

  return { apply, undo, setText, problem };
}

/** Where a slot is now, by id — slots move as the schedule changes. */
export const indexOf = (s, id) => s.slots.findIndex((slot) => slot.id === id);
