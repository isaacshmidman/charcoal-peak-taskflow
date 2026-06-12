// @ts-check
/**
 * @file Subscribe to a semantic shortcut event (see lib/shortcuts.js).
 * Pages use this instead of their own keydown listeners, so all key
 * parsing stays in useGlobalShortcuts (single source of truth).
 *
 * The handler is kept in a ref so subscribers can pass inline closures
 * without re-binding the window listener every render.
 */
import { useEffect, useRef } from "react";

/**
 * @param {string} eventName  one of SHORTCUT_EVENTS
 * @param {(detail: any) => void} handler
 */
export function useShortcutEvent(eventName, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    /** @param {Event} e */
    const onEvent = (e) => {
      handlerRef.current(/** @type {CustomEvent} */ (e).detail);
    };
    window.addEventListener(eventName, onEvent);
    return () => window.removeEventListener(eventName, onEvent);
  }, [eventName]);
}
