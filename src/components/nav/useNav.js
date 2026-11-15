// @ts-nocheck
/**
 * @file What the navigation shows, worked out once for the sidebar and
 * the phone's tab bar: the places in the person's own order, the page
 * the app opens on, and the counts beside the links.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, House, ListTodo, NotebookPen, Sun } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { DEFAULT_NAV_ORDER, NAV_LABELS, sanitizeNavOrder, startPath, tagsPath, tasksPath } from "@/lib/navigation";
import { excludeExternalEvents } from "@/lib/task-filters";
import { isDueByToday, openTasks, tagCounts } from "@/lib/task-views";
import { useCalendarOrderState } from "@/hooks/useCalendarOrder";
import { useTodayStart } from "@/hooks/useTodayStart";

/** The icon of each place, wherever a place is drawn. */
export const NAV_ICONS = {
  "/Home": House,
  "/Today": Sun,
  "/Calendar": CalendarDays,
  "/Active": ListTodo,
  "/Notes": NotebookPen,
};

function readNavOrder() {
  try {
    const saved = localStorage.getItem("navOrder");
    if (saved) return sanitizeNavOrder(JSON.parse(saved));
  } catch { /* unreadable: use the default order */ }
  return DEFAULT_NAV_ORDER;
}

/**
 * The places, in the person's order (Settings → Appearance), each with
 * where it leads (`to`: Tasks leads to the view it is set to open in),
 * the page the app opens on, and where a tag leads from outside Tasks.
 */
export function useNavItems() {
  const [order, setOrder] = useState(readNavOrder);
  const [defaultNav, setDefaultNav] = useState(startPath);
  const [tasksTo, setTasksTo] = useState(tasksPath);
  const [tagsTo, setTagsTo] = useState(tagsPath);

  useEffect(() => {
    const onChange = () => { setOrder(readNavOrder()); setDefaultNav(startPath()); setTasksTo(tasksPath()); setTagsTo(tagsPath()); };
    window.addEventListener("navOrderChanged", onChange);
    return () => window.removeEventListener("navOrderChanged", onChange);
  }, []);

  const items = useMemo(
    () =>
      order
        .map((path) => ({ path, to: path === "/Active" ? tasksTo : path, label: NAV_LABELS[path], icon: NAV_ICONS[path] }))
        .filter((item) => item.icon),
    [order, tasksTo],
  );
  return { items, defaultNav, tagsTo };
}

/**
 * The numbers beside the links. Each is counted the way its page counts
 * its rows (lib/task-views.js), so the two can't disagree.
 * @returns {{ byPath: Record<string, number>, tags: { tag: string, count: number }[] }}
 */
export function useNavCounts() {
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiClient.entities.Task.list("-created_date", 5000),
    select: excludeExternalEvents,
  });
  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100),
  });
  const { hidden } = useCalendarOrderState();
  const todayStart = useTodayStart();

  return useMemo(() => {
    const open = openTasks(tasks, hidden);
    return {
      byPath: {
        "/Today": open.filter((task) => isDueByToday(task, todayStart)).length,
        "/Active": open.length,
      },
      tags: tagCounts(open, savedTags),
    };
  }, [tasks, savedTags, hidden, todayStart]);
}
