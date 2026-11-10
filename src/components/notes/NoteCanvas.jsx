// @ts-nocheck
/**
 * @file Right pane of /Notes — the note itself and nothing else: a
 * slim strip of controls, then the title and the body as one page that
 * scrolls together, then the formatting bar.
 *
 * Mounted with key={note.id} by the page, so switching notes gives a
 * fresh editor and a fresh autosave baseline. It is deliberately NOT
 * remounted while the task dialog is open — that is what lets the page
 * put the caret and scroll position back exactly where they were.
 *
 * Notes autosave, including while blank: pressing New note creates the
 * note immediately and an empty note is kept, the opposite of the task
 * forms, where nothing is written until the button.
 *
 * The Schedule switch in the header turns the note into a schedule
 * builder (schedule/ScheduleBuilder.jsx): the day in slots, in place of
 * the text. Switching it off shows the text again, untouched, and keeps
 * the schedule for next time.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { ArrowLeft, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EditorLoadBoundary } from "@/components/tasks/TaskForm/TitleAndDescription";
import Toolbar from "@/components/tasks/richtext/Toolbar";
import { useAutosave } from "@/hooks/useAutosave";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import SettingsToggle from "@/components/settings/SettingsToggle";
import { parseSchedule, scheduleFromDefaults } from "@/lib/schedule";
import ScheduleBuilder from "./schedule/ScheduleBuilder";
import ScheduleSettings from "./schedule/ScheduleSettings";
import AddToCalendar from "./schedule/AddToCalendar";
import { useScheduleEditor } from "./schedule/useScheduleEditor";
import { useScheduleDefaults } from "./schedule/useScheduleDefaults";

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
  onDelete,
}) {
  // The formatting bar is this pane's, along its bottom edge — so the
  // editor hands its focus state up instead of docking a bar of its own.
  const [editor, setEditor] = useState(null);
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // On a phone the keyboard covers the bottom of the pane, taking the
  // toolbar with it. Shrink the section by the covered strip (plus a
  // little breathing room) so the bar sits just above the keys.
  const keyboardInset = useKeyboardInset();

  const [form, setForm] = useState({
    title: note.title || "",
    content_json: note.content_json || "",
    content_text: note.content_text || "",
    schedule_json: note.schedule_json || "",
  });

  const payload = useMemo(
    () => ({ title: form.title, content_json: form.content_json, content_text: form.content_text, schedule_json: form.schedule_json }),
    [form]
  );

  const schedule = useMemo(() => parseSchedule(form.schedule_json), [form.schedule_json]);
  const scheduleOn = !!schedule?.enabled;
  const scheduleEditor = useScheduleEditor(schedule, (next) => setForm((f) => ({ ...f, schedule_json: JSON.stringify(next) })));
  const { defaults: scheduleDefaults, save: saveScheduleDefaults } = useScheduleDefaults();
  // Off keeps the schedule (and on brings it back); the first time on lays
  // out the day from the pinned settings — the whole day in hours if none.
  const setScheduleOn = (on) => {
    // The text editor unmounts while the schedule shows; the bar must not
    // hold on to it (a new one arrives through onEditorReady).
    if (on) setEditor(null);
    setForm((f) => {
      const existing = parseSchedule(f.schedule_json);
      if (!existing && !on) return f;
      return { ...f, schedule_json: JSON.stringify(existing ? { ...existing, enabled: on } : scheduleFromDefaults(scheduleDefaults)) };
    });
  };

  const saveNote = useCallback((data) => onSave(note.id, data), [onSave, note.id]);

  // valid: true unconditionally — a blank note is a legitimate state and
  // must persist as one.
  const { flush, reset } = useAutosave({ payload, valid: true, onSave: saveNote });

  useEffect(() => {
    reset({
      title: note.title || "",
      content_json: note.content_json || "",
      content_text: note.content_text || "",
      schedule_json: note.schedule_json || "",
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Commit anything still debounced when the note unmounts (switching
  // notes, leaving the page) so no keystroke is lost.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { flushRef.current?.(); }, []);

  // The title wraps: it grows a line at a time instead of running off the
  // edge of the pane, which is what a one-line field did to a long one.
  const titleRef = useRef(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [form.title, scheduleOn]);

  // A brand-new note opens with the caret in its title, ready to be named.
  // Only when it is truly blank: an older note isn't re-focused every time
  // it's opened, which on a phone would throw the keyboard up.
  useEffect(() => {
    if (!note.title && !note.content_text && !note.schedule_json) titleRef.current?.focus({ preventScroll: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const edited = note.updated_date ? formatDistanceToNow(new Date(note.updated_date), { addSuffix: true }) : "";

  return (
    <section
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      style={keyboardInset ? { paddingBottom: keyboardInset + 12 } : undefined}
    >
      {/* A slim strip for what the note is and can do — when it was last
          changed, and the schedule controls — kept off the title's line so
          the title has the full width to itself. */}
      <div className="flex h-11 shrink-0 items-center gap-1 pl-3 pr-3 sm:pl-5 sm:pr-4">
        {/* Back to the list — only reachable below sm, where the two
            panes swap instead of sitting side by side. */}
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Back to notes"
            data-testid="note-back"
            className="-ml-1.5 h-8 w-8 shrink-0 text-ink-500 dark:text-ink-400 sm:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <p className="min-w-0 flex-1 truncate text-xs text-ink-400 dark:text-ink-500">
          {edited ? `Edited ${edited}` : ""}
        </p>
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Delete note"
            title="Delete note"
            data-testid="note-delete"
            className="h-8 w-8 shrink-0 text-ink-400 hover:bg-red-50 hover:text-red-600 dark:text-ink-500 dark:hover:bg-night-danger dark:hover:text-red-400"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {scheduleOn && <AddToCalendar schedule={schedule} />}
        {scheduleOn && (
          <ScheduleSettings schedule={schedule} editor={scheduleEditor} defaults={scheduleDefaults} saveDefaults={saveScheduleDefaults} />
        )}
        <label className="flex shrink-0 cursor-pointer items-center gap-2 pl-1 text-xs font-medium text-ink-500 dark:text-ink-400">
          Schedule
          <SettingsToggle checked={scheduleOn} onChange={setScheduleOn} label="Schedule builder" />
        </label>
      </div>

      {/* The note: title and body in one column that scrolls together, like
          a page. The column keeps a readable width however wide the pane. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="note-scroll">
        <div className="mx-auto w-full max-w-3xl px-5 pb-10 pt-3 sm:px-8 sm:pt-5">
          <textarea
            ref={titleRef}
            rows={1}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value.replace(/\n/g, " ") }))}
            placeholder="Title"
            aria-label="Note title"
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
            className="block w-full resize-none overflow-hidden bg-transparent text-[1.625rem] font-semibold leading-tight tracking-tight text-ink-900 outline-none placeholder:text-ink-300 dark:text-ink-100 dark:placeholder:text-ink-600 sm:text-[1.75rem]"
          />

          <div className="mt-3">
            {scheduleOn ? (
              <ScheduleBuilder schedule={schedule} editor={scheduleEditor} noteHasText={!!form.content_text.trim()} />
            ) : (
              <EditorLoadBoundary
                fallback={
                  <Textarea
                    placeholder="Write anything"
                    defaultValue={form.content_text || ""}
                    onChange={(e) => setForm((f) => ({ ...f, content_json: "", content_text: e.target.value }))}
                    className="min-h-[50vh] resize-none border-0 px-0 focus-visible:ring-0"
                  />
                }
              >
                <Suspense fallback={<div className="py-1 text-sm text-ink-400 dark:text-ink-500">Loading editor…</div>}>
                  <RichDescriptionEditor
                    // Read once, when it mounts — which is again after the
                    // schedule is switched off, so it starts from the latest text.
                    valueJson={form.content_json}
                    plainFallback={form.content_text}
                    wordLimit={NOTE_WORD_LIMIT}
                    chromeless
                    minHeight="50vh"
                    placeholder="Write anything"
                    toolbar="external"
                    onFocusChange={setFocused}
                    taskStatusById={taskStatusById}
                    onOpenTask={onOpenTask}
                    onEditorReady={(ed) => { setEditor(ed); onEditorReady?.(ed); }}
                    onChange={({ json, text }) => setForm((f) => ({ ...f, content_json: json, content_text: text }))}
                  />
                </Suspense>
              </EditorLoadBoundary>
            )}
          </div>
        </div>
      </div>

      {/* The formatting bar, along the bottom of the pane. It is there
          whenever the note's text is, at full strength while you're
          writing and quieter when you're not — not appearing and
          disappearing, which left an empty band where it had been. */}
      {editor && !editor.isDestroyed && !scheduleOn && (
        <div
          data-richtext-toolbar
          className={cn(
            "shrink-0 border-t border-border-hairline transition-opacity",
            focused || pickerOpen ? "opacity-100" : "opacity-60 hover:opacity-100"
          )}
        >
          <Toolbar
            editor={editor}
            placement="flush"
            onPickerOpenChange={setPickerOpen}
            wordLimit={NOTE_WORD_LIMIT}
            onMakeTask={onMakeTask}
          />
        </div>
      )}
    </section>
  );
}
