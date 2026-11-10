// @ts-nocheck
/**
 * @file The Tags row: one box that holds the chosen tags and the caret.
 *
 * Type to filter the saved tags or to make a new one; Enter (or a comma)
 * adds it, Backspace in an empty box takes the last one off. The list of
 * suggestions floats, so the form's scrolling body never cuts it off.
 */
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { afterPress } from "@/lib/afterPress";
import { cn } from "@/lib/utils";

export default function TagsField({ form, setForm, savedTags }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  // Escape hides the list until the next keystroke, without closing the form.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const tags = form.tags || [];

  const typed = text.trim();
  const matches = savedTags
    .map((tag) => tag.name)
    .filter((name) => !tags.includes(name))
    .filter((name) => !typed || name.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 30);
  const isNew =
    !!typed &&
    !tags.includes(typed) &&
    !savedTags.some((tag) => tag.name.toLowerCase() === typed.toLowerCase());
  // What the list offers, in order: saved tags that match, then "make a new one".
  const options = [...matches.map((name) => ({ name, create: false })), ...(isNew ? [{ name: typed, create: true }] : [])];
  const open = focused && !dismissed && options.length > 0;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  const add = (name) => {
    const tag = String(name || "").trim();
    if (tag) setForm((f) => ((f.tags || []).includes(tag) ? f : { ...f, tags: [...(f.tags || []), tag] }));
    setText("");
    setActive(0);
  };
  const remove = (tag) => setForm((f) => ({ ...f, tags: (f.tags || []).filter((t) => t !== tag) }));

  const onKeyDown = (e) => {
    if (e.nativeEvent?.isComposing) return;
    if (e.key === "Enter" || e.key === ",") {
      // Enter with nothing typed and no list is left alone, so it can't
      // swallow the form's own shortcuts.
      if (!typed && !(open && e.key === "Enter")) {
        if (e.key === ",") e.preventDefault();
        return;
      }
      e.preventDefault();
      // Stop the dialog's Mod+Enter / title-Enter handlers seeing it.
      e.stopPropagation();
      // A saved tag that matches exactly wins over the highlighted row,
      // so typing a whole tag and pressing Enter always adds THAT tag.
      const exact = matches.find((name) => name.toLowerCase() === typed.toLowerCase());
      if (e.key === ",") add(exact || typed);
      else add(exact || (open ? options[activeIndex]?.name : typed));
    } else if (e.key === "Backspace" && !text && tags.length) {
      remove(tags[tags.length - 1]);
    } else if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((i) => (Math.min(i, options.length - 1) + 1) % options.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((i) => (Math.min(i, options.length - 1) - 1 + options.length) % options.length);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) setDismissed(true); }}>
      <PopoverAnchor asChild>
        <div
          ref={boxRef}
          // Clicking the padding focuses the input, like any text box.
          onMouseDown={(e) => { if (e.target === boxRef.current) { e.preventDefault(); inputRef.current?.focus(); } }}
          className={cn(
            "flex min-h-9 min-w-0 cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface-card px-2 py-[5px] transition-[border-color,box-shadow] dark:bg-night-sunken",
            "focus-within:border-ink-900 focus-within:ring-[3px] focus-within:ring-ink-900/10 dark:focus-within:border-sun-400 dark:focus-within:ring-sun-400/20"
          )}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-ink-100 py-0.5 pl-2 pr-1 text-xs font-medium text-ink-800 dark:bg-night-high dark:text-ink-100"
            >
              {/* A tag with no spaces still has to wrap inside the box. */}
              <span className="min-w-0 [overflow-wrap:anywhere]">{tag}</span>
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => remove(tag)}
                className="rounded p-0.5 text-ink-400 transition-colors hover:text-red-600 dark:text-ink-500 dark:hover:text-red-400"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={text}
            aria-label="Add a tag"
            placeholder={tags.length ? "" : "Add a tag"}
            autoComplete="off"
            autoCapitalize="none"
            enterKeyHint="done"
            onChange={(e) => { setText(e.target.value); setDismissed(false); setActive(0); }}
            onKeyDown={onKeyDown}
            onFocus={() => { setFocused(true); setDismissed(false); }}
            // The typed tag becomes a chip once the mouse is up: a new chip
            // can wrap the box onto another line, and doing that mid-press
            // would move whatever is being clicked.
            onBlur={() => { setFocused(false); if (typed) afterPress(() => add(typed)); }}
            className="h-6 min-w-[3rem] flex-1 bg-transparent px-1 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-48 w-[var(--radix-popover-trigger-width)] overflow-y-auto overscroll-contain rounded-lg p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // A click back in the box isn't "outside" — the caret is still there.
        onInteractOutside={(e) => { if (boxRef.current?.contains(e.target)) e.preventDefault(); }}
      >
        {options.map((option, index) => (
          <button
            key={`${option.create ? "new" : "tag"}:${option.name}`}
            type="button"
            // mousedown, not click: the input must not blur first (blur
            // adds whatever is typed, which would add the wrong tag).
            onMouseDown={(e) => { e.preventDefault(); add(option.name); }}
            onMouseEnter={() => setActive(index)}
            className={cn(
              "block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground",
              index === activeIndex && "bg-selected"
            )}
          >
            {option.create ? <>Create “{option.name}”</> : option.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
