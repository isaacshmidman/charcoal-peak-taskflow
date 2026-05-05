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

export function syncOfflineQueryCache() {
	for (const key of SEED_KEYS) {
		try {
			const data = loadFromCache(key);
			if (data === undefined || data === null) {
				if (EMPTY_CACHE_VALUES[key] === undefined) {
					queryClientInstance.removeQueries({ queryKey: [key] });
				} else {
					queryClientInstance.setQueryData([key], EMPTY_CACHE_VALUES[key]);
				}
				continue;
			}
			queryClientInstance.setQueryData([key], data ?? EMPTY_CACHE_VALUES[key]);
		} catch {
			if (EMPTY_CACHE_VALUES[key] === undefined) continue;
			queryClientInstance.setQueryData([key], EMPTY_CACHE_VALUES[key]);
		}
	}
}

// Synchronously seed the query cache from localStorage BEFORE any component mounts.
// This prevents the 1-frame skeleton flash when cached data is available.
syncOfflineQueryCache();
