import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveToCache } from '@/lib/offlineCache';
import { registeredCacheKeys, replayRegisteredEntities } from '@/lib/offlineEntityRegistry';

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
 * Hook that:
 * 1. Persists query cache data to localStorage on every data update (catches API fetches + optimistic setQueryData).
 * 2. Replays pending mutations when coming back online.
 * @returns {void}
 */
export function useOfflineData() {
  const queryClient = useQueryClient();
  const replayInFlightRef = useRef(false);
  const replayRequestedRef = useRef(false);

  // Persist to localStorage whenever query data actually changes (API fetches + optimistic setQueryData).
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (!event?.query) return;
      const key = event.query.queryKey[0];
      if (!CACHE_KEYS.includes(key)) return;
      const data = event.query.state.data;
      if (data !== undefined) saveToCache(key, data);
    });

    return unsubscribe;
  }, [queryClient]);

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
        await replayRegisteredEntities(queryClient);
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
