// @ts-check
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Debounced autosave for a form dialog. Whenever `payload` changes and
 * `valid` is true, persists it via `onSave(payload)` after `delay` ms.
 * `onSave` owns create-vs-update (track the record id in a ref and
 * upsert). There is NO "saved" UI — the caller greys its confirm button
 * only while invalid, and calls `flush()` when the dialog closes so a
 * pending debounce commits instantly (optimistic, so it feels instant).
 *
 * `reset(baseline)` re-baselines when the dialog reopens on a different
 * record, so opening an existing item never triggers a redundant save.
 *
 * @param {{
 *   payload: Record<string, any>,
 *   valid: boolean,
 *   onSave: (payload: Record<string, any>) => Promise<any> | any,
 *   delay?: number,
 * }} opts
 */
export function useAutosave({ payload, valid, onSave, delay = 400 }) {
  const serialized = JSON.stringify(payload);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const validRef = useRef(valid);
  validRef.current = valid;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const lastSavedRef = useRef(serialized); // baseline = opening state
  const timerRef = useRef(/** @type {any} */ (null));
  const [saving, setSaving] = useState(false);

  const doSave = useCallback(async () => {
    if (!validRef.current) return;
    const snapshot = JSON.stringify(payloadRef.current);
    if (snapshot === lastSavedRef.current) return;
    // Optimistically mark this snapshot saved BEFORE awaiting so rapid
    // keystrokes don't fire overlapping duplicate creates.
    lastSavedRef.current = snapshot;
    setSaving(true);
    try {
      await onSaveRef.current(payloadRef.current);
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!valid) return undefined;
    if (serialized === lastSavedRef.current) return undefined;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(doSave, delay);
    return () => clearTimeout(timerRef.current);
  }, [serialized, valid, delay, doSave]);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    return doSave();
  }, [doSave]);

  const reset = useCallback((baseline) => {
    lastSavedRef.current = JSON.stringify(baseline);
    clearTimeout(timerRef.current);
  }, []);

  return { saving, flush, reset };
}
