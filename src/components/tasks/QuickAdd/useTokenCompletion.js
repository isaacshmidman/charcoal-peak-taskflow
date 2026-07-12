// @ts-check
/**
 * @file Caret-aware token completion for the QuickAdd input. Detects the
 * whitespace-delimited token containing the caret; when it starts with
 * `#` (tags) or `!` (priorities) the dropdown opens with valid options —
 * the user asked for this so custom names can't be mistyped.
 *
 * Owns the fiddly parts so the component stays simple:
 * - roving highlight (ArrowUp/Down), accept (Enter/Tab), dismiss (Esc)
 * - splice-on-accept with caret restoration: setSelectionRange runs in a
 *   useLayoutEffect AFTER React commits the new controlled value —
 *   setting the caret synchronously in the event handler gets clobbered
 *   by the re-render.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";

/** Names with spaces get the quoted sigil form the parser understands. */
function tokenText(sigil, name) {
  return /\s/.test(name) ? `${sigil}"${name}"` : `${sigil}${name}`;
}

export function useTokenCompletion({ value, setValue, inputRef, priorities = [], savedTags = [] }) {
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const pendingCaretRef = useRef(null);

  // Restore the caret after an accept-splice re-render.
  useLayoutEffect(() => {
    if (pendingCaretRef.current == null) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    }
    pendingCaretRef.current = null;
  }, [value, inputRef]);

  // The token under the caret: scan back from the caret to whitespace.
  const active = useMemo(() => {
    const upto = value.slice(0, caret);
    const start = Math.max(upto.lastIndexOf(" "), upto.lastIndexOf("\t")) + 1;
    const token = upto.slice(start);
    if (token.startsWith("#")) return { sigil: "#", start, query: token.slice(1) };
    if (token.startsWith("!")) return { sigil: "!", start, query: token.slice(1) };
    return null;
  }, [value, caret]);

  const items = useMemo(() => {
    if (!active || dismissed) return [];
    const q = active.query.toLowerCase().replace(/^"/, "");
    if (active.sigil === "!") {
      return priorities
        .filter((p) => !q || String(p.name).toLowerCase().includes(q))
        .map((p) => ({ key: p.id, label: p.name, color: p.color, sigil: "!" }));
    }
    return savedTags
      .filter((t) => !q || String(t.name).toLowerCase().includes(q))
      .slice(0, 12)
      .map((t) => ({ key: t.id || t.name, label: t.name, sigil: "#" }));
  }, [active, dismissed, priorities, savedTags]);

  const open = items.length > 0;

  // Re-arm after a dismissal once the user moves to a different token.
  const activeStart = active?.start ?? -1;
  const lastStartRef = useRef(activeStart);
  if (lastStartRef.current !== activeStart) {
    lastStartRef.current = activeStart;
    if (dismissed) setDismissed(false);
    if (activeIndex !== 0) setActiveIndex(0);
  }

  const accept = (item) => {
    if (!active) return;
    const insert = tokenText(item.sigil, item.label) + " ";
    const next = value.slice(0, active.start) + insert + value.slice(caret);
    pendingCaretRef.current = active.start + insert.length;
    setValue(next);
    setCaret(active.start + insert.length);
    setActiveIndex(0);
  };

  /** Wire into the input's onKeyDown BEFORE any submit handling.
   * @returns {boolean} true when the event was consumed by the dropdown. */
  const handleKeyDown = (e) => {
    if (!open) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(items[Math.min(activeIndex, items.length - 1)]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      return true;
    }
    return false;
  };

  /** Track the caret from the events React gives us. */
  const trackCaret = (e) => setCaret(e.target.selectionStart ?? 0);

  return { open, items, activeIndex, setActiveIndex, accept, handleKeyDown, trackCaret };
}
