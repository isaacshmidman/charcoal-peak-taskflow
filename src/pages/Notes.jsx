// @ts-nocheck
/**
 * @file Notes — pure note-taking. Two panes: a recency-ordered list on
 * the left, the note itself on the right. A note is a document; nothing
 * you type here becomes a task on its own.
 *
 * Tasks come from SELECTIONS instead. Select text → Make task → the
 * existing TaskForm opens prefilled with that text as the title. Save and
 * the span gets the reserved yellow marker; cancel and nothing happened
 * at all, because task creation is deferred to the button.
 *
 * The marker is a link, not a lock: the prefill is a one-time copy, and
 * afterwards the note text and the task title are independent. Highlight
 * state is DERIVED from live task state (see richtext/taskLink.js) — the
 * note stores only a task id, so the two can never drift.
 *
 * Data: ["notes"] query + useOfflineEntityMutation("Note") — offline
 * cache/queue/replay ride the entity registry, no bespoke code here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { apiClient } from "@/api/apiClient";
import { useOfflineEntityMutation } from "@/hooks/useOfflineEntityMutation";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { cn } from "@/lib/utils";
import { useSplitPane } from "@/hooks/useSplitPane";
import SplitDivider from "@/components/ui/split-divider";
import TaskForm from "@/components/tasks/TaskForm";
import NoteSidebar from "@/components/notes/NoteSidebar";
import NoteCanvas from "@/components/notes/NoteCanvas";

export default function Notes() {
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [openNoteId, setOpenNoteId] = useState(null);
  // Below sm the two panes can't sit side by side, and stacking them
  // would bury the editor under the whole note list. Show one at a time
  // instead, the way Notes behaves on a phone.
  const [mobilePane, setMobilePane] = useState("list");

  // Same divider the Calendar day view uses between its timed and all-day
  // columns — one hook, so the two behave identically rather than merely
  // looking alike. The sidebar is on the LEFT here, so dragging right
  // grows it (fromEnd stays false).
  const {
    size: sidebarWidth,
    containerRef,
    startResize,
    resetSplit,
    snapped,
    glide,
  } = useSplitPane({
    storageKey: "notes_sidebar_width",
    minSize: 180,
    defaultSize: 256,
    // The list never takes more than half the page, and it drags freely —
    // no detents, unlike the calendar's. Double-click parks it at 25/75.
    maxFraction: 0.5,
    snapFractions: [],
    resetFraction: 0.25,
  });

  // Task dialog state. `taskDraft` seeds a NEW task from a selection;
  // `editingTask` opens an existing one from its dot.
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState(null);
  const [editingTask, setEditingTask] = useState(null);

  const editorRef = useRef(null);
  const scrollRef = useRef(null);
  // The span a pending new task should mark, captured before the dialog
  // opens. Cleared on cancel so nothing is ever marked without a task.
  const pendingRangeRef = useRef(null);
  // Where to put the reader back afterwards: caret + scroll.
  const restoreRef = useRef(null);

  const noteMutation = useOfflineEntityMutation("Note");
  const deletedNoteMutation = useOfflineEntityMutation("DeletedNote");
  const { createTask, updateTask, deleteTask } = useOfflineMutation();

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: () => apiClient.entities.Note.list("-updated_date", 500),
  });

  // Every task, including subtasks and calendar-sourced ones: a note can
  // link to anything with an id, and this only ever reads status.
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
  });

  // The single source of truth for every highlight in every open note.
  // Because it comes from the shared ["tasks"] cache, completing a task
  // anywhere in the app repaints the note that mentions it.
  const taskStatusById = useMemo(() => {
    const map = new Map();
    for (const task of tasks) map.set(task.id, task.status);
    return map;
  }, [tasks]);

  const sortedNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? notes.filter(
          (n) =>
            (n.title || "").toLowerCase().includes(q) ||
            (n.content_text || "").toLowerCase().includes(q)
        )
      : notes;
    return [...matched].sort((a, b) =>
      String(b.updated_date || "").localeCompare(String(a.updated_date || ""))
    );
  }, [notes, search]);

  const openNote = notes.find((n) => n.id === openNoteId) || null;

  // Land on the most recent note so the page is never an empty right pane.
  useEffect(() => {
    if (openNoteId && notes.some((n) => n.id === openNoteId)) return;
    setOpenNoteId(sortedNotes[0]?.id || null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.length, sortedNotes[0]?.id]);

  const saveNote = useCallback((id, data) => noteMutation.update(id, data), [noteMutation]);

  // A blank note is created immediately and kept — pressing New note
  // gives you a blank page that's already real, Apple Notes style.
  const newNote = async () => {
    const created = await noteMutation.create({ title: "", content_json: "", content_text: "" });
    if (created?.id) setOpenNoteId(created.id);
    setMobilePane("editor");
  };

  const selectNote = (id) => { setOpenNoteId(id); setMobilePane("editor"); };

  const deleteNote = async (note) => {
    const snapshot = { ...note };
    delete snapshot.id;
    const record = await deletedNoteMutation.create({
      note_id: note.id,
      title: note.title || "",
      content_json: note.content_json || "",
      content_text: note.content_text || "",
      pinned: !!note.pinned,
      tags: note.tags || [],
      priority_id: note.priority_id || "",
    });
    noteMutation.remove(note.id);
    setOpenNoteId(null);
    setMobilePane("list");
    showDeleteToast({
      label: "Note deleted",
      onUndo: () => {
        noteMutation.create(snapshot);
        if (record?.id) deletedNoteMutation.remove(record.id);
      },
    });
  };

  useShortcutEvent(SHORTCUT_EVENTS.newTask, newNote);
  useShortcutEvent(SHORTCUT_EVENTS.search, () => setShowSearch(true));

  // Tapping the Notes nav icon while a note is open returns to the list,
  // mirroring how the Settings icon returns to the settings menu.
  useEffect(() => {
    const handler = () => setMobilePane("list");
    window.addEventListener("navClicked:/Notes", handler);
    return () => window.removeEventListener("navClicked:/Notes", handler);
  }, []);

  // ── Selection ⇄ task ───────────────────────────────────────────────
  // Remember exactly where the writer was before the dialog takes over.
  const capturePlace = (range) => {
    pendingRangeRef.current = range || null;
    const editor = editorRef.current;
    restoreRef.current = {
      from: range?.from ?? editor?.state.selection.from ?? null,
      to: range?.to ?? editor?.state.selection.to ?? null,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    };
  };

  // Put them back. Deferred a frame because Radix restores focus to the
  // trigger as it closes, and we need the last word.
  const restorePlace = () => {
    const saved = restoreRef.current;
    restoreRef.current = null;
    const editor = editorRef.current;
    if (!editor || !saved || saved.from == null) return;
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      editor.commands.focus();
      editor.commands.setTextSelection({ from: saved.from, to: saved.to });
      if (scrollRef.current) scrollRef.current.scrollTop = saved.scrollTop;
    });
  };

  const handleMakeTask = (text, range) => {
    capturePlace(range);
    setEditingTask(null);
    setTaskDraft({ title: text });
    setTaskFormOpen(true);
  };

  const handleOpenTask = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    capturePlace(null);
    pendingRangeRef.current = null; // an existing task never re-marks
    setTaskDraft(null);
    setEditingTask(task);
    setTaskFormOpen(true);
  };

  // Mark the captured span once the task actually exists. Selection is
  // put back afterwards so the doc change doesn't move the caret.
  const markRange = (taskId, range) => {
    const editor = editorRef.current;
    if (!editor || !range || editor.isDestroyed) return;
    editor
      .chain()
      .setTextSelection(range)
      .setTaskLink({ taskId })
      .setTextSelection(range)
      .run();
  };

  const closeTaskForm = () => {
    setTaskFormOpen(false);
    setTaskDraft(null);
    setEditingTask(null);
    pendingRangeRef.current = null;
    restorePlace();
  };

  return (
    <div className="space-y-5">
      {/* Same header shape as Today / All Tasks / Groupings / Completed:
          title + count on the left, search and the primary action on the
          right. Search and New note live here rather than inside the
          sidebar so the page reads like the rest of the app. */}
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
          <Button
            onClick={newNote}
            data-testid="new-note-button"
            className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 h-9 gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New note</span>
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex min-h-0 flex-col rounded-xl border border-border-hairline bg-surface-card h-[calc(100vh-17rem)] sm:h-[calc(100vh-12rem)] sm:flex-row"
      >
      <NoteSidebar
        // Fixed px width from the divider on desktop; full width on mobile,
        // where the panes swap instead of sitting side by side.
        style={{ "--notes-sb": `${sidebarWidth}px` }}
        className={cn(
          mobilePane === "editor" ? "hidden sm:flex" : "flex",
          "sm:w-[var(--notes-sb)]",
          glide && "sm:transition-[width] sm:duration-100 sm:ease-out"
        )}
        notes={sortedNotes}
        activeId={openNoteId}
        onSelect={selectNote}
        onDelete={deleteNote}
        search={search}
        isLoading={isLoading}
      />

      <SplitDivider
        onPointerDown={startResize}
        onDoubleClick={resetSplit}
        snapped={snapped}
        title="Drag to resize. Double-click for a 25/75 split."
        className={cn("hidden sm:flex", mobilePane === "list" && "sm:flex")}
      />

      {openNote ? (
        <NoteCanvas
          // Fresh editor + fresh autosave baseline per note. NOT keyed on
          // anything that changes while the task dialog is open, so the
          // note underneath survives it untouched.
          key={openNote.id}
          className={mobilePane === "list" ? "hidden sm:flex" : "flex"}
          onBack={() => setMobilePane("list")}
          note={openNote}
          onSave={saveNote}
          taskStatusById={taskStatusById}
          onMakeTask={handleMakeTask}
          onOpenTask={handleOpenTask}
          onEditorReady={(editor) => { editorRef.current = editor; }}
          scrollRef={scrollRef}
        />
      ) : (
        <section className={cn("flex-1 items-center justify-center", mobilePane === "list" ? "hidden sm:flex" : "flex")}>
          <div className="text-center">
            <NotebookPen className="mx-auto mb-2 h-5 w-5 text-slate-300 dark:text-slate-600" />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {search ? "Nothing matches." : "A quiet page. Write anything."}
            </p>
          </div>
        </section>
      )}

      </div>

      <TaskForm
        open={taskFormOpen}
        onOpenChange={(o) => { if (!o) closeTaskForm(); else setTaskFormOpen(true); }}
        task={editingTask}
        initialDraft={taskDraft || undefined}
        onSubmit={async (data, subtaskTitles = [], existingId = null) => {
          const id = editingTask?.id ?? existingId;
          if (id) {
            await updateTask(id, data);
            return { id };
          }
          const created = await createTask(data);
          for (let i = 0; i < subtaskTitles.length; i++) {
            await createTask({
              title: subtaskTitles[i],
              status: "todo",
              task_type: "one_time",
              parent_id: created?.id,
              order: i,
            });
          }
          // The span is marked only now, once a task really exists —
          // which is why cancelling leaves the text untouched.
          if (created?.id && pendingRangeRef.current) {
            markRange(created.id, pendingRangeRef.current);
            pendingRangeRef.current = null;
          }
          return created;
        }}
        onDelete={(task) => {
          // The task goes; the words stay. The mark is left in place and
          // simply stops painting, because its task is no longer found.
          deleteTask(task.id);
          closeTaskForm();
        }}
      />
    </div>
  );
}
