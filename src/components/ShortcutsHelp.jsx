// @ts-nocheck
/**
 * @file Keyboard-shortcuts cheat-sheet, opened with `?` (Shift+/).
 * Pure presentation — the bindings live in useGlobalShortcuts /
 * lib/shortcuts.js; keep this list in sync when adding bindings.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isMacLike } from "@/lib/shortcuts";

function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.4rem] h-6 px-1.5 rounded border border-slate-200 dark:border-[#343434] bg-slate-50 dark:bg-[#161616] text-[11px] font-semibold text-slate-700 dark:text-slate-200 shadow-sm">
      {children}
    </kbd>
  );
}

function Row({ keys, label }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
      <span className="flex items-center gap-1 shrink-0">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[10px] text-slate-400 dark:text-slate-500">then</span>}
            <Kbd>{k}</Kbd>
          </span>
        ))}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
        {title}
      </h3>
      <div className="divide-y divide-slate-50 dark:divide-[#1d1d1d]">{children}</div>
    </div>
  );
}

export default function ShortcutsHelp({ open, onOpenChange }) {
  const mod = isMacLike() ? "⌘" : "Ctrl";
  const alt = isMacLike() ? "⌥" : "Alt";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Section title="Navigation">
            <Row keys={["1"]} label="Jump to nav items (in your sidebar order, 1–6)" />
            <Row keys={["g", "t"]} label="Go to Today" />
            <Row keys={["g", "a"]} label="Go to All Tasks" />
            <Row keys={["g", "g"]} label="Go to Groupings" />
            <Row keys={["g", "c"]} label="Go to Calendar" />
            <Row keys={["g", "d"]} label="Go to Completed" />
            <Row keys={["g", "n"]} label="Go to Notes" />
            <Row keys={["g", "s"]} label="Go to Settings" />
          </Section>

          <Section title="Actions">
            <Row keys={["n"]} label="New task (new note on the Notes page)" />
            <Row keys={[mod, "K"]} label="Command palette — actions, navigation, task search" />
            <Row keys={["v"]} label="Move overdue tasks to today (on Today)" />
            <Row keys={["/"]} label="Search the current page" />
            <Row keys={["z"]} label="Undo a just-deleted task (while the toast shows)" />
            <Row keys={["Esc"]} label="Close dialog / search" />
            <Row keys={["?"]} label="Show this cheat-sheet" />
          </Section>

          <Section title="Task form">
            <Row keys={["↵"]} label="Finish (in the title)" />
            <Row keys={[`${mod} ↵`]} label="Save the task" />
          </Section>

          {/* Every binding here is live in the shared editor (richtext/
              extensions.js), so it holds for descriptions and notes alike. */}
          <Section title="Writing — descriptions and notes">
            <Row keys={[`${mod} Z`]} label="Undo" />
            <Row keys={[`${mod} ⇧ Z`]} label="Redo" />
            <Row keys={[`${mod} B`]} label="Bold" />
            <Row keys={[`${mod} I`]} label="Italic" />
            <Row keys={[`${mod} U`]} label="Underline" />
            <Row keys={[`${mod} ⇧ S`]} label="Strikethrough" />
            <Row keys={[`${mod} ⇧ H`]} label="Highlight" />
            <Row keys={[`${mod} E`]} label="Inline code" />
            <Row keys={[`${mod} ${alt} 1`]} label="Heading (2 and 3 for smaller)" />
            <Row keys={[`${mod} ⇧ B`]} label="Quote" />
            <Row keys={[`${mod} ${alt} C`]} label="Code block" />
            <Row keys={[`${mod} ⇧ 8`]} label="Bullet list" />
            <Row keys={[`${mod} ⇧ 7`]} label="Numbered list" />
            <Row keys={[`${mod} ⇧ 9`]} label="Checklist" />
            <Row keys={["Tab"]} label="Indent (⇧ Tab to outdent)" />
            <Row keys={["⇧ ↵"]} label="Line break in the same paragraph" />
            <p className="pt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Markdown works as you type or paste:{" "}
              <code className="font-mono">#</code> heading, <code className="font-mono">-</code> bullets,{" "}
              <code className="font-mono">1.</code> numbers, <code className="font-mono">&gt;</code> quote,{" "}
              <code className="font-mono">```</code> code, <code className="font-mono">**bold**</code>,{" "}
              <code className="font-mono">*italic*</code>, <code className="font-mono">==highlight==</code>.
            </p>
          </Section>

          <Section title="Calendar">
            <Row keys={["d"]} label="Day view" />
            <Row keys={["w"]} label="Week view" />
            <Row keys={["m"]} label="Month view" />
            <Row keys={["y"]} label="Year view" />
            <Row keys={["t"]} label="Jump to today" />
            <Row keys={["←"]} label="Previous period" />
            <Row keys={["→"]} label="Next period" />
            <Row keys={["r"]} label="Sync calendars now" />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
