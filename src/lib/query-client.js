import { QueryClient } from '@tanstack/react-query';
import { loadFromCache } from '@/lib/offlineCache';

const SEED_KEYS = ['tasks', 'priorities', 'savedTags', 'deletedTasks', 'integrations', 'notificationSettings'];
const EMPTY_CACHE_VALUES = {
	tasks: [],
	priorities: [],
	savedTags: [],
	deletedTasks: [],
	integrations: [],
	notificationSettings: undefined,
};

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: true,   // pulls latest from server when switching back to the tab (cross-device sync)
			refetchOnMount: true,         // refetch when a page mounts (navigating between pages)
			retry: 1,                     // one retry on transient network errors
			networkMode: 'offlineFirst',
			staleTime: 0,                 // 0 = always refetch from server when online (ensures cross-device sync)
		},
		mutations: {
			networkMode: 'offlineFirst',
		},
	},
});

/**
 * Put a list saved on this device into the query cache as OLD data: shown at
 * once, and still fetched the moment a page asks for it.
 *
 * `updatedAt: 0` is the point. Without it the saved copy counts as fetched
 * just now, and a query that trusts its data for a while (connected calendars:
 * 10 seconds) doesn't ask the server at all. Settings → Calendars, opened
 * within 10 seconds of the page loading, showed the saved copy — or, on a
 * device with none, "Not connected" for a calendar that was connected — until
 * the half-minute poll came round.
 */
function seed(key, data) {
	queryClientInstance.setQueryData([key], data, { updatedAt: 0 });
}

export function syncOfflineQueryCache() {
	for (const key of SEED_KEYS) {
		try {
			const data = loadFromCache(key);
			if (data === undefined || data === null) {
				if (EMPTY_CACHE_VALUES[key] === undefined) {
					queryClientInstance.removeQueries({ queryKey: [key] });
				} else {
					seed(key, EMPTY_CACHE_VALUES[key]);
				}
				continue;
			}
			seed(key, data);
		} catch {
			if (EMPTY_CACHE_VALUES[key] === undefined) continue;
			seed(key, EMPTY_CACHE_VALUES[key]);
		}
	}
}

// Synchronously seed the query cache from localStorage BEFORE any component mounts.
// This prevents the 1-frame skeleton flash when cached data is available.
syncOfflineQueryCache();
