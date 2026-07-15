// @ts-nocheck
/**
 * @file Notes — standalone rich-text notes, the app's second first-class
 * object. Grid of cards; open one to edit in the TaskForm-style NoteEditor
 * (explicit save). Notes share tags + priority with tasks. "Make task"
 * converts a note to a dated task and removes the note (with undo).
 *
 * Data: ["notes"] query + useOfflineEntityMutation("Note") — offline
 * cache/queue/replay ride the entity registry, no bespoke code here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Pin, Plus, Search } from "lucide-react";
import { format } from "date-fns/format";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { apiClient } from "@/api/apiClient";
import { useOfflineEntityMutation } from "@/hooks/useOfflineEntityMutation";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import NoteEditor from "@/components/notes/NoteEditor";
import NotePreview from "@/components/notes/NotePreview";
import { cn } from "@/lib/utils";

export default function Notes() {
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [openNoteId, setOpenNoteId] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [sorts, setSorts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sorts_notes") || "null");
      return saved?.length ? saved : ["priority_asc", "date_desc"];
    } catch {
      return ["priority_asc", "date_desc"];
    }
  });
  const handleSortsChange = (next) => {
    setSorts(next);
    localStorage.setItem("sorts_notes", JSON.stringify(next));
  };

  const noteMutation = useOfflineEntityMutation("Note");
  const { createTask, deleteTask } = useOfflineMutation();

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: () => apiClient.entities.Note.list("-updated_date", 500),
  });
  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });
  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100),
  });

  const openNote = notes.find((n) => n.id === openNoteId) || null;

  const priorityOrderMap = useMemo(() => {
    const map = {};
    priorities.forEach((p) => { map[p.id] = p.order; });
    return map;
  }, [priorities]);

  // Sort comparator for notes. "date" here is the CREATED date; pinned
  // notes always float to the top of their section.
  const compareNotes = (a, b, sortValue) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const pa = priorityOrderMap[a.priority_id] ?? 99;
    const pb = priorityOrderMap[b.priority_id] ?? 99;
    const ca = String(a.created_date || "");
    const cb = String(b.created_date || "");
    const ta = (a.tags?.[0] || "");
    const tb = (b.tags?.[0] || "");
    switch (sortValue) {
      case "date_asc": return ca.localeCompare(cb);
      case "date_desc": return cb.localeCompare(ca);
      case "priority_asc": return pa - pb;
      case "priority_desc": return pb - pa;
      case "tag_az":
        if (!ta && tb) return 1;
        if (ta && !tb) return -1;
        return ta.localeCompare(tb);
      default: return 0;
    }
  };

  const sortNotes = (list) => [...list].sort((a, b) => {
    for (const s of sorts) { const r = compareNotes(a, b, s); if (r !== 0) return r; }
    return 0;
  });

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? notes.filter(
          (n) =>
            (n.title || "").toLowerCase().includes(q) ||
            (n.content_text || "").toLowerCase().includes(q)
        )
      : notes;
  }, [notes, search]);

  // Grouped by tag (heading = the tag name), untagged under "By Date".
  // A multi-tag note appears under each of its tags (Groupings behavior).
  // Empty sections are dropped.
  const groups = useMemo(() => {
    const tagNames = [...new Set(filteredNotes.flatMap((n) => n.tags || []))].sort((a, b) =>
      String(a).toLowerCase().localeCompare(String(b).toLowerCase())
    );
    const out = tagNames
      .map((tag) => ({
        key: `tag:${tag}`,
        title: tag,
        notes: sortNotes(filteredNotes.filter((n) => (n.tags || []).includes(tag))),
      }))
      .filter((g) => g.notes.length > 0);
    const untagged = sortNotes(filteredNotes.filter((n) => !(n.tags || []).length));
    if (untagged.length) out.push({ key: "by-date", title: "By Date", notes: untagged });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNotes, sorts, priorityOrderMap]);

  // New note = blank editor (created only on submit — no empty-note litter).
  const newNote = () => { setOpenNoteId(null); setShowEditor(true); };

  useShortcutEvent(SHORTCUT_EVENTS.newTask, newNote);
  useShortcutEvent(SHORTCUT_EVENTS.search, () => setShowSearch(true));

  // Upsert used by the editor's autosave — create on the first valid
  // write (returning the new record so the editor tracks its id), then
  // update. Returns the saved record either way.
  const saveNote = async (id, data) => {
    if (id) { await noteMutation.update(id, data); return { id, ...data }; }
    return noteMutation.create(data);
  };

  // Delete → toast with undo (recreates from the in-memory snapshot).
  // Phase 5 upgrades this to a recoverable Recently-Deleted record.
  const deleteNote = (note) => {
    const snapshot = { ...note };
    delete snapshot.id;
    noteMutation.remove(note.id);
    showDeleteToast({
      label: "Note deleted",
      onUndo: () => noteMutation.create(snapshot),
    });
  };

  // Make task: create a dated task carrying the note's title/description/
  // tags/priority (tasks require a date → default today), remove the note
  // (by the id the editor autosaved it under).
  const makeTask = async (draft, noteId) => {
    const source = notes.find((n) => n.id === noteId) || null;
    const noteSnapshot = source ? (() => { const s = { ...source }; delete s.id; return s; })() : null;
    const created = await createTask({
      title: draft.title || "Untitled",
      description: draft.description || "",
      description_json: draft.description_json || "",
      tags: draft.tags || [],
      priority_id: draft.priority_id || "",
      status: "todo",
      task_type: "one_time",
      due_date: format(new Date(), "yyyy-MM-dd"),
    });
    if (noteId) noteMutation.remove(noteId);
    showDeleteToast({
      label: "Task created",
      onUndo: () => {
        if (created?.id) deleteTask(created.id);
        if (noteSnapshot) noteMutation.create(noteSnapshot);
      },
    });
  };

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
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} page="notes" />
          {/* Same button as Today's New Task — condenses to a plus on small screens. */}
          <Button onClick={newNote} className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 h-9 gap-1.5" data-testid="new-note-button">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New note</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Card key={i} className="h-28 animate-pulse" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-14">
          <NotebookPen className="w-5 h-5 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {search ? "Nothing matches." : "A quiet page. Write anything."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">{group.title}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.notes.map((note) => (
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
                    <NotePreview
                      contentJson={note.content_json}
                      contentText={note.content_text}
                      className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-3"
                    />
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
                      {note.updated_date
                        ? formatDistanceToNow(new Date(note.updated_date), { addSuffix: true })
                        : ""}
                    </p>
                  </Card>
                ))}
              </div>
            </section>
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
        priorities={priorities}
        savedTags={savedTags}
        onSave={saveNote}
        onDelete={deleteNote}
        onMakeTask={makeTask}
      />
    </div>
  );
}
