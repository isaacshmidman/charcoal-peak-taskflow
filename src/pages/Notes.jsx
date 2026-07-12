// @ts-nocheck
/**
 * @file Notes — standalone rich-text notes, the app's second first-class
 * object. Grid of cards; open one to edit in the shared TipTap editor
 * (autosaving). "Make task" bridges a selection (or the title) into a
 * prefilled TaskForm.
 *
 * Data: ["notes"] query + useOfflineEntityMutation("Note") — offline
 * cache/queue/replay ride the entity registry, no bespoke code here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Pin, Plus, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { apiClient } from "@/api/apiClient";
import { useOfflineEntityMutation } from "@/hooks/useOfflineEntityMutation";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import NoteEditor from "@/components/notes/NoteEditor";
import TaskForm from "@/components/tasks/TaskForm";
import { cn } from "@/lib/utils";

export default function Notes() {
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [openNoteId, setOpenNoteId] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [taskDraft, setTaskDraft] = useState(null);
  const [showTaskForm, setShowTaskForm] = useState(false);

  const noteMutation = useOfflineEntityMutation("Note");
  const { createTask } = useOfflineMutation();

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: () => apiClient.entities.Note.list("-updated_date", 500),
  });

  const openNote = notes.find((n) => n.id === openNoteId) || null;

  const visibleNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? notes.filter(
          (n) =>
            (n.title || "").toLowerCase().includes(q) ||
            (n.content_text || "").toLowerCase().includes(q)
        )
      : notes;
    return [...matched].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return String(b.updated_date || "").localeCompare(String(a.updated_date || ""));
    });
  }, [notes, search]);

  const newNote = async () => {
    // Create first, edit after — empty notes are valid; an abandoned one
    // is deleted quietly when the editor closes still-empty.
    const created = await noteMutation.create({
      title: "",
      content_json: "",
      content_text: "",
      pinned: false,
    });
    setOpenNoteId(created.id);
    setShowEditor(true);
  };

  // Keyboard: n = new note here (same key, page-appropriate action),
  // / = search — both delivered by the global listener's event bus.
  useShortcutEvent(SHORTCUT_EVENTS.newTask, newNote);
  useShortcutEvent(SHORTCUT_EVENTS.search, () => setShowSearch(true));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Notes</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            {notes.length} note{notes.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AnimatedSearchInput
            open={showSearch}
            value={search}
            onChange={setSearch}
            onClose={() => setShowSearch(false)}
          />
          <Button
            variant="ghost"
            size="icon"
            data-search-toggle
            className="h-9 w-9 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            onMouseDown={(event) => { if (showSearch) event.preventDefault(); }}
            onClick={() => { if (showSearch) setSearch(""); setShowSearch((v) => !v); }}
          >
            <Search className="w-4 h-4" />
          </Button>
          <Button onClick={newNote} className="h-9" data-testid="new-note-button">
            <Plus className="w-4 h-4" />
            <span className="hidden xs:inline">New note</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Card key={i} className="h-28 animate-pulse" />)}
        </div>
      ) : visibleNotes.length === 0 ? (
        <div className="text-center py-14">
          <NotebookPen className="w-5 h-5 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {search ? "Nothing matches." : "A quiet page. Write anything."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleNotes.map((note) => (
            <Card
              key={note.id}
              role="button"
              tabIndex={0}
              data-testid={`note-card-${note.id}`}
              className="p-4 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => { setOpenNoteId(note.id); setShowEditor(true); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { setOpenNoteId(note.id); setShowEditor(true); }
              }}
            >
              <div className="flex items-start gap-2">
                <p className={cn(
                  "text-sm font-medium flex-1 min-w-0 truncate",
                  note.title ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"
                )}>
                  {note.title || "Untitled"}
                </p>
                {note.pinned && <Pin className="w-3 h-3 shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" />}
              </div>
              {note.content_text?.trim() && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-3 whitespace-pre-line">
                  {note.content_text}
                </p>
              )}
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
                {note.updated_date
                  ? formatDistanceToNow(new Date(note.updated_date), { addSuffix: true })
                  : ""}
              </p>
            </Card>
          ))}
        </div>
      )}

      <NoteEditor
        open={showEditor}
        onOpenChange={(open) => {
          setShowEditor(open);
          if (!open) setOpenNoteId(null);
        }}
        note={openNote}
        onSave={(id, data) => noteMutation.update(id, data)}
        onDelete={(id, { silent } = {}) => {
          noteMutation.remove(id);
          if (!silent) { setShowEditor(false); setOpenNoteId(null); }
        }}
        onMakeTask={(title) => {
          setTaskDraft({ title });
          setShowTaskForm(true);
        }}
      />

      <TaskForm
        open={showTaskForm}
        onOpenChange={(open) => {
          setShowTaskForm(open);
          if (!open) setTaskDraft(null);
        }}
        task={null}
        initialDraft={taskDraft}
        onSubmit={async (data, subtaskTitles = []) => {
          const created = await createTask(data);
          for (let index = 0; index < subtaskTitles.length; index += 1) {
            await createTask({
              title: subtaskTitles[index],
              status: "todo",
              task_type: "one_time",
              parent_id: created.id,
              order: index,
            });
          }
          return created;
        }}
      />
    </div>
  );
}
