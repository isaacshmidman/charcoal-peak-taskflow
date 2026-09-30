// @ts-nocheck
/**
 * @file The settings a person pinned so every new schedule starts with
 * them (backend/schedule-defaults.js), shared by every note on the page.
 * Saved to their account, so they follow them to every device; while
 * offline the last ones seen are used, and pinning says it couldn't save.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";
import { showDeleteToast } from "@/components/tasks/DeleteToast";

const KEY = ["scheduleDefaults"];

export function useScheduleDefaults() {
  const queryClient = useQueryClient();
  const { data: defaults = {} } = useQuery({
    queryKey: KEY,
    queryFn: () => apiClient.scheduleDefaults.get(),
    staleTime: 60_000,
    retry: false,
  });

  /** Replace them; shown at once, put back if saving fails. */
  const save = useCallback(
    async (next) => {
      const before = queryClient.getQueryData(KEY) || {};
      queryClient.setQueryData(KEY, next);
      try {
        queryClient.setQueryData(KEY, await apiClient.scheduleDefaults.set(next));
        return true;
      } catch {
        queryClient.setQueryData(KEY, before);
        showDeleteToast({ label: "Couldn’t save that for new schedules. Check your connection and try again.", hideUndo: true, duration: 5000 });
        return false;
      }
    },
    [queryClient]
  );

  return { defaults, save };
}
