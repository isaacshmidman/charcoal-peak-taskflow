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
        onKeyDown={(e) => { tokens.handleKeyDown(e); }}
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
