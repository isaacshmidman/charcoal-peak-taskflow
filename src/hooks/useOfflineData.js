import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STORAGE_FULL_EVENT, saveSnapshot } from '@/lib/offlineCache';
import { registeredCacheKeys, replayRegisteredEntities } from '@/lib/offlineEntityRegistry';
import { showDeleteToast } from '@/components/tasks/DeleteToast';

// Registered entities contribute their own cache keys; these are the
// remaining non-entity caches the app persists.
const EXTRA_CACHE_KEYS = ['integrations', 'notificationSettings'];
const CACHE_KEYS = [...EXTRA_CACHE_KEYS, ...registeredCacheKeys()];

/**
 * @typedef {{
 *   id?: string,
 *   type: "create" | "update" | "delete",
 *   entityName?: string,
 *   data?: Record<string, any>,
 *   name?: string,
 * }} OfflineQueueEntry
 */

/**
 * @typedef {Record<string, unknown[]>} CachedEntities
 */

/**
 * Run the replay in one tab (or window, or the installed app) at a time.
 * Each has its own copy of this hook and all of them hear "back online"
 * together; without this they would each send the same queue. A tab that
 * finds another already at it does nothing — that one is sending
 * everything there is.
 * @template T
 * @param {() => Promise<T>} run
 * @returns {Promise<T | null>}
 */
async function oneTabAtATime(run) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return run();
  return locks.request('zephyrly-offline-replay', { ifAvailable: true }, (lock) => (lock ? run() : null));
}

/** @param {Array<{ entity: string, type: string, title: string, message: string }>} refused */
export function refusedNotice(refused) {
  const [first] = refused;
  if (refused.length > 1) return `${refused.length} changes made offline couldn't be saved.`;
  const what = first.title ? `“${first.title}”` : 'A change made offline';
  return `${what} couldn't be saved${first.message ? `: ${first.message}` : '.'}`;
}

/**
 * Hook that:
 * 1. Keeps the offline copy of each list up to date (API fetches + optimistic setQueryData).
 * 2. Replays pending mutations when coming back online.
 * @returns {void}
 */
export function useOfflineData() {
  const queryClient = useQueryClient();
  const replayInFlightRef = useRef(false);
  const replayRequestedRef = useRef(false);

  // Keep the offline copy of each list in step with what the app holds
  // (what the server sent, and changes shown before the server has them).
  // Most of what the cache announces isn't a change to the list at all —
  // a page opening, a refetch starting, the same answer arriving — and
  // saveSnapshot writes only when the list is a different one.
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (!event?.query) return;
      // A query key that is longer than its name is a part of the list
      // (one task's files, say), not the list.
      if (event.query.queryKey.length !== 1) return;
      const key = event.query.queryKey[0];
      if (!CACHE_KEYS.includes(key)) return;
      const data = event.query.state.data;
      if (data !== undefined) saveSnapshot(key, data);
    });

    return unsubscribe;
  }, [queryClient]);

  // The device's storage is small, and a full one must not fail quietly:
  // a change that couldn't be queued is said so at once, and a list whose
  // offline copy has fallen behind is said so once.
  useEffect(() => {
    /** @param {any} event */
    const onStorageFull = (event) => {
      const { key, kept } = event.detail || {};
      if (kept) return;
      const isQueue = /^pending/.test(String(key));
      showDeleteToast({
        label: isQueue
          ? "This device's storage is full, so that change can't be kept for later. Reconnect before closing the app."
          : "This device's storage is full, so its offline copy is no longer up to date.",
        hideUndo: true,
        duration: 9000,
      });
    };
    window.addEventListener(STORAGE_FULL_EVENT, onStorageFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onStorageFull);
  }, []);

  // Replay pending mutations when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      if (replayInFlightRef.current) {
        replayRequestedRef.current = true;
        return;
      }

      replayInFlightRef.current = true;

      try {
        // Every entity replays through the registry, in registration order
        // (Task first, so later entities resolve their task references).
        // This must stay inside the re-entrancy guards above — the registry
        // installs no listeners of its own.
        const result = await oneTabAtATime(() => replayRegisteredEntities(queryClient));
        const refused = result?.refused || [];
        if (refused.length) showDeleteToast({ label: refusedNotice(refused), hideUndo: true, duration: 8000 });
      } finally {
        replayInFlightRef.current = false;
        if (replayRequestedRef.current) {
          replayRequestedRef.current = false;
          void handleOnline();
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void handleOnline();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    if (navigator.onLine) {
      void handleOnline();
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [queryClient]);
}
