// @ts-nocheck
/**
 * @file Drains the offline attachment queue (Pri 6). Mounted once in
 * Layout, alongside useOfflineData (which replays JSON mutations).
 *
 * On `online` / `focus`, and once on mount if already online, it walks
 * the IndexedDB queue and uploads each file. Mirrors useOfflineData's
 * guards: a single drain runs at a time (inFlightRef), and a drain
 * requested while one is running re-runs afterward (requestedRef).
 *
 * Error policy per item:
 *   - Permanent (4xx that won't change on retry: 400/403/404/413/415):
 *     drop from the queue so it doesn't retry forever.
 *   - Transient (network error / 5xx / 408 / 429): keep for the next
 *     online tick.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";
import * as attachmentQueue from "@/lib/attachmentQueue";

function isPermanent(status) {
  return [400, 403, 404, 413, 415].includes(Number(status));
}

export function useAttachmentQueue() {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    const drain = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (inFlightRef.current) {
        requestedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      try {
        const items = await attachmentQueue.listAll();
        for (const item of items) {
          // Never upload against a not-yet-synced offline task id — its
          // server id differs, so this would 404 forever. These shouldn't
          // be enqueued in the first place (AttachmentsField guards), but
          // belt-and-suspenders.
          if (String(item.taskId).startsWith("offline_")) continue;
          try {
            const file = attachmentQueue.toFile(item);
            await apiClient.attachments.upload(item.taskId, file);
            await attachmentQueue.remove(item.id);
            queryClient.invalidateQueries({ queryKey: ["taskAttachments", item.taskId] });
            queryClient.invalidateQueries({ queryKey: ["offlineAttachments", item.taskId] });
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
          } catch (err) {
            if (isPermanent(err?.status)) {
              await attachmentQueue.remove(item.id);
              queryClient.invalidateQueries({ queryKey: ["offlineAttachments", item.taskId] });
            }
            // Transient → leave in queue for the next tick.
          }
        }
      } finally {
        inFlightRef.current = false;
        if (requestedRef.current) {
          requestedRef.current = false;
          void drain();
        }
      }
    };

    window.addEventListener("online", drain);
    window.addEventListener("focus", drain);
    if (typeof navigator === "undefined" || navigator.onLine) {
      void drain();
    }
    return () => {
      window.removeEventListener("online", drain);
      window.removeEventListener("focus", drain);
    };
  }, [queryClient]);
}
