// @ts-nocheck
/**
 * The account's plan (Basic or Plus) and what it allows, from the server.
 * The app uses it only to show the right thing: every limit is enforced
 * on the server (backend/plans.js). While it hasn't loaded, or offline
 * with nothing cached, the app assumes Plus, so nobody is shown a prompt
 * they don't need; the server still has the last word.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/apiClient";

export const BILLING_KEY = ["billing"];

export function useBilling() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: BILLING_KEY,
    queryFn: () => apiClient.billing.status(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const plan = data?.plan || "plus";
  return {
    billing: data || null,
    isLoading,
    refetch,
    isPlus: plan === "plus",
    isBasic: plan === "basic",
  };
}
