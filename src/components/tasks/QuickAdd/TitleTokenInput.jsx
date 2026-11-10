// @ts-nocheck
/**
 * @file A form's title box. It understands #tag / !priority tokens, and
 * it WRAPS: a long title (or a pasted link) runs onto more lines and the
 * box grows with it, instead of sliding sideways inside one line where
 * most of it can't be read. It is still one line of meaning — a pasted
 * line break becomes a space, and Enter finishes the form.
 * Wraps the useTitleTokens hook + the #/! TokenAutocomplete dropdown and
 * merges the chosen field back into the form. Shared by TaskForm and
 * SubtaskForm — each passes a `grammar` subset ({ tags, priority }).
 */
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import TokenAutocomplete from "./TokenAutocomplete";
import { useTitleTokens } from "./useTitleTokens";

export default function TitleTokenInput({
  form,
  setForm,
  grammar,
  priorities = [],
  savedTags = [],
  titleKey = "title",
  placeholder = "What needs to be done?",
  testid,
  autoFocus = false,
  onEnter,
  inputClassName = "",
}) {
  const inputRef = useRef(null);
  const value = form[titleKey] || "";
  const setValue = (v) => setForm((f) => ({ ...f, [titleKey]: v }));

  // Merge a completed token's fields: tags append (deduped), rest set.
  const onApply = (fields) =>
    setForm((f) => {
      const next = { ...f };
      for (const [k, v] of Object.entries(fields)) {
        if (k === "tags") next.tags = [...new Set([...(f.tags || []), ...v])];
        else next[k] = v;
      }
      return next;
    });

  const tokens = useTitleTokens({ value, setValue, inputRef, priorities, savedTags, grammar, onApply });

  // Grow to fit the words. (scrollHeight is 0 where there is no layout —
  // the unit-test DOM — and the box then keeps its one-row height.)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="relative z-30">
      <textarea
        ref={inputRef}
        rows={1}
        placeholder={placeholder}
        aria-label="Title"
        value={value}
        autoFocus={autoFocus}
        data-testid={testid}
        data-title-input=""
        enterKeyHint="done"
        className={cn(
          "block w-full resize-none overflow-hidden bg-transparent text-foreground outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground",
          inputClassName
        )}
        onChange={(e) => {
          // One line of meaning: a pasted line break becomes a space.
          if (/[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/\s*[\r\n]+\s*/g, " ");
          tokens.onChange(e);
        }}
        onKeyUp={tokens.trackCaret}
        onClick={tokens.trackCaret}
        onKeyDown={(e) => {
          // The token dropdown gets first refusal — while it's open, Enter
          // accepts the highlighted suggestion rather than finishing.
          if (tokens.handleKeyDown(e)) return;
          // A free Enter in this single-line field means "done" (the record
          // is already autosaved). Modified Enter is left alone so the
          // form's own Mod+Enter handler owns it — handling both here
          // would commit twice. isComposing guards IME candidate selection.
          if (
            e.key === "Enter" &&
            !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey &&
            !e.nativeEvent?.isComposing
          ) {
            e.preventDefault();
            onEnter?.();
          }
        }}
      />
      <TokenAutocomplete
        open={tokens.open}
        items={tokens.items}
        activeIndex={tokens.activeIndex}
        onHover={tokens.setActiveIndex}
        onSelect={tokens.accept}
      />
    </div>
  );
}
