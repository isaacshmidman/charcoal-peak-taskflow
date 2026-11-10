// @ts-nocheck
/**
 * @file Docked formatting toolbar for RichDescriptionEditor. Receives
 * the TipTap `editor` instance, and is shown/hidden by the parent based
 * on editor focus.
 *
 * iOS hardening: every control fires on `onMouseDown` with
 * `preventDefault()` so tapping a button never blurs the editable
 * (keeps the selection + keyboard up). The same goes for the menus
 * (style/colour/highlight/font/lists): they float above the page in a
 * portal, so the scrolling body of a form can't cut them off, and they
 * never take focus. The parent keeps the toolbar visible while one is
 * open (`onPickerOpenChange(true)`).
 *
 * With a mouse the bar wraps onto a second line when it has to. On a
 * touch screen it stays one line and scrolls sideways, the way a phone's
 * own format bar does — two lines of buttons over a keyboard leave no
 * room for the words.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Baseline,
  Highlighter,
  Type,
  ListChecks,
  ListPlus,
  List as ListIcon,
  Indent,
  Outdent,
  ChevronDown,
  Undo2,
  Redo2,
  Heading,
  RemoveFormatting,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { isMacLike } from "@/lib/shortcuts";

// 10 readable text colors (Tailwind ~500). "Default" clears the mark.
const TEXT_COLORS = [
  { label: "Red", hex: "#ef4444" },
  { label: "Orange", hex: "#f97316" },
  { label: "Amber", hex: "#f59e0b" },
  { label: "Green", hex: "#22c55e" },
  { label: "Teal", hex: "#14b8a6" },
  { label: "Blue", hex: "#3b82f6" },
  { label: "Indigo", hex: "#6366f1" },
  { label: "Violet", hex: "#8b5cf6" },
  { label: "Pink", hex: "#ec4899" },
  { label: "Slate", hex: "#64748b" },
];

// 5 pastel highlight colors. "None" clears.
// Yellow is deliberately ABSENT: the reserved --brand-yellow means "a task
// exists for this span" (richtext/taskLink.js), so a hand-made yellow would
// be indistinguishable from a real task link. Purple took its slot, and a
// boot migration rewrote the pale yellow this used to offer.
const HIGHLIGHTS = [
  { label: "Purple", hex: "#e9d5ff" },
  { label: "Green", hex: "#bbf7d0" },
  { label: "Blue", hex: "#bfdbfe" },
  { label: "Pink", hex: "#fbcfe8" },
  { label: "Orange", hex: "#fed7aa" },
];

// 10 web-safe / system font stacks. "Default" clears.
const FONTS = [
  { label: "Default", stack: "" },
  { label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { label: "Georgia", stack: "Georgia, serif" },
  { label: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { label: "Courier New", stack: '"Courier New", Courier, monospace' },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", stack: '"Trebuchet MS", Tahoma, sans-serif' },
  { label: "Garamond", stack: 'Garamond, "Times New Roman", serif' },
  { label: "System UI", stack: "system-ui, sans-serif" },
  { label: "Monospace", stack: "ui-monospace, SFMono-Regular, monospace" },
];

// Block styles. These were reachable only by typing markdown ("# ",
// "> ", "```"), which nobody discovers by accident. Each preview is drawn
// in roughly the style it applies.
const TEXT_STYLES = [
  { key: "paragraph", label: "Normal text", className: "text-xs" },
  { key: "h1", label: "Heading 1", level: 1, className: "text-base font-semibold" },
  { key: "h2", label: "Heading 2", level: 2, className: "text-sm font-semibold" },
  { key: "h3", label: "Heading 3", level: 3, className: "text-xs font-semibold" },
  { key: "quote", label: "Quote", className: "text-xs italic text-ink-500 dark:text-ink-400" },
  { key: "code", label: "Code block", className: "text-xs font-mono" },
];

// Marks "Clear formatting" removes. Deliberately a list, not
// unsetAllMarks(): that would also strip taskLink and silently cut a note
// span loose from the task made out of it.
const CLEARABLE_MARKS = ["bold", "italic", "underline", "strike", "code", "textStyle", "highlight"];

// List marker options. Each applies the right list + style attr.
const LIST_OPTIONS = [
  { key: "task", label: "Checklist", glyph: "☑" },
  { key: "disc", label: "Bullet •", glyph: "•" },
  { key: "circle", label: "Bullet ○", glyph: "○" },
  { key: "dash", label: "Bullet –", glyph: "–" },
  { key: "decimal", label: "Numbers 1.", glyph: "1." },
  { key: "lower-alpha", label: "Letters a.", glyph: "a." },
  { key: "upper-roman", label: "Roman I.", glyph: "I." },
];

/** A toolbar icon button. Uses onMouseDown+preventDefault for iOS focus. */
function TBtn({ active, disabled, onAction, title, children, testid }) {
  // Where the finger went down, to tell a tap from a swipe along the bar.
  const touchStart = useRef(null);
  return (
    <button
      type="button"
      data-testid={testid}
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onAction(); }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        const t = e.changedTouches?.[0];
        // Scrolling the bar and lifting the finger over a button isn't a
        // press. (No start point = a synthetic event: treat it as a tap.)
        if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) return;
        e.preventDefault();
        if (!disabled) onAction();
      }}
      className={cn(
        "inline-flex items-center justify-center h-7 min-w-7 px-1 rounded-md transition-colors shrink-0",
        // On is a quiet press, not a block of the primary colour: several
        // can be on at once, and in the dark the primary is bright yellow.
        active
          ? "bg-ink-900/10 text-ink-900 dark:bg-white/15 dark:text-ink-50"
          : "text-ink-600 dark:text-ink-300 hover:bg-selected",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

/**
 * A menu that opens from a toolbar button. It floats in a portal and
 * moves itself to stay on screen, so it is never cut off by the box it
 * sits in. Nothing in it takes focus: the caret stays in the text.
 */
function Picker({ icon: Icon, title, open, setOpen, onOpenChange, children, openUp = true, testid }) {
  const triggerRef = useRef(null);
  const change = (next) => { setOpen(next); onOpenChange?.(next); };
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverAnchor asChild>
        <button
          ref={triggerRef}
          type="button"
          title={title}
          aria-label={title}
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid={testid}
          onMouseDown={(e) => { e.preventDefault(); change(!open); }}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 h-7 px-1.5 rounded-md text-ink-600 dark:text-ink-300 transition-colors",
            open ? "bg-selected" : "hover:bg-selected"
          )}
        >
          <Icon className="w-4 h-4" />
          <ChevronDown className="w-3 h-3" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        // A bar docked under the editor opens upward; one pinned above the
        // note opens downward. Either flips if there isn't room.
        side={openUp ? "top" : "bottom"}
        align="start"
        collisionPadding={8}
        data-richtext-toolbar
        className="w-auto rounded-lg p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // The button toggles the menu itself; without this, pressing it
        // while open would close the menu and at once open it again.
        onInteractOutside={(e) => { if (triggerRef.current?.contains(e.target)) e.preventDefault(); }}
        // A press in the menu's padding must not take the caret either.
        onMouseDown={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default function Toolbar({ editor, onPickerOpenChange, wordLimit = 500, onMakeTask, placement = "docked" }) {
  // Everything below reads live editor state (active marks, the selection
  // for Make task, undo availability), so the bar re-renders on every
  // editor transaction itself. It used to rely on its host re-rendering —
  // true for the docked bar inside RichDescriptionEditor, but not for the
  // Notes bar, which sits outside it: selecting text there left Make task
  // disabled and the Bold/Italic states stale.
  const [, rerender] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!editor) return undefined;
    editor.on("transaction", rerender);
    return () => editor.off("transaction", rerender);
  }, [editor]);

  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);

  if (!editor) return null;

  const apply = (fn) => { fn(); };

  // Whichever picker is open keeps the toolbar alive (parent reads this).
  const anyPickerOpen = (next) => onPickerOpenChange?.(next);
  // A choice closes its picker, the way every other menu in the app
  // behaves. The editor keeps focus (mousedown never blurred it), so the
  // toolbar stays up.
  const pick = (setOpen, fn) => { fn(); setOpen(false); anyPickerOpen(false); };

  const setTextStyle = (key) => {
    const chain = editor.chain().focus();
    const inQuote = editor.isActive("blockquote");
    if (key === "paragraph") {
      chain.setParagraph();
      if (inQuote) chain.lift("blockquote");
    } else if (key === "quote") {
      chain.setParagraph();
      if (!inQuote) chain.setBlockquote();
    } else if (key === "code") {
      chain.setCodeBlock();
    } else {
      const level = TEXT_STYLES.find((t) => t.key === key)?.level;
      chain.setHeading({ level });
    }
    chain.run();
  };

  const clearFormatting = () => {
    const chain = editor.chain().focus();
    for (const mark of CLEARABLE_MARKS) chain.unsetMark(mark);
    // Headings and code blocks back to body text, out of any quote. Lists
    // stay: they're structure, not formatting.
    chain.setParagraph();
    if (editor.isActive("blockquote")) chain.lift("blockquote");
    chain.run();
  };

  const headingLevel = [1, 2, 3].find((level) => editor.isActive("heading", { level }));
  const activeStyle =
    editor.isActive("codeBlock") ? "code"
      : editor.isActive("blockquote") ? "quote"
        : headingLevel ? `h${headingLevel}`
          : "paragraph";

  const setListType = (key) => {
    const chain = editor.chain().focus();
    if (key === "task") {
      chain.toggleTaskList().run();
      return;
    }
    if (key === "disc" || key === "circle" || key === "dash") {
      // Ensure we're in a bullet list, then set the marker style.
      if (!editor.isActive("bulletList")) chain.toggleBulletList().run();
      editor.chain().focus().updateAttributes("bulletList", { listStyleType: key }).run();
      return;
    }
    // ordered variants
    if (!editor.isActive("orderedList")) chain.toggleOrderedList().run();
    editor.chain().focus().updateAttributes("orderedList", { listStyleType: key }).run();
  };

  const indent = () => {
    if (editor.isActive("listItem")) editor.chain().focus().sinkListItem("listItem").run();
    else if (editor.isActive("taskItem")) editor.chain().focus().sinkListItem("taskItem").run();
    else editor.chain().focus().indentParagraph().run();
  };
  const outdent = () => {
    if (editor.isActive("listItem")) editor.chain().focus().liftListItem("listItem").run();
    else if (editor.isActive("taskItem")) editor.chain().focus().liftListItem("taskItem").run();
    else editor.chain().focus().outdentParagraph().run();
  };

  const words = editor.storage.characterCount?.words?.() ?? 0;
  // The selection IS the task title, so Make task stays disabled until
  // there is one. Safe to read during render: the toolbar already
  // re-renders per transaction (every editor.isActive() call below relies
  // on that), so this tracks the caret live.
  const hasSelection = editor.state.selection.to > editor.state.selection.from;

  return (
    <div className={cn(
      "flex items-end gap-1 px-1.5 py-1",
      placement === "docked"
        // Docked under the editor: only a top rule. No fill of its own, so
        // there is nothing to square off the box's rounded corners.
        ? "border-t border-border-hairline"
        : placement === "flush"
          // Docked to a pane edge: the wrapper draws the rule, so this
          // adds no border or radius that could double up on it.
          ? ""
          // Standalone bar: its own rounded box.
          : "rounded-lg border border-border-hairline"
    )}>
      <div className="richtext-toolbar-row flex min-w-0 flex-1 flex-wrap items-center gap-0.5" data-testid="richtext-toolbar-row">
      {/* Undo/redo. Cmd+Z covers a keyboard; a phone has nothing else. */}
      <TBtn title="Undo" testid="richtext-undo" disabled={!editor.can().undo()} onAction={() => editor.chain().focus().undo().run()}>
        <Undo2 className="w-4 h-4" />
      </TBtn>
      <TBtn title="Redo" testid="richtext-redo" disabled={!editor.can().redo()} onAction={() => editor.chain().focus().redo().run()}>
        <Redo2 className="w-4 h-4" />
      </TBtn>

      <span className="w-px h-4 bg-[var(--border-hairline)] mx-1 shrink-0" />

      {/* Text style */}
      <Picker icon={Heading} title="Text style" testid="richtext-style" open={styleOpen} setOpen={setStyleOpen} onOpenChange={anyPickerOpen} openUp={placement !== "standalone"}>
        <div className="w-40">
          {TEXT_STYLES.map((t) => (
            <button
              key={t.key}
              type="button"
              data-testid={`richtext-style-${t.key}`}
              onMouseDown={(e) => { e.preventDefault(); pick(setStyleOpen, () => setTextStyle(t.key)); }}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded text-ink-700 dark:text-ink-200 hover:bg-selected",
                activeStyle === t.key && "bg-selected"
              )}
            >
              <span className={t.className}>{t.label}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-[var(--border-hairline)]" />
          <button
            type="button"
            data-testid="richtext-clear-formatting"
            onMouseDown={(e) => { e.preventDefault(); pick(setStyleOpen, clearFormatting); }}
            className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded text-ink-700 dark:text-ink-200 hover:bg-selected"
          >
            <RemoveFormatting className="w-3.5 h-3.5 text-ink-500 dark:text-ink-400" />
            Clear formatting
          </button>
        </div>
      </Picker>

      <span className="w-px h-4 bg-[var(--border-hairline)] mx-1 shrink-0" />

      <TBtn title="Bold" active={editor.isActive("bold")} onAction={() => apply(() => editor.chain().focus().toggleBold().run())}>
        <Bold className="w-4 h-4" />
      </TBtn>
      <TBtn title="Italic" active={editor.isActive("italic")} onAction={() => apply(() => editor.chain().focus().toggleItalic().run())}>
        <Italic className="w-4 h-4" />
      </TBtn>
      <TBtn title="Underline" active={editor.isActive("underline")} onAction={() => apply(() => editor.chain().focus().toggleUnderline().run())}>
        <UnderlineIcon className="w-4 h-4" />
      </TBtn>
      <TBtn title="Strikethrough" active={editor.isActive("strike")} onAction={() => apply(() => editor.chain().focus().toggleStrike().run())}>
        <Strikethrough className="w-4 h-4" />
      </TBtn>
      {/* Opens the link bar's editor at the selection (LinkBubble.jsx). */}
      <TBtn
        title={`Link (${isMacLike() ? "⌘" : "Ctrl"}K)`}
        testid="richtext-link"
        active={editor.isActive("link")}
        onAction={() => editor.commands.openLinkEditor()}
      >
        <Link2 className="w-4 h-4" />
      </TBtn>

      <span className="w-px h-4 bg-[var(--border-hairline)] mx-1 shrink-0" />

      {/* Text color */}
      <Picker icon={Baseline} title="Text color" open={colorOpen} setOpen={setColorOpen} onOpenChange={anyPickerOpen} openUp={placement !== "standalone"}>
        <div className="grid grid-cols-5 gap-1 w-[150px]">
          {TEXT_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.label}
              onMouseDown={(e) => { e.preventDefault(); pick(setColorOpen, () => editor.chain().focus().setColor(c.hex).run()); }}
              className="w-6 h-6 rounded-full border border-ink-200 dark:border-night-line-strong"
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); pick(setColorOpen, () => editor.chain().focus().unsetColor().run()); }}
          className="mt-1.5 w-full text-[11px] text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100 py-1 rounded hover:bg-selected"
        >
          Default color
        </button>
      </Picker>

      {/* Highlight */}
      <Picker icon={Highlighter} title="Highlight" open={hlOpen} setOpen={setHlOpen} onOpenChange={anyPickerOpen} openUp={placement !== "standalone"}>
        <div className="flex gap-1">
          {HIGHLIGHTS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.label}
              onMouseDown={(e) => { e.preventDefault(); pick(setHlOpen, () => editor.chain().focus().toggleHighlight({ color: c.hex }).run()); }}
              className="w-6 h-6 rounded border border-ink-200 dark:border-night-line-strong"
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); pick(setHlOpen, () => editor.chain().focus().unsetHighlight().run()); }}
          className="mt-1.5 w-full text-[11px] text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100 py-1 rounded hover:bg-selected"
        >
          No highlight
        </button>
      </Picker>

      {/* Font */}
      <Picker icon={Type} title="Font" open={fontOpen} setOpen={setFontOpen} onOpenChange={anyPickerOpen} openUp={placement !== "standalone"}>
        <div className="w-44 max-h-56 overflow-y-auto">
          {FONTS.map((f) => (
            <button
              key={f.label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(setFontOpen, () => {
                  if (f.stack) editor.chain().focus().setFontFamily(f.stack).run();
                  else editor.chain().focus().unsetFontFamily().run();
                });
              }}
              className="w-full text-left text-xs px-2 py-1.5 rounded text-ink-700 dark:text-ink-200 hover:bg-selected"
              style={{ fontFamily: f.stack || undefined }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Picker>

      <span className="w-px h-4 bg-[var(--border-hairline)] mx-1 shrink-0" />

      {/* Lists */}
      <Picker icon={ListIcon} title="Lists" open={listOpen} setOpen={setListOpen} onOpenChange={anyPickerOpen} openUp={placement !== "standalone"}>
        <div className="w-40">
          {LIST_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(setListOpen, () => setListType(o.key)); }}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded text-ink-700 dark:text-ink-200 hover:bg-selected"
            >
              <span className="w-5 text-center text-ink-500 dark:text-ink-400">{o.glyph}</span>
              {o.label}
            </button>
          ))}
        </div>
      </Picker>
      <TBtn title="Checklist" active={editor.isActive("taskList")} onAction={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks className="w-4 h-4" />
      </TBtn>

      <span className="w-px h-4 bg-[var(--border-hairline)] mx-1 shrink-0" />

      <TBtn title="Decrease indent" onAction={outdent}>
        <Outdent className="w-4 h-4" />
      </TBtn>
      <TBtn title="Increase indent" onAction={indent}>
        <Indent className="w-4 h-4" />
      </TBtn>

      {/* Make task — only mounted by hosts that support it (notes), and
          only usable with text selected, since the selection IS the task
          title. Same onMouseDown+preventDefault rule as every other
          control here, so it never blurs the editable on iOS. */}
      {onMakeTask && (
        <>
          <span className="w-px h-4 bg-[var(--border-hairline)] mx-1 shrink-0" />
          <TBtn
            title={hasSelection ? "Make task from selection" : "Select text to make a task"}
            disabled={!hasSelection}
            testid="richtext-make-task"
            onAction={() => {
              const { from, to } = editor.state.selection;
              const text = editor.state.doc.textBetween(from, to, " ").trim();
              if (text) onMakeTask(text, { from, to });
            }}
          >
            <ListPlus className="w-4 h-4" />
          </TBtn>
        </>
      )}

      </div>

      {/* Word counter — outside the row, so it stays put while the row scrolls. */}
      <span
        className={cn(
          "shrink-0 px-1 text-[11px] leading-7 tabular-nums",
          words >= wordLimit ? "text-red-500 dark:text-red-400 font-semibold" : "text-ink-400 dark:text-ink-500"
        )}
      >
        {words}/{wordLimit}
      </span>
    </div>
  );
}
