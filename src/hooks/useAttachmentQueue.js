// @ts-nocheck
/**
 * @file Drains the offline attachment queue (Pri 6). Mounted once in
 * Layout, alongside useOfflineData (which replays JSON mutations).
 *
 * On `online` / `focus`, once on mount if already online, and on a timer
 * while anything is still waiting, it walks the IndexedDB queue and
 * uploads each file. Mirrors useOfflineData's
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

const isPermanent = attachmentQueue.isPermanentUploadFailure;

// A file that failed while the connection was UP (the server hiccuped, or
// the upload was cut off) gets no `online` event to wake it. So a drain
// that leaves something behind books another go: 20 s, then doubling to
// 5 minutes at most.
const FIRST_RETRY_MS = 20_000;
const MAX_RETRY_MS = 5 * 60_000;

export function useAttachmentQueue() {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    let retryTimer = null;
    let retryDelay = FIRST_RETRY_MS;
    let stopped = false;
    const scheduleRetry = () => {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
        void drain();
      }, retryDelay);
    };

    const drain = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (inFlightRef.current) {
        requestedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      let leftBehind = 0;
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
            // Transient → leave in queue for the next go.
            else leftBehind += 1;
          }
        }
      } finally {
        inFlightRef.current = false;
        if (requestedRef.current) {
          requestedRef.current = false;
          void drain();
        } else if (leftBehind) {
          scheduleRetry();
        } else {
          retryDelay = FIRST_RETRY_MS;
        }
      }
    };

    window.addEventListener("online", drain);
    window.addEventListener("focus", drain);
    // Something was just queued. If that happened offline, `online` will
    // drain it; if the connection is up, it failed a moment ago, so wait
    // a little rather than hammering.
    window.addEventListener(attachmentQueue.QUEUED_EVENT, scheduleRetry);
    if (typeof navigator === "undefined" || navigator.onLine) {
      void drain();
    }
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", drain);
      window.removeEventListener("focus", drain);
      window.removeEventListener(attachmentQueue.QUEUED_EVENT, scheduleRetry);
    };
  }, [queryClient]);
}
