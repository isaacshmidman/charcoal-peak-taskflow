// @ts-nocheck
/**
 * @file ⌘K command palette — the deferred half of the keyboard-shortcut
 * system, built on the same event bus. One input: actions (emitted as
 * SHORTCUT_EVENTS the current page already subscribes to), navigation
 * (the same map the g-sequences use), and task search (fuzzy over the
 * live ["tasks"] cache — no network).
 *
 * Opening a task: pages own their TaskForm state, so the palette hands
 * off — on /Active it emits SHORTCUT_EVENTS.editTask; anywhere else it
 * navigates to /Active with sessionStorage.paletteOpenTask, which Active
 * consumes on mount. Avoids a global-dialog rework.
 *
 * Recents: the last 8 executed command keys in localStorage. Task
 * selections are not recented (ids go stale).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  LayoutGrid,
  ListTodo,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT_EVENTS, emitShortcut } from "@/lib/shortcuts";
import { fuzzyFilter } from "@/lib/fuzzy";
import { excludeExternalEvents } from "@/lib/task-filters";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "commandPaletteRecents";

const NAV_COMMANDS = [
  { key: "nav:/Today", label: "Go to Today", icon: Sun, path: "/Today" },
  { key: "nav:/Active", label: "Go to All Tasks", icon: ListTodo, path: "/Active" },
  { key: "nav:/Groupings", label: "Go to Groupings", icon: LayoutGrid, path: "/Groupings" },
  { key: "nav:/Calendar", label: "Go to Calendar", icon: CalendarDays, path: "/Calendar" },
  { key: "nav:/Completed", label: "Go to Completed", icon: CheckCircle2, path: "/Completed" },
  { key: "nav:/Notes", label: "Go to Notes", icon: NotebookPen, path: "/Notes" },
  { key: "nav:/Settings", label: "Go to Settings", icon: Settings, path: "/Settings" },
];

// Actions only appear on routes whose page subscribes to the event.
const ACTION_COMMANDS = [
  {
    key: "action:new-task",
    label: "New task",
    icon: Plus,
    routes: ["/Today", "/Active", "/Groupings", "/Calendar"],
    run: () => emitShortcut(SHORTCUT_EVENTS.newTask),
  },
  {
    key: "action:new-note",
    label: "New note",
    icon: NotebookPen,
    routes: ["/Notes"],
    run: () => emitShortcut(SHORTCUT_EVENTS.newTask), // Notes maps n/new to a note
  },
  {
    key: "action:search",
    label: "Search this page",
    icon: Search,
    routes: ["/Today", "/Active", "/Groupings", "/Calendar", "/Completed", "/Notes"],
    run: () => emitShortcut(SHORTCUT_EVENTS.search),
  },
  {
    key: "action:calendar-sync",
    label: "Sync calendars now",
    icon: RefreshCw,
    routes: ["/Calendar"],
    run: () => emitShortcut(SHORTCUT_EVENTS.calendarSync),
  },
];

function loadRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function pushRecent(key) {
  try {
    const next = [key, ...loadRecents().filter((k) => k !== key)].slice(0, 8);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {}
}

export default function CommandPalette({ open, onOpenChange }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const path = location.pathname;

  const sections = useMemo(() => {
    const actionsHere = ACTION_COMMANDS.filter((a) => a.routes.includes(path));
    const q = query.trim();

    if (!q) {
      const recentKeys = loadRecents();
      const byKey = new Map([...actionsHere, ...NAV_COMMANDS].map((c) => [c.key, c]));
      const recents = recentKeys.map((k) => byKey.get(k)).filter(Boolean).slice(0, 4);
      const recentSet = new Set(recents.map((c) => c.key));
      return [
        recents.length && { title: "Recent", items: recents },
        { title: "Actions", items: actionsHere.filter((c) => !recentSet.has(c.key)) },
        { title: "Go to", items: NAV_COMMANDS.filter((c) => !recentSet.has(c.key)) },
      ].filter(Boolean);
    }

    const commandMatches = fuzzyFilter(q, [...actionsHere, ...NAV_COMMANDS], (c) => c.label, 6);
    const tasks = excludeExternalEvents(queryClient.getQueryData(["tasks"]) || []).filter(
      (t) => !t.parent_id && t.status !== "done"
    );
    const taskMatches = fuzzyFilter(q, tasks, (t) => t.title || "", 8).map((t) => ({
      key: `task:${t.id}`,
      label: t.title,
      icon: ArrowRight,
      task: t,
    }));
    return [
      commandMatches.length && { title: "Commands", items: commandMatches },
      taskMatches.length && { title: "Tasks", items: taskMatches },
    ].filter(Boolean);
  }, [query, path, queryClient, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const clampedIndex = Math.min(activeIndex, Math.max(flat.length - 1, 0));

  useEffect(() => {
    // Keep the highlighted row in view while arrowing through.
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  const execute = (command) => {
    onOpenChange(false);
    if (!command) return;
    if (command.task) {
      if (path === "/Active") {
        emitShortcut(SHORTCUT_EVENTS.editTask, { id: command.task.id });
      } else {
        sessionStorage.setItem("paletteOpenTask", command.task.id);
        navigate("/Active");
      }
      return;
    }
    pushRecent(command.key);
    if (command.path) {
      navigate(command.path);
      return;
    }
    // Defer action events one tick so the dialog's close (and its focus
    // restoration) never races the handler opening another dialog.
    setTimeout(() => command.run?.(), 50);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md p-0 gap-0 top-[20%] translate-y-0 overflow-hidden"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <input
          ref={inputRef}
          value={query}
          data-testid="command-palette-input"
          placeholder="Type a command or search tasks…"
          className="w-full h-12 px-4 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none border-b border-slate-100 dark:border-[#303030]"
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              execute(flat[clampedIndex]);
            }
          }}
        />
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5">
          {flat.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
              Nothing matches.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.title}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {section.title}
                </p>
                {section.items.map((command) => {
                  const index = flat.indexOf(command);
                  const Icon = command.icon;
                  return (
                    <button
                      key={command.key}
                      type="button"
                      data-active={index === clampedIndex}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => execute(command)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200",
                        index === clampedIndex && "bg-slate-50 dark:bg-[#161616]"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                      <span className="truncate">{command.label}</span>
                      {command.task?.due_date && (
                        <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                          {command.task.due_date}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
