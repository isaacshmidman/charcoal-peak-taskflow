// @ts-nocheck
import { useState, useMemo, useEffect } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { ArrowLeft, Trash2, Search, RotateCcw, CheckSquare, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnimatedSearchInput } from "@/components/ui/animated-search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns/format";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useDeletedTasks } from "@/hooks/useDeletedTasks";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { useOfflineEntityMutation } from "@/hooks/useOfflineEntityMutation";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import NotePreview from "@/components/notes/NotePreview";
import { excludeExternalEvents } from "@/lib/task-filters";
import { formatDeleteLabel } from "@/hooks/useDeleteWithUndo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import MultiSortPanel from "@/components/tasks/MultiSortPanel";
import { colorBg, isDarkColor } from "@/lib/colors";
import { compareDeletedNote, compareDeletedTask, sortTrash } from "@/lib/trash-sort";

const RETENTION_OPTIONS = [
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "30", label: "30 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
];

export default function RecentlyDeleted({ onBack } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { appPublicSettings } = useAuth();
  const { updateDeletedTask, permanentlyDelete, permanentlyDeleteMany, purgeExpired } = useDeletedTasks();
  const { createTask } = useOfflineMutation();

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showEmptyDialog, setShowEmptyDialog] = useState(false);
  const [sorts, setSorts] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("sorts_deleted") || '["deleted_desc"]').filter(Boolean);
      return parsed.length ? parsed : ["deleted_desc"];
    }
    catch { return ["deleted_desc"]; }
  });
  const [retentionDays, setRetentionDays] = useState(() => {
    const stored = localStorage.getItem("deletedTaskRetentionDays");
    if (stored) return stored;
    const serverDefault = appPublicSettings?.deleted_task_retention_days;
    if (serverDefault) {
      localStorage.setItem("deletedTaskRetentionDays", String(serverDefault));
      return String(serverDefault);
    }
    return "7";
  });

  const handleSortsChange = (s) => {
    setSorts(s);
    localStorage.setItem("sorts_deleted", JSON.stringify(s));
  };

  const handleRetentionChange = async (val) => {
    setRetentionDays(val);
    localStorage.setItem("deletedTaskRetentionDays", val);
    const days = parseInt(val, 10);
    const expiry = (deletedAt) =>
      new Date(new Date(deletedAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    const current = queryClient.getQueryData(["deletedTasks"]) || [];
    const currentNotes = queryClient.getQueryData(["deletedNotes"]) || [];

    await Promise.all([
      ...current.map((record) => updateDeletedTask(record.id, { expires_at: expiry(record.deleted_at) })),
      ...currentNotes.map((record) => deletedNoteMutation.update(record.id, { expires_at: expiry(record.deleted_at) })),
    ]);
  };

  const { data: rawDeletedTasks = [] } = useQuery({
    queryKey: ["deletedTasks"],
    queryFn: () => apiClient.entities.DeletedTask.list("-deleted_at", 500),
    // Calendar-imported events shouldn't reappear in the user's trash.
    select: excludeExternalEvents,
  });

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });

  const { data: rawDeletedNotes = [] } = useQuery({
    queryKey: ["deletedNotes"],
    queryFn: () => apiClient.entities.DeletedNote.list("-deleted_at", 500),
  });
  const noteMutation = useOfflineEntityMutation("Note");
  const deletedNoteMutation = useOfflineEntityMutation("DeletedNote");

  const priorityMap = useMemo(() => {
    const map = {};
    priorities.forEach(p => { map[p.id] = p; });
    return map;
  }, [priorities]);

  // Purge expired records on mount
  useEffect(() => { purgeExpired(); }, []);

  /** Priority rank for a trash record (lower = higher priority; unset last).
   * Records snapshot priority_id, so the live priority list supplies order. */
  const priorityRank = (record) => priorityMap[record.priority_id]?.order ?? 99;

  const userDeletedTasks = useMemo(
    () => rawDeletedTasks,
    [rawDeletedTasks]
  );

  const displayedTasks = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = userDeletedTasks.filter(t => {
      if (!q) return true;
      return t.title?.toLowerCase().includes(q) || t.tags?.some(tag => tag.toLowerCase().includes(q));
    });
    return sortTrash(filtered, sorts, compareDeletedTask, priorityRank);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDeletedTasks, search, sorts, priorityMap]);

  const displayedNotes = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = rawDeletedNotes.filter(n =>
      !q || (n.title || "").toLowerCase().includes(q) || (n.content_text || "").toLowerCase().includes(q) || (n.tags || []).some(t => t.toLowerCase().includes(q))
    );
    return sortTrash(filtered, sorts, compareDeletedNote, priorityRank);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawDeletedNotes, search, sorts, priorityMap]);

  const handleRestoreNote = async (record) => {
    await noteMutation.create({
      title: record.title, content_json: record.content_json, content_text: record.content_text,
      pinned: !!record.pinned, tags: record.tags || [], priority_id: record.priority_id || "",
    });
    await deletedNoteMutation.remove(record.id);
    showDeleteToast({ label: formatDeleteLabel({ scenario: "restore_single", title: record.title || "Untitled" }), hideUndo: true });
  };

  const handlePermanentDeleteNote = async (record) => {
    await deletedNoteMutation.remove(record.id);
    showDeleteToast({ label: formatDeleteLabel({ scenario: "permanent_single", title: record.title || "Untitled" }), hideUndo: true });
  };

  const handleRestore = async (record) => {
    // Re-create the task
    const taskData = {
      title: record.title,
      description: record.description,
      priority_id: record.priority_id,
      status: record.was_completed ? "done" : "todo",
      task_type: record.task_type,
      recurrence: record.recurrence,
      recurrence_days: record.recurrence_days,
      recurrence_end_date: record.recurrence_end_date,
      due_date: record.due_date,
      task_time: record.task_time,
      tags: record.tags,
      completed_at: record.completed_at,
    };
    const created = await createTask(taskData);
    // Restore subtasks
    if (record.subtasks?.length && created?.id) {
      for (const sub of record.subtasks) {
        await createTask({
          title: sub.title,
          status: sub.status,
          due_date: sub.due_date,
          task_time: sub.task_time,
          completed_at: sub.completed_at,
          task_type: "one_time",
          parent_id: created.id,
        });
      }
    }
    // Remove from recently deleted
    await permanentlyDelete(record.id);
    showDeleteToast({
      label: formatDeleteLabel({ scenario: "restore_single", title: record.title || "" }),
      hideUndo: true,
    });
  };

  const handlePermanentDelete = async (record) => {
    await permanentlyDelete(record.id);
    showDeleteToast({
      label: formatDeleteLabel({ scenario: "permanent_single", title: record.title || "" }),
      hideUndo: true,
    });
  };

  const handleEmptyRecentlyDeleted = async () => {
    setShowEmptyDialog(false);
    const count = userDeletedTasks.length + rawDeletedNotes.length;
    await permanentlyDeleteMany(userDeletedTasks.map((record) => record.id));
    for (const record of rawDeletedNotes) {
      await deletedNoteMutation.remove(record.id);
    }
    if (count > 0) {
      showDeleteToast({
        label: formatDeleteLabel({ scenario: "permanent_bulk", count }),
        hideUndo: true,
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (onBack) {
                onBack();
                return;
              }
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate("/Settings");
              }
            }}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#222222] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Recently Deleted</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {displayedTasks.length + displayedNotes.length} item{displayedTasks.length + displayedNotes.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AnimatedSearchInput
            open={searchOpen}
            value={search}
            onChange={setSearch}
            onClose={() => setSearchOpen(false)}
          />
          <Button variant="ghost" size="icon" data-search-toggle className="h-9 w-9 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200" onMouseDown={(e) => e.preventDefault()} onClick={() => setSearchOpen(!searchOpen)}>
            <Search className="w-4 h-4" />
          </Button>
          <MultiSortPanel sorts={sorts} onSortsChange={handleSortsChange} page="deleted" />
          {(userDeletedTasks.length > 0 || rawDeletedNotes.length > 0) && (
            <Dialog open={showEmptyDialog} onOpenChange={setShowEmptyDialog}>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116]"
                title="Empty recently deleted"
                onClick={() => setShowEmptyDialog(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Permanently Delete everything in Recently Deleted?</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleEmptyRecentlyDeleted}
                    className="w-full h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium shadow-sm transition-colors"
                  >
                    Delete all
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEmptyDialog(false)}
                    className="w-full h-12 rounded-xl bg-slate-100 dark:bg-[#161616] hover:bg-slate-200 dark:hover:bg-[#222222] text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Retention setting */}
      <Card className="flex items-center gap-3 px-4 py-3">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-1">Keep deleted items for</span>
        <Select value={retentionDays} onValueChange={handleRetentionChange}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {displayedTasks.length === 0 && displayedNotes.length === 0 ? (
        <div className="py-14 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">Nothing here. The bin sits empty.</p>
        </div>
      ) : (
        <>
          {/* Sections mirror the Notes page: heading only when non-empty. */}
          {displayedTasks.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Tasks</h2>
              <AnimatePresence mode="popLayout">
                {displayedTasks.map(record => (
                  <DeletedTaskCard
                    key={record.id}
                    record={record}
                    priorityMap={priorityMap}
                    onRestore={() => handleRestore(record)}
                    onDelete={() => handlePermanentDelete(record)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
          {displayedNotes.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Notes</h2>
              <AnimatePresence mode="popLayout">
                {displayedNotes.map(record => (
                  <DeletedNoteCard
                    key={record.id}
                    record={record}
                    priorityMap={priorityMap}
                    onRestore={() => handleRestoreNote(record)}
                    onDelete={() => handlePermanentDeleteNote(record)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Trash row for a deleted note — DeletedTaskCard's chrome with a note
 * glyph instead of the completion square and a one-line text preview. */
function DeletedNoteCard({ record, priorityMap, onRestore, onDelete }) {
  const priority = priorityMap[record.priority_id];
  const colorKey = priority?.color || record.priority_color || "slate";
  const cardBg = colorBg[colorKey] || colorBg.slate;
  const isDarkCard = isDarkColor(colorKey);
  const deletedDate = record.deleted_at ? format(new Date(record.deleted_at), "MMM d, yyyy") : "";

  return (
    <motion.div
      layout
      // No mount animation — rows render in place. `exit` still plays.
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.1 }}
    >
      <div className={cn("rounded-xl border flex overflow-hidden", cardBg)}>
        <div className="flex-1 min-w-0 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <div className="shrink-0 w-7 h-7 rounded-md border-2 border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-[#0c0c0c] flex items-center justify-center">
              <NotebookPen className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
            </div>

            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-sm font-medium truncate",
                isDarkCard ? "text-white dark:text-slate-100" : "text-slate-900 dark:text-slate-100",
                !record.title && "text-slate-400 dark:text-slate-500"
              )}>
                {record.title || "Untitled"}
              </p>
              {record.content_text?.trim() && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {record.content_text}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-[10px] font-medium text-red-600 dark:text-red-300 bg-red-50 dark:bg-[#2a1116] border border-red-200 dark:border-red-800 px-1.5 py-0.5 rounded">
                  Deleted {deletedDate}
                </span>
                {record.tags?.length > 0 && record.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="text-[10px] font-medium text-slate-500 dark:text-slate-300 bg-white/70 dark:bg-[#0c0c0c] px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#343434]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onRestore}
                className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-[#10261b] transition-colors"
                title="Restore"
                data-testid={`restore-note-${record.id}`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116] transition-colors"
                title="Delete permanently"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function DeletedTaskCard({ record, priorityMap, onRestore, onDelete }) {
  const priority = priorityMap[record.priority_id];
  const colorKey = priority?.color || record.priority_color || "slate";
  const cardBg = colorBg[colorKey] || colorBg.slate;
  const isDarkCard = isDarkColor(colorKey);
  const isDone = record.was_completed;

  const deletedDate = record.deleted_at ? format(new Date(record.deleted_at), "MMM d, yyyy") : "";

  return (
    <motion.div
      layout
      // No mount animation — rows render in place. `exit` still plays.
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.1 }}
    >
      <div className={cn("rounded-xl border flex overflow-hidden", cardBg, isDone && "opacity-60")}>
        <div className="flex-1 min-w-0 px-3 py-2.5">
          <div className="flex items-start gap-2">
            {/* Status indicator */}
            <div className={cn(
              "shrink-0 w-7 h-7 rounded-md border-2 flex items-center justify-center",
              isDone ? "bg-slate-900 border-slate-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900" : "border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-[#0c0c0c]"
            )}>
              {isDone && <CheckSquare className="w-3.5 h-3.5" />}
            </div>

            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-sm font-medium truncate",
                isDarkCard ? "text-white dark:text-slate-100" : "text-slate-900 dark:text-slate-100",
                isDone && "line-through text-slate-400 dark:text-slate-500"
              )}>
                {record.title}
              </p>

              {/* Deleted-at badge */}
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className="text-[10px] font-medium text-red-600 dark:text-red-300 bg-red-50 dark:bg-[#2a1116] border border-red-200 dark:border-red-800 px-1.5 py-0.5 rounded">
                  Deleted {deletedDate}
                </span>
                {record.due_date && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    Due {format(new Date(record.due_date + "T00:00:00"), "MMM d")}
                  </span>
                )}
                {record.tags?.length > 0 && record.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="text-[10px] font-medium text-slate-500 dark:text-slate-300 bg-white/70 dark:bg-[#0c0c0c] px-1.5 py-0.5 rounded border border-slate-200 dark:border-[#343434]">
                    {tag}
                  </span>
                ))}
                {record.subtasks?.length > 0 && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">{record.subtasks.length} subtask{record.subtasks.length !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onRestore}
                className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-[#10261b] transition-colors"
                title="Restore"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116] transition-colors"
                title="Delete permanently"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
