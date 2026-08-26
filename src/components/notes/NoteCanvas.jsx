// @ts-nocheck
/**
 * @file Right pane of /Notes — the note itself and nothing else. A
 * borderless title over a full-height rich-text body.
 *
 * Mounted with key={note.id} by the page, so switching notes gives a
 * fresh editor and a fresh autosave baseline. It is deliberately NOT
 * remounted while the task dialog is open — that is what lets the page
 * put the caret and scroll position back exactly where they were.
 *
 * Notes autosave, including while blank: pressing New note creates the
 * note immediately and an empty note is kept, the opposite of the task
 * forms, where nothing is written until the button.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EditorLoadBoundary } from "@/components/tasks/TaskForm/TitleAndDescription";
import Toolbar from "@/components/tasks/richtext/Toolbar";
import { useAutosave } from "@/hooks/useAutosave";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

const NOTE_WORD_LIMIT = 5000;

export default function NoteCanvas({
  note,
  onSave,
  taskStatusById,
  onMakeTask,
  onOpenTask,
  onEditorReady,
  scrollRef,
  className,
  onBack,
}) {
  // The formatting bar lives ABOVE the title here, the way Apple Notes
  // puts it at the top of the note — so the editor hands its focus state
  // up instead of docking its own toolbar at the bottom.
  const [editor, setEditor] = useState(null);
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const showToolbar = !!editor && (focused || pickerOpen);
  // On a phone the keyboard covers the bottom of the pane, taking the
  // toolbar with it. Shrink the section by the covered strip (plus a
  // little breathing room) so the bar sits just above the keys.
  const keyboardInset = useKeyboardInset();

  const [form, setForm] = useState({
    title: note.title || "",
    content_json: note.content_json || "",
    content_text: note.content_text || "",
  });

  const payload = useMemo(
    () => ({ title: form.title, content_json: form.content_json, content_text: form.content_text }),
    [form]
  );

  const saveNote = useCallback((data) => onSave(note.id, data), [onSave, note.id]);

  // valid: true unconditionally — a blank note is a legitimate state and
  // must persist as one.
  const { flush, reset } = useAutosave({ payload, valid: true, onSave: saveNote });

  useEffect(() => {
    reset({
      title: note.title || "",
      content_json: note.content_json || "",
      content_text: note.content_text || "",
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Commit anything still debounced when the note unmounts (switching
  // notes, leaving the page) so no keystroke is lost.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { flushRef.current?.(); }, []);

  return (
    <section
      className={cn("h-full min-h-0 flex-1 flex-col", className)}
      style={keyboardInset ? { paddingBottom: keyboardInset + 12 } : undefined}
    >
      <div className="flex items-start gap-2 px-4 pt-1">
        {/* Back to the list — only reachable below sm, where the two
            panes swap instead of sitting side by side. */}
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Back to notes"
            data-testid="note-back"
            className="-ml-2 h-8 w-8 shrink-0 text-slate-400 dark:text-slate-500 sm:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Title"
          data-testid="note-title-input"
          // Enter drops into the body, so the title reads as the note's
          // first line and the next line is ordinary paragraph text.
          // Focus the contenteditable directly rather than going through
          // editor.chain().focus() — the command is a no-op from here,
          // while the DOM call reliably moves the caret.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            scrollRef.current?.querySelector(".tiptap-prose")?.focus();
            editor?.commands.setTextSelection(0);
          }}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-slate-900 outline-none placeholder:text-slate-300 dark:text-slate-100 dark:placeholder:text-slate-600"
        />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1" data-testid="note-scroll">
        <EditorLoadBoundary
          fallback={
            <Textarea
              placeholder="Write anything"
              defaultValue={form.content_text || ""}
              onChange={(e) => setForm((f) => ({ ...f, content_json: "", content_text: e.target.value }))}
              className="min-h-[60vh] resize-none border-0 focus-visible:ring-0"
            />
          }
        >
          <Suspense
            fallback={
              <div className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">Loading editor…</div>
            }
          >
            <RichDescriptionEditor
              valueJson={note.content_json}
              plainFallback={note.content_text}
              wordLimit={NOTE_WORD_LIMIT}
              chromeless
              minHeight="60vh"
              toolbar="external"
              onFocusChange={setFocused}
              taskStatusById={taskStatusById}
              onOpenTask={onOpenTask}
              onEditorReady={(ed) => { setEditor(ed); onEditorReady?.(ed); }}
              onChange={({ json, text }) => setForm((f) => ({ ...f, content_json: json, content_text: text }))}
            />
          </Suspense>
        </EditorLoadBoundary>
      </div>

      {/* Formatting bar docked at the bottom, spanning the pane's full
          width and flush with its bottom edge — the same way it comes
          straight out of the bottom of a description box. Always
          mounted so showing it can't shift the body; only the contents
          fade. */}
      <div
        data-richtext-toolbar
        className={cn(
          "shrink-0 border-t border-border-hairline bg-slate-50 transition-opacity dark:bg-[#0c0c0c]",
          showToolbar ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        {editor && (
          <Toolbar
            editor={editor}
            placement="flush"
            onPickerOpenChange={setPickerOpen}
            wordLimit={NOTE_WORD_LIMIT}
            onMakeTask={onMakeTask}
          />
        )}
      </div>
    </section>
  );
}
