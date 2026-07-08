// @ts-nocheck
/**
 * @file Docked formatting toolbar for RichDescriptionEditor. Receives
 * the TipTap `editor` instance. Lives inside the Radix Dialog subtree
 * (no portal) and is shown/hidden by the parent based on editor focus.
 *
 * iOS hardening: every control fires on `onMouseDown` with
 * `preventDefault()` so tapping a button never blurs the editable
 * (keeps the selection + keyboard up). The dropdown pickers
 * (color/highlight/font/list) DO take focus when opened — the parent
 * keeps the toolbar visible while `onPickerOpenChange(true)` is active.
 */
import { useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Baseline,
  Highlighter,
  Type,
  ListChecks,
  List as ListIcon,
  Indent,
  Outdent,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOutsideClick } from "@/hooks/useOutsideClick";

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
const HIGHLIGHTS = [
  { label: "Yellow", hex: "#fef08a" },
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
function TBtn({ active, disabled, onAction, title, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onAction(); }}
      onTouchEnd={(e) => { e.preventDefault(); if (!disabled) onAction(); }}
      className={cn(
        "inline-flex items-center justify-center h-7 min-w-7 px-1 rounded-md transition-colors shrink-0",
        active
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#222222]",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

/** A dropdown popover anchored under its trigger. Reuses useOutsideClick. */
function Picker({ icon: Icon, title, open, setOpen, onOpenChange, children }) {
  const ref = useRef(null);
  useOutsideClick(ref, () => { setOpen(false); onOpenChange?.(false); }, open);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        title={title}
        aria-label={title}
        onMouseDown={(e) => {
          e.preventDefault();
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        className="inline-flex items-center gap-0.5 h-7 px-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#222222] transition-colors"
      >
        <Icon className="w-4 h-4" />
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg border border-border-strong bg-surface-card shadow-lg p-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

export default function Toolbar({ editor, onPickerOpenChange }) {
  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  if (!editor) return null;

  const apply = (fn) => { fn(); };

  // Whichever picker is open keeps the toolbar alive (parent reads this).
  const anyPickerOpen = (next) => onPickerOpenChange?.(next);

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

  return (
    <div className="flex items-center gap-0.5 flex-wrap px-1.5 py-1 border-t border-slate-100 dark:border-[#303030] bg-slate-50 dark:bg-[#0c0c0c]">
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

      <span className="w-px h-5 bg-slate-200 dark:bg-[#303030] mx-0.5 shrink-0" />

      {/* Text color */}
      <Picker icon={Baseline} title="Text color" open={colorOpen} setOpen={setColorOpen} onOpenChange={anyPickerOpen}>
        <div className="grid grid-cols-5 gap-1 w-[150px]">
          {TEXT_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.label}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c.hex).run(); }}
              className="w-6 h-6 rounded-full border border-slate-200 dark:border-[#343434]"
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); }}
          className="mt-1.5 w-full text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 py-1 rounded hover:bg-slate-100 dark:hover:bg-[#222222]"
        >
          Default color
        </button>
      </Picker>

      {/* Highlight */}
      <Picker icon={Highlighter} title="Highlight" open={hlOpen} setOpen={setHlOpen} onOpenChange={anyPickerOpen}>
        <div className="flex gap-1">
          {HIGHLIGHTS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.label}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: c.hex }).run(); }}
              className="w-6 h-6 rounded border border-slate-200 dark:border-[#343434]"
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetHighlight().run(); }}
          className="mt-1.5 w-full text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 py-1 rounded hover:bg-slate-100 dark:hover:bg-[#222222]"
        >
          No highlight
        </button>
      </Picker>

      {/* Font */}
      <Picker icon={Type} title="Font" open={fontOpen} setOpen={setFontOpen} onOpenChange={anyPickerOpen}>
        <div className="w-44 max-h-56 overflow-y-auto">
          {FONTS.map((f) => (
            <button
              key={f.label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (f.stack) editor.chain().focus().setFontFamily(f.stack).run();
                else editor.chain().focus().unsetFontFamily().run();
              }}
              className="w-full text-left text-xs px-2 py-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#222222]"
              style={{ fontFamily: f.stack || undefined }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Picker>

      <span className="w-px h-5 bg-slate-200 dark:bg-[#303030] mx-0.5 shrink-0" />

      {/* Lists */}
      <Picker icon={ListIcon} title="Lists" open={listOpen} setOpen={setListOpen} onOpenChange={anyPickerOpen}>
        <div className="w-40">
          {LIST_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setListType(o.key); }}
              className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#222222]"
            >
              <span className="w-5 text-center text-slate-500 dark:text-slate-400">{o.glyph}</span>
              {o.label}
            </button>
          ))}
        </div>
      </Picker>
      <TBtn title="Checklist" active={editor.isActive("taskList")} onAction={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks className="w-4 h-4" />
      </TBtn>

      <span className="w-px h-5 bg-slate-200 dark:bg-[#303030] mx-0.5 shrink-0" />

      <TBtn title="Decrease indent" onAction={outdent}>
        <Outdent className="w-4 h-4" />
      </TBtn>
      <TBtn title="Increase indent" onAction={indent}>
        <Indent className="w-4 h-4" />
      </TBtn>

      {/* Word counter */}
      <span
        className={cn(
          "ml-auto text-[10px] tabular-nums px-1.5 shrink-0",
          words >= 500 ? "text-red-500 dark:text-red-400 font-semibold" : "text-slate-400 dark:text-slate-500"
        )}
      >
        {words}/500
      </span>
    </div>
  );
}
