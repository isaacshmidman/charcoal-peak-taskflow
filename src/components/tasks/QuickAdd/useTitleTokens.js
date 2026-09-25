// @ts-check
/**
 * @file In-title tokens for form title inputs: `#tag` and `!priority`.
 * A completed token — accepted from the #/! dropdown, or terminated by a
 * space — is applied to the real form field and stripped from the visible
 * title, so the tag/priority controls light up while the title stays clean.
 *
 * `grammar` subsets what each form honors: { tags, priority }.
 *
 * Titles are NOT read for dates, times or recurrence. That used to happen
 * and was removed deliberately — see titleTokens.js.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { completedTokenAt } from "./titleTokens";

export function useTitleTokens({ value, setValue, inputRef, priorities = [], savedTags = [], grammar, onApply }) {
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const pendingCaretRef = useRef(null);

  // Restore the caret after a strip re-render (see useTokenCompletion note).
  useLayoutEffect(() => {
    if (pendingCaretRef.current == null) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    }
    pendingCaretRef.current = null;
  }, [value, inputRef]);

  // Active #/! token under the caret (only when the grammar allows it).
  const active = useMemo(() => {
    const upto = value.slice(0, caret);
    const start = Math.max(upto.lastIndexOf(" "), upto.lastIndexOf("\t")) + 1;
    const token = upto.slice(start);
    if (grammar.tags && token.startsWith("#")) return { sigil: "#", start, query: token.slice(1).replace(/^"/, "") };
    if (grammar.priority && token.startsWith("!")) return { sigil: "!", start, query: token.slice(1) };
    return null;
  }, [value, caret, grammar]);

  const items = useMemo(() => {
    if (!active || dismissed) return [];
    const q = active.query.toLowerCase();
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

  // Re-arm dismissal when the caret moves to a different token.
  const activeStart = active?.start ?? -1;
  const lastStartRef = useRef(activeStart);
  if (lastStartRef.current !== activeStart) {
    lastStartRef.current = activeStart;
    if (dismissed) setDismissed(false);
    if (activeIndex !== 0) setActiveIndex(0);
  }

  /** Strip [start, caret) from the title and apply `fields`. */
  const stripAndApply = (start, end, fields) => {
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = (before + after).replace(/\s{2,}/g, " ");
    pendingCaretRef.current = before.length;
    setValue(next);
    setCaret(before.length);
    setDismissed(false);
    onApply(fields);
  };

  // Accept a #/! item from the dropdown → strip the token, set the field.
  const accept = (item) => {
    if (!active) return;
    stripAndApply(
      active.start,
      caret,
      item.sigil === "!" ? { priority_id: item.key } : { tags: [item.label] }
    );
    setActiveIndex(0);
  };

  /** Input onChange: track caret, and when a space terminates a complete
   * token, apply + strip it. Returns nothing — always drives setValue. */
  const onChange = (e) => {
    const nextVal = e.target.value;
    const nextCaret = e.target.selectionStart ?? nextVal.length;
    setCaret(nextCaret);

    const grew = nextVal.length === value.length + 1;
    const typedTerminator = grew && /\s/.test(nextVal[nextCaret - 1] || "");
    if (typedTerminator) {
      // The #/! token whose end sits just before the space we just typed.
      const tok = completedTokenAt(nextVal, nextCaret - 1, grammar, priorities);
      if (tok) {
        const before = nextVal.slice(0, tok.start);
        const after = nextVal.slice(nextCaret); // past the terminator space
        const stripped = (before + after).replace(/\s{2,}/g, " ");
        pendingCaretRef.current = before.length;
        setValue(stripped);
        setCaret(before.length);
        onApply(tok.fields);
        return;
      }
    }
    setValue(nextVal);
  };

  /** Wire BEFORE the input's own key handling; true = consumed. */
  const handleKeyDown = (e) => {
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => (i + 1) % items.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => (i - 1 + items.length) % items.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(items[Math.min(activeIndex, items.length - 1)]); return true; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDismissed(true); return true; }
    return false;
  };

  const trackCaret = (e) => setCaret(e.target.selectionStart ?? 0);

  return { open, items, activeIndex, setActiveIndex, accept, onChange, handleKeyDown, trackCaret };
}
