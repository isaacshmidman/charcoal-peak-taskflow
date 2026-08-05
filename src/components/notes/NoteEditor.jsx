// @ts-nocheck
/**
 * @file Note editor dialog — modeled on TaskForm's chrome, AUTOSAVING.
 * A note is created automatically the moment it's valid (title OR
 * content) and every edit persists on a short debounce — no explicit
 * "save" and no "Saved" flash. The bottom button is a Done affordance:
 * greyed while the note is still blank, otherwise it just flushes any
 * pending write and closes. Notes share tags + priority with tasks.
 * "Make task" converts the note into a dated task and removes it (undo).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pin, PinOff, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditorLoadBoundary } from "@/components/tasks/TaskForm/TitleAndDescription";
import TitleTokenInput from "@/components/tasks/QuickAdd/TitleTokenInput";
import TagsField from "@/components/tasks/TaskForm/TagsField";
import { useAutosave } from "@/hooks/useAutosave";
import { colorDot } from "@/lib/colors";
import { cn } from "@/lib/utils";

const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

const NOTE_WORD_LIMIT = 5000;

const emptyNote = { title: "", content_json: "", content_text: "", tags: [], priority_id: "", pinned: false };

export default function NoteEditor({ open, onOpenChange, note, priorities = [], savedTags = [], onSave, onDelete, onMakeTask }) {
  const [form, setForm] = useState(emptyNote);
  // The persisted note's id. Null until the first autosave creates it, so
  // the "New Note" heading/button never flip mid-session. Mirrored into
  // state (savedId) because a ref write alone doesn't re-render — without
  // it the Delete/Pin buttons never appear on a freshly-autosaved note.
  const idRef = useRef(note?.id || null);
  const [savedId, setSavedId] = useState(note?.id || null);
  // Frozen at open: whether this opened on an existing note. Drives the
  // heading + button label so neither flips to "New Note"/"Create Note"
  // during the close animation (when the parent nulls `note`).
  const [isEditMode, setIsEditMode] = useState(!!note);

  const editorKey = note?.id || "new";
  const isValid = !!(form.title.trim() || form.content_text.trim());

  const payload = useMemo(() => ({
    title: form.title,
    content_json: form.content_json,
    content_text: form.content_text,
    tags: form.tags,
    priority_id: form.priority_id,
    pinned: form.pinned,
  }), [form]);

  // Upsert: create on the first valid write (tracking the returned id),
  // then update. onSave(id, data) → the saved record.
  const saveNote = useCallback(async (data) => {
    const rec = await onSave(idRef.current, data);
    if (rec?.id) { idRef.current = rec.id; setSavedId(rec.id); }
    return rec;
  }, [onSave]);

  const { flush, reset } = useAutosave({ payload, valid: isValid, onSave: saveNote });

  useEffect(() => {
    if (!open) return;
    const initial = note ? { ...emptyNote, ...note, tags: note.tags || [] } : emptyNote;
    setForm(initial);
    idRef.current = note?.id || null;
    setSavedId(note?.id || null);
    setIsEditMode(!!note);
    reset({
      title: initial.title, content_json: initial.content_json, content_text: initial.content_text,
      tags: initial.tags, priority_id: initial.priority_id, pinned: initial.pinned,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note?.id]);

  // Delete works for an existing note OR a brand-new one that has already
  // autosaved (idRef set while the `note` prop is still null).
  const currentNote = note || (savedId ? { ...form, id: savedId } : null);

  const handleClose = () => { flush(); onOpenChange(false); };

  const handleMakeTask = () => {
    flush(); // make sure a valid note exists so it can be removed
    onMakeTask(
      {
        title: form.title,
        description: form.content_text,
        description_json: form.content_json,
        tags: form.tags,
        priority_id: form.priority_id,
      },
      idRef.current
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) flush(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100 text-center">
            {isEditMode ? (form.pinned ? "Edit Pinned Note" : "Edit Note") : "New Note"}
          </DialogTitle>
        </DialogHeader>

        {/* Pin lives in the top-right corner (icon only). */}
        {currentNote && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 h-8 w-8 text-slate-400 dark:text-slate-500"
            onClick={() => setForm((f) => ({ ...f, pinned: !f.pinned }))}
            aria-label={form.pinned ? "Unpin note" : "Pin note"}
          >
            {form.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </Button>
        )}

        <form
          onSubmit={(e) => e.preventDefault()}
          // Mod+Enter finishes from anywhere in the form — including inside
          // the rich-text body, where a plain Enter is a paragraph break.
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && isValid) {
              e.preventDefault();
              handleClose();
            }
          }}
          className="space-y-4"
        >
          {/* Title parses #tag / !priority (dropdown) only — notes have no dates. */}
          <TitleTokenInput
            form={form}
            setForm={setForm}
            grammar={{ dates: false, times: false, recurrence: false, tags: true, priority: true }}
            priorities={priorities}
            savedTags={savedTags}
            placeholder="Title"
            testid="note-title-input"
            // Enter in the title is "done" — the note is already autosaved,
            // so this flushes and closes exactly like the bottom button.
            onEnter={() => { if (isValid) handleClose(); }}
          />

          <EditorLoadBoundary
            fallback={
              <Textarea
                placeholder="Write anything"
                defaultValue={form.content_text || ""}
                onChange={(e) => setForm((f) => ({ ...f, content_json: "", content_text: e.target.value }))}
                className="min-h-[10rem] resize-none"
              />
            }
          >
            <Suspense
              fallback={
                <div className="min-h-[10rem] rounded-md border border-slate-200 dark:border-[#343434] bg-white dark:bg-[#0c0c0c] px-3 py-2 text-sm text-slate-400 dark:text-slate-500">
                  Loading editor…
                </div>
              }
            >
              <RichDescriptionEditor
                key={editorKey}
                valueJson={note?.content_json}
                plainFallback={note?.content_text}
                wordLimit={NOTE_WORD_LIMIT}
                onChange={({ json, text }) => setForm((f) => ({ ...f, content_json: json, content_text: text }))}
              />
            </Suspense>
          </EditorLoadBoundary>

          {/* Priority spans the full width (unlike TaskForm's 2-up row). */}
          <div>
            <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Priority</Label>
            <Select value={form.priority_id} onValueChange={(v) => setForm((f) => ({ ...f, priority_id: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {priorities.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", colorDot[p.color] || colorDot.slate)} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TagsField form={form} setForm={setForm} savedTags={savedTags} />

          {/* Make task — full-width, brand-yellow, black text (design system). */}
          <Button
            type="button"
            onClick={handleMakeTask}
            disabled={!isValid}
            data-testid="note-make-task"
            className="w-full bg-[var(--brand-yellow)] hover:bg-[var(--brand-yellow)]/90 text-[var(--brand-ink)] h-9"
          >
            Make task
          </Button>

          {/* Footer: delete left, Done right. The note autosaves; the
              button just greys until it's non-blank, then flushes + closes. */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {currentNote && onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116]"
                  data-testid="note-form-delete"
                  onClick={() => { onDelete(currentNote); onOpenChange(false); }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            <Button
              type="button"
              disabled={!isValid}
              data-testid="note-form-submit"
              onClick={handleClose}
              className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {isEditMode ? "Save Changes" : "Create Note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
