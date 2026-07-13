// @ts-check
/**
 * @file In-title token parsing for form title inputs. Typing
 * `!high #family tomorrow` into a task title applies to the real form
 * fields when a token completes (accepted from the #/! dropdown, or
 * terminated by a space) and strips the token from the visible title —
 * so the dedicated priority/tag/date controls light up while the title
 * stays clean. Quotes still escape (`"tomorrow"` stays literal).
 *
 * `grammar` subsets what each form honors:
 *   { dates, times, recurrence, tags, priority }
 * TaskForm = all; SubtaskForm = dates+times; NoteEditor = tags+priority.
 *
 * This is the strip-and-apply cousin of the old useTokenCompletion
 * (which inserted token text for the standalone quick-add). Fields come
 * from parseQuickAdd's per-token values; the #/! dropdown reuses
 * TokenAutocomplete.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseQuickAdd } from "@/lib/quickAddParser";

const grammarAllows = (type, g) =>
  (type === "date" && g.dates) ||
  (type === "time" && g.times) ||
  (type === "recurrence" && g.recurrence) ||
  (type === "tag" && g.tags) ||
  (type === "priority" && g.priority);

/** Map a single completed token to the form fields it sets. */
function tokenFields(tok, parsed) {
  switch (tok.type) {
    case "date":
      return { due_date: tok.value };
    case "time":
      return tok.value; // { task_time, task_end_time? }
    case "tag":
      return { tags: [tok.value] };
    case "priority":
      return { priority_id: tok.value.id };
    case "recurrence": {
      const f = { task_type: "recurring", recurrence: parsed.fields.recurrence };
      if (parsed.fields.recurrence_days) f.recurrence_days = parsed.fields.recurrence_days;
      if (parsed.fields.due_date) f.due_date = parsed.fields.due_date; // first occurrence
      return f;
    }
    default:
      return {};
  }
}

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
      const parsed = parseQuickAdd(nextVal, { priorities, now: new Date() });
      // The token whose end sits just before the terminator we just typed.
      const tok = parsed.tokens.find(
        (t) => t.end === nextCaret - 1 && grammarAllows(t.type, grammar)
      );
      if (tok) {
        const before = nextVal.slice(0, tok.start);
        const after = nextVal.slice(nextCaret); // past the terminator space
        const stripped = (before + after).replace(/\s{2,}/g, " ");
        pendingCaretRef.current = before.length;
        setValue(stripped);
        setCaret(before.length);
        onApply(tokenFields(tok, parsed));
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
