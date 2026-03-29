import { QueryClient } from '@tanstack/react-query';

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

// Synchronously seed the query cache from localStorage BEFORE any component mounts.
// This prevents the 1-frame skeleton flash when cached data is available.
const SEED_KEYS = ['tasks', 'priorities', 'savedTags', 'deletedTasks'];
const STORAGE_KEYS = {
	tasks: 'taskflow_offline_tasks',
	priorities: 'taskflow_offline_priorities',
	savedTags: 'taskflow_offline_savedTags',
	deletedTasks: 'taskflow_offline_deletedTasks',
};
for (const key of SEED_KEYS) {
	try {
		const raw = localStorage.getItem(STORAGE_KEYS[key]);
		if (raw) {
			const data = JSON.parse(raw);
			queryClientInstance.setQueryData([key], data);
		}
	} catch {}
}