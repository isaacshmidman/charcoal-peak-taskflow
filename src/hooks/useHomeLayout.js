// @ts-nocheck
/**
 * @file How this person arranged Home (backend/home-layout.js). Saved to
 * their account, so it is the same page on every device. Offline, the
 * last arrangement seen is used; with none ever seen, the starting one.
 *
 * A change shows at once and is put back, with a line saying so, if it
 * couldn't be saved.
 */
import { useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";
import { showDeleteToast } from "@/components/tasks/DeleteToast";
import { resolveHomeLayout } from "@/lib/home-blocks";

const KEY = ["homeLayout"];

export function useHomeLayout() {
  const queryClient = useQueryClient();
  const { data: saved = null, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => apiClient.homeLayout.get(),
    staleTime: 60_000,
    retry: false,
  });

  // Several changes can be on their way at once (move, move, widen). Only
  // the last one's answer goes on the page, so an earlier answer arriving
  // late can't put an older arrangement back; and a failure goes back to
  // the last arrangement the server is known to hold, not to a change
  // that was itself still waiting.
  const latest = useRef(0);
  const waiting = useRef(0);
  const confirmed = useRef(null);

  /** Replace it (null puts the starting layout back). True when it was saved. */
  const save = useCallback(
    async (next) => {
      const turn = ++latest.current;
      if (waiting.current === 0) confirmed.current = queryClient.getQueryData(KEY) ?? null;
      waiting.current += 1;
      queryClient.setQueryData(KEY, next);
      try {
        const kept = await apiClient.homeLayout.set(next);
        confirmed.current = kept;
        if (turn === latest.current) queryClient.setQueryData(KEY, kept);
        return true;
      } catch {
        if (turn === latest.current) {
          queryClient.setQueryData(KEY, confirmed.current);
          showDeleteToast({ label: "Couldn’t save your Home layout. Check your connection and try again.", hideUndo: true, duration: 5000 });
        }
        return false;
      } finally {
        waiting.current -= 1;
      }
    },
    [queryClient],
  );

  return { layout: resolveHomeLayout(saved), isCustom: Array.isArray(saved), isLoading, save };
}
