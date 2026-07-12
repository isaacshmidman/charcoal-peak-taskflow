// @ts-nocheck
/**
 * @file Note editor dialog. Reuses the task-description TipTap editor
 * (lazy chunk + load boundary) at a higher word cap, and autosaves on a
 * debounce instead of an explicit save button — notes should feel like
 * paper, not forms.
 *
 * Lifecycle: the parent creates the note record BEFORE opening (empty
 * notes are valid server-side), so this dialog only ever edits an
 * existing record. On close, a note that is still completely empty is
 * deleted quietly — no litter from opened-then-abandoned notes.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { NotebookPen, Pin, PinOff, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditorLoadBoundary } from "@/components/tasks/TaskForm/TitleAndDescription";
import { cn } from "@/lib/utils";

const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

const NOTE_WORD_LIMIT = 5000;
const AUTOSAVE_MS = 800;

export default function NoteEditor({ open, onOpenChange, note, onSave, onDelete, onMakeTask }) {
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState("idle"); // idle | waiting | saved
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Latest content the editor reported — saved on debounce + on close.
  const contentRef = useRef({ json: "", text: "" });
  const timerRef = useRef(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    if (!open) return;
    setTitle(note?.title || "");
    contentRef.current = { json: note?.content_json || "", text: note?.content_text || "" };
    setSaveState("idle");
    setConfirmDelete(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note?.id]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const flush = () => {
    const current = noteRef.current;
    if (!current) return;
    onSave(current.id, {
      title: title,
      content_json: contentRef.current.json,
      content_text: contentRef.current.text,
    });
    setSaveState("saved");
  };

  const scheduleSave = () => {
    setSaveState("waiting");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, AUTOSAVE_MS);
  };

  // title changes ride the same debounce as content changes.
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(() => {
    if (!open) return;
    if ((noteRef.current?.title || "") === title) return;
    scheduleSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, open]);

  const handleClose = (nextOpen) => {
    if (!nextOpen) {
      clearTimeout(timerRef.current);
      const isEmpty = !titleRef.current.trim() && !contentRef.current.text.trim();
      if (isEmpty) {
        onDelete(noteRef.current?.id, { silent: true });
      } else {
        flush();
      }
    }
    onOpenChange(nextOpen);
  };

  const handleMakeTask = () => {
    const selection = String(window.getSelection?.() || "").trim();
    onMakeTask(selection || titleRef.current.trim() || "");
  };

  if (!note) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <NotebookPen className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            {note.pinned ? "Pinned note" : "Note"}
            <span
              className={cn(
                "ml-auto text-[10px] font-normal transition-opacity duration-200",
                saveState === "saved" ? "text-slate-400 dark:text-slate-500 opacity-100" : "opacity-0"
              )}
            >
              Saved
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Untitled"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="note-title-input"
          />

          <EditorLoadBoundary
            fallback={
              <Textarea
                placeholder="Write anything"
                defaultValue={note.content_text || ""}
                onChange={(e) => {
                  contentRef.current = { json: "", text: e.target.value };
                  scheduleSave();
                }}
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
                key={note.id}
                valueJson={note.content_json}
                plainFallback={note.content_text}
                wordLimit={NOTE_WORD_LIMIT}
                onChange={({ json, text }) => {
                  contentRef.current = { json, text };
                  scheduleSave();
                }}
              />
            </Suspense>
          </EditorLoadBoundary>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-slate-500 dark:text-slate-400"
              onClick={() => onSave(note.id, { pinned: !note.pinned })}
            >
              {note.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              {note.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-slate-500 dark:text-slate-400"
              onClick={handleMakeTask}
              data-testid="note-make-task"
            >
              Make task
            </Button>
            {confirmDelete ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">Delete this note?</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => { clearTimeout(timerRef.current); onDelete(note.id); }}
                >
                  Delete
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-slate-400 hover:text-red-500 dark:hover:text-red-300"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
