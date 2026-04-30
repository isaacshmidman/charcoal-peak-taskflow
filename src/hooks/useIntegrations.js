// @ts-check
/**
 * React Query hooks for calendar integrations. Handles list/connect/disconnect
 * + manual sync + per-calendar configure. Backed by /api/apps/:appId/integrations.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";

const QUERY_KEY = ["integrations"];

export function useIntegrations() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiClient.integrations.list(),
    // Integrations state rarely changes; poll lightly so "last_synced_at"
    // stays fresh while the Settings/Calendar page is open.
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 10 * 1000,
    retry: false,
  });

  const disconnectMutation = useMutation({
    mutationFn: (/** @type {string} */ id) => apiClient.integrations.disconnect(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const connectAppleMutation = useMutation({
    mutationFn: (/** @type {{ email: string, password: string }} */ creds) =>
      apiClient.integrations.connectApple(creds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (/** @type {string} */ id) => apiClient.integrations.sync(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (/** @type {string} */ id) => apiClient.integrations.setDefault(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    integrations: listQuery.data || [],
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    refetch: listQuery.refetch,
    connectGoogle: (fromUrl) => apiClient.integrations.connectGoogle(fromUrl),
    connectApple: connectAppleMutation.mutateAsync,
    connectingApple: connectAppleMutation.isPending,
    connectAppleError: connectAppleMutation.error,
    disconnect: disconnectMutation.mutateAsync,
    disconnecting: disconnectMutation.isPending,
    sync: syncMutation.mutateAsync,
    syncing: syncMutation.isPending,
    setDefault: setDefaultMutation.mutateAsync,
    settingDefault: setDefaultMutation.isPending,
  };
}

/** Returns true when at least one integration is connected and active. */
export function useIntegrationsConnected() {
  const { integrations } = useIntegrations();
  return integrations.some((i) => i.status === "active");
}

/**
 * Per-integration calendar list (Configure modal).
 *
 * @param {string | null | undefined} integrationId
 * @param {boolean} enabled — gate the query so we only fetch when the modal opens
 */
export function useIntegrationCalendars(integrationId, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = ["integration-calendars", integrationId];

  const listQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.integrations.listCalendars(String(integrationId)),
    enabled: !!integrationId && enabled,
    staleTime: 30 * 1000,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: (/** @type {Record<string, boolean>} */ updates) =>
      apiClient.integrations.setCalendars(String(integrationId), updates),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (/** @type {string} */ externalCalendarId) =>
      apiClient.integrations.setPrimaryCalendar(String(integrationId), externalCalendarId),
    onSuccess: (data) => {
      if (Array.isArray(data?.calendars)) {
        queryClient.setQueryData(queryKey, data.calendars);
      } else {
        queryClient.invalidateQueries({ queryKey });
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  // Set this calendar's color on the provider AND mirror locally.
  // Server returns the refreshed calendar list so the modal repaints
  // without an extra round-trip. Tasks query gets invalidated so the
  // calendar swatches on cards refresh too.
  const setColorMutation = useMutation({
    mutationFn: (/** @type {{ externalCalendarId: string, colorHex: string }} */ args) =>
      apiClient.integrations.setCalendarColor(
        String(integrationId),
        args.externalCalendarId,
        args.colorHex
      ),
    onSuccess: (data) => {
      if (Array.isArray(data?.calendars)) {
        queryClient.setQueryData(queryKey, data.calendars);
      } else {
        queryClient.invalidateQueries({ queryKey });
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return {
    calendars: listQuery.data || [],
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    error: listQuery.error,
    refetch: listQuery.refetch,
    setCalendars: updateMutation.mutateAsync,
    saving: updateMutation.isPending,
    setPrimary: setPrimaryMutation.mutateAsync,
    settingPrimary: setPrimaryMutation.isPending,
    setColor: setColorMutation.mutateAsync,
    settingColor: setColorMutation.isPending,
  };
}
