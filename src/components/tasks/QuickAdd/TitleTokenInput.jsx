// @ts-nocheck
/**
 * @file A form title <Input> that understands in-title tokens. Wraps the
 * useTitleTokens hook + the #/! TokenAutocomplete dropdown and merges
 * parsed fields back into the form. Shared by TaskForm, SubtaskForm, and
 * NoteEditor — each passes a `grammar` subset.
 */
import { useRef } from "react";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="relative z-30">
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        data-testid={testid}
        onChange={tokens.onChange}
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
