// @ts-nocheck
/**
 * @file Quick-toggle row for the top of Settings: bell icon + label +
 * pill toggle bound to the user's master `enabled` notification flag.
 * One-tap on/off without diving into the Notifications sub-page.
 *
 * Shares the React-Query cache key `["notificationSettings"]` with
 * NotificationsPanel and AdvancedNotificationSettings, so flipping
 * here updates the toggle in the sub-page immediately (and vice
 * versa).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  getBrowserTimeZone,
  normalizeNotificationSettings,
} from "@/lib/notifications";
import SettingsToggle from "@/components/settings/SettingsToggle";

export default function QuickNotificationsToggle() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();

  const { data } = useQuery({
    queryKey: ["notificationSettings"],
    queryFn: () => apiClient.notifications.getSettings(),
  });

  const settings = normalizeNotificationSettings(
    data?.settings || {},
    { defaulted: !data?.settings }
  );

  const saveMutation = useMutation({
    mutationFn: (next) => apiClient.notifications.updateSettings(next),
    onSuccess: (result) => {
      queryClient.setQueryData(["notificationSettings"], result);
    },
  });

  const toggle = (nextEnabled) => {
    saveMutation.mutate({
      ...settings,
      enabled: nextEnabled,
      timeZone: settings.timeZone || getBrowserTimeZone(),
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        {settings.enabled ? (
          <Bell className="w-5 h-5 text-emerald-500 shrink-0" />
        ) : (
          <BellOff className="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0" />
        )}
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Notifications
        </span>
      </div>
      <SettingsToggle
        checked={settings.enabled}
        disabled={!online || saveMutation.isPending}
        onChange={toggle}
      />
    </div>
  );
}
