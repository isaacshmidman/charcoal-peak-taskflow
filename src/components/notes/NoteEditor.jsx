// @ts-nocheck
/**
 * @file Note editor dialog — modeled on TaskForm's chrome. Explicit save
 * (Create Note / Save Changes / Cancel), not autosave: a note is created
 * only on submit, and must have a title OR content (never blank). Notes
 * share tags + priority with tasks. "Make task" converts the note into a
 * dated task and removes the note, with a "Task created" undo toast.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import { colorDot } from "@/lib/colors";
import { cn } from "@/lib/utils";

const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

const NOTE_WORD_LIMIT = 5000;

const emptyNote = { title: "", content_json: "", content_text: "", tags: [], priority_id: "", pinned: false };

export default function NoteEditor({ open, onOpenChange, note, priorities = [], savedTags = [], onSubmit, onDelete, onMakeTask }) {
  const [form, setForm] = useState(emptyNote);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(note ? { ...emptyNote, ...note, tags: note.tags || [] } : emptyNote);
    setSaved(false);
    setConfirmDelete(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note?.id]);

  const canSubmit = !!(form.title.trim() || form.content_text.trim());
  const editorKey = note?.id || "new";

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    onSubmit({
      title: form.title,
      content_json: form.content_json,
      content_text: form.content_text,
      tags: form.tags,
      priority_id: form.priority_id,
      pinned: form.pinned,
    });
    setSaved(true);
    setTimeout(() => onOpenChange(false), 650);
  };

  const handleMakeTask = () => {
    onMakeTask({
      title: form.title,
      description: form.content_text,
      description_json: form.content_json,
      tags: form.tags,
      priority_id: form.priority_id,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100 text-center">
            {note ? (note.pinned ? "Edit Pinned Note" : "Edit Note") : "New Note"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title parses #tag / !priority (dropdown) only — notes have no dates. */}
          <TitleTokenInput
            form={form}
            setForm={setForm}
            grammar={{ dates: false, times: false, recurrence: false, tags: true, priority: true }}
            priorities={priorities}
            savedTags={savedTags}
            placeholder="Title"
            testid="note-title-input"
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

          <div className="flex items-center gap-2 pt-1">
            {/* Make task — brand-yellow, black text (design system). */}
            <Button
              type="button"
              onClick={handleMakeTask}
              disabled={!canSubmit}
              data-testid="note-make-task"
              className="bg-[var(--brand-yellow)] hover:bg-[var(--brand-yellow)]/90 text-[var(--brand-ink)] h-9"
            >
              Make task
            </Button>
            {note && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-slate-400 dark:text-slate-500"
                onClick={() => setForm((f) => ({ ...f, pinned: !f.pinned }))}
                aria-label={form.pinned ? "Unpin note" : "Pin note"}
              >
                {form.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </Button>
            )}
          </div>

          {/* Footer: delete left, save/cancel right — TaskForm layout. */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {note && onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116]"
                  data-testid="note-form-delete"
                  onClick={() => { onDelete(note); onOpenChange(false); }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {saved && <span className="text-[11px] text-slate-400 dark:text-slate-500" data-testid="note-form-saved">Saved</span>}
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={!canSubmit}
                data-testid="note-form-submit"
                className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {note ? "Save Changes" : "Create Note"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
