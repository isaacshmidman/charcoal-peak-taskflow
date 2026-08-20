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
import { ArrowLeft, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EditorLoadBoundary } from "@/components/tasks/TaskForm/TitleAndDescription";
import Toolbar from "@/components/tasks/richtext/Toolbar";
import { useAutosave } from "@/hooks/useAutosave";

const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

const NOTE_WORD_LIMIT = 5000;

export default function NoteCanvas({
  note,
  onSave,
  onDelete,
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
    <section className={cn("h-full min-h-0 flex-1 flex-col", className)}>
      {/* Formatting bar, pinned above the title. The row is ALWAYS
          mounted at a fixed height and only its contents fade in, so
          focusing the note can't shove the title and body down a line. */}
      <div className="h-9 shrink-0 px-2 pt-1">
        {/* No overflow-hidden here: the toolbar's colour/font pickers are
            absolutely positioned inside it and clipping would swallow them.
            The Toolbar draws its own rounded, bordered box instead. */}
        <div
          data-richtext-toolbar
          className={cn("transition-opacity", showToolbar ? "opacity-100" : "pointer-events-none opacity-0")}
        >
          {editor && (
            <Toolbar
              editor={editor}
              placement="standalone"
              onPickerOpenChange={setPickerOpen}
              wordLimit={NOTE_WORD_LIMIT}
              onMakeTask={onMakeTask}
            />
          )}
        </div>
      </div>

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
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-slate-900 outline-none placeholder:text-slate-300 dark:text-slate-100 dark:placeholder:text-slate-600"
        />
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete note"
            title="Delete note"
            data-testid="note-delete"
            className="h-8 w-8 shrink-0 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-600 dark:hover:bg-[#2a1116] dark:hover:text-red-300"
            onClick={() => onDelete(note)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1 pb-4" data-testid="note-scroll">
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
    </section>
  );
}
