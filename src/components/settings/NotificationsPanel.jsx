// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  customPartsToOffset,
  getBrowserTimeZone,
  getCurrentPushSubscription,
  isPushSupported,
  nativeTimeToTaskTime,
  normalizeNotificationSettings,
  offsetToCustomParts,
  subscribeCurrentDevice,
  taskTimeToNativeTime,
  unsubscribeCurrentDevice,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

const TIMED_PRESETS = [
  { value: "0", label: "At task time" },
  { value: "-10", label: "10 min before" },
  { value: "-15", label: "15 min before" },
  { value: "custom", label: "Custom" },
];

function presetForOffset(offset) {
  return ["0", "-10", "-15"].includes(String(offset)) ? String(offset) : "custom";
}

function SettingRow({ children, className = "" }) {
  return (
    <div className={cn("rounded-lg border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#111111] p-3", className)}>
      {children}
    </div>
  );
}

export default function NotificationsPanel() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const supported = isPushSupported();
  const [permission, setPermission] = useState(() => (supported ? Notification.permission : "unsupported"));
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [timedMode, setTimedMode] = useState("0");
  const [draft, setDraft] = useState(() => normalizeNotificationSettings({}, { defaulted: true }));

  const { data, isLoading, error } = useQuery({
    queryKey: ["notificationSettings"],
    queryFn: () => apiClient.notifications.getSettings(),
  });

  useEffect(() => {
    if (!data?.settings) return;
    const next = normalizeNotificationSettings(data.settings, { defaulted: data.defaulted });
    setDraft(next);
    setTimedMode(presetForOffset(next.timedOffsetMinutes));
  }, [data]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    getCurrentPushSubscription()
      .then((subscription) => {
        if (!cancelled) setDeviceSubscribed(Boolean(subscription));
      })
      .catch(() => {
        if (!cancelled) setDeviceSubscribed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const saveMutation = useMutation({
    mutationFn: (settings) => apiClient.notifications.updateSettings(settings),
    onSuccess: (result) => {
      queryClient.setQueryData(["notificationSettings"], result);
      setStatusMessage("Notification settings saved.");
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      setStatusMessage("");
      if (!supported) throw new Error("This browser does not support Web Push notifications.");
      if (!data?.available || !data?.vapidPublicKey) {
        throw new Error(data?.reason || "Notifications are not configured on this server.");
      }
      let nextPermission = Notification.permission;
      if (nextPermission === "default") {
        nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
      }
      if (nextPermission !== "granted") {
        throw new Error("Browser notification permission was not granted.");
      }
      const subscription = await subscribeCurrentDevice(data.vapidPublicKey);
      await apiClient.notifications.subscribe(subscription.toJSON ? subscription.toJSON() : subscription);
      const nextSettings = {
        ...draft,
        enabled: true,
        timeZone: draft.timeZone || getBrowserTimeZone(),
      };
      const result = await apiClient.notifications.updateSettings(nextSettings);
      return result;
    },
    onSuccess: (result) => {
      setDeviceSubscribed(true);
      queryClient.setQueryData(["notificationSettings"], result);
      setStatusMessage("This device is subscribed.");
    },
    onError: (err) => setStatusMessage(err?.message || "Could not subscribe this device."),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeCurrentDevice();
      if (endpoint) await apiClient.notifications.unsubscribe(endpoint);
    },
    onSuccess: () => {
      setDeviceSubscribed(false);
      setStatusMessage("This device was unsubscribed.");
    },
    onError: (err) => setStatusMessage(err?.message || "Could not unsubscribe this device."),
  });

  const testMutation = useMutation({
    mutationFn: () => apiClient.notifications.sendTest(),
    onSuccess: (result) => setStatusMessage(`Test sent to ${result.sent || 0} device${result.sent === 1 ? "" : "s"}.`),
    onError: (err) => setStatusMessage(err?.message || "Could not send a test notification."),
  });

  const customParts = useMemo(
    () => offsetToCustomParts(draft.timedOffsetMinutes),
    [draft.timedOffsetMinutes]
  );

  const saveDraft = () => {
    saveMutation.mutate({
      ...draft,
      timeZone: draft.timeZone || getBrowserTimeZone(),
    });
  };

  const updateCustomOffset = (patch) => {
    const next = { ...customParts, ...patch };
    setDraft((current) => ({
      ...current,
      timedOffsetMinutes: customPartsToOffset(next),
    }));
  };

  const unavailable = data ? !data.available : false;
  const offline = !online;
  const busy =
    isLoading ||
    saveMutation.isPending ||
    subscribeMutation.isPending ||
    unsubscribeMutation.isPending ||
    testMutation.isPending;

  return (
    <section id="notifications" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          Device reminders for tasks with due dates. Web Push requires browser permission and server VAPID keys.
        </p>
      </div>

      {offline && (
        <p className="rounded-lg border border-amber-100 dark:border-[#4a3512] bg-amber-50 dark:bg-[#1f1809] px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          Offline: saved notification settings are shown from cache. Subscribing this device,
          unsubscribing, test notifications, and server-scheduled reminders need the backend
          and browser push service.
        </p>
      )}

      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Could not load notification settings: {error.message || "network error"}
        </p>
      )}

      <SettingRow className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
              {draft.enabled ? <Bell className="w-4 h-4 text-emerald-500" /> : <BellOff className="w-4 h-4 text-slate-400" />}
              Notifications {draft.enabled ? "on" : "off"}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Permission: {permission}. Device: {deviceSubscribed ? "subscribed" : "not subscribed"}.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={offline}
              onChange={(e) => setDraft((current) => ({ ...current, enabled: e.target.checked }))}
              className="h-4 w-4 accent-slate-900 dark:accent-slate-100"
            />
            Enabled
          </label>
        </div>

        {!supported && (
          <p className="text-xs text-amber-600 dark:text-amber-300">
            This browser does not support Web Push notifications.
          </p>
        )}
        {unavailable && (
          <p className="text-xs text-amber-600 dark:text-amber-300">
            {data?.reason || "Notifications are not configured on this server."}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-2 text-xs"
            disabled={busy || offline || !supported || unavailable || permission === "denied"}
            onClick={() => subscribeMutation.mutate()}
          >
            {subscribeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />}
            {deviceSubscribed ? "Resubscribe device" : "Subscribe this device"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-2 text-xs"
            disabled={busy || offline || !supported || !deviceSubscribed}
            onClick={() => unsubscribeMutation.mutate()}
          >
            <BellOff className="w-3 h-3" />
            Unsubscribe device
          </Button>
        </div>
      </SettingRow>

      <SettingRow className="space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Reminder Timing</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            These are global defaults for every task with a due date.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Timed tasks</label>
          <Select
            value={timedMode}
            disabled={offline}
            onValueChange={(value) => {
              setTimedMode(value);
              if (value !== "custom") {
                setDraft((current) => ({ ...current, timedOffsetMinutes: Number(value) }));
              }
            }}
          >
            <SelectTrigger className="h-9 bg-white dark:bg-[#111111] dark:border-[#343434] text-sm font-medium text-slate-900 dark:text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white dark:bg-[#111111] dark:border-[#343434]">
              {TIMED_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value} className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {timedMode === "custom" && (
            <div className="grid grid-cols-[1fr_5rem_1fr] gap-2">
              <Select
                value={customParts.direction}
                disabled={offline}
                onValueChange={(direction) => updateCustomOffset({ direction })}
              >
                <SelectTrigger className="h-9 bg-white dark:bg-[#111111] dark:border-[#343434] text-xs font-medium text-slate-900 dark:text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#111111] dark:border-[#343434]">
                  <SelectItem value="before">Before</SelectItem>
                  <SelectItem value="after">After</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min="0"
                max="10080"
                value={customParts.amount}
                disabled={offline}
                onChange={(e) => updateCustomOffset({ amount: e.target.value })}
                className="h-9 text-sm"
              />
              <Select
                value={customParts.unit}
                disabled={offline}
                onValueChange={(unit) => updateCustomOffset({ unit })}
              >
                <SelectTrigger className="h-9 bg-white dark:bg-[#111111] dark:border-[#343434] text-xs font-medium text-slate-900 dark:text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#111111] dark:border-[#343434]">
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span>All-day tasks</span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.allDayEnabled}
                disabled={offline}
                onChange={(e) => setDraft((current) => ({ ...current, allDayEnabled: e.target.checked }))}
                className="h-4 w-4 accent-slate-900 dark:accent-slate-100"
              />
              <Input
                type="time"
                value={taskTimeToNativeTime(draft.allDayTime)}
                disabled={offline || !draft.allDayEnabled}
                onChange={(e) => setDraft((current) => ({ ...current, allDayTime: nativeTimeToTaskTime(e.target.value) }))}
                className="h-9 text-sm"
              />
            </div>
          </label>

          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span>Missed reminders</span>
            <Select
              value={String(draft.missedGraceMinutes)}
              disabled={offline}
              onValueChange={(value) => setDraft((current) => ({ ...current, missedGraceMinutes: Number(value) }))}
            >
              <SelectTrigger className="h-9 bg-white dark:bg-[#111111] dark:border-[#343434] text-sm font-medium text-slate-900 dark:text-slate-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-[#111111] dark:border-[#343434]">
                <SelectItem value="0">Skip missed</SelectItem>
                <SelectItem value="30">Last 30 minutes</SelectItem>
                <SelectItem value="120">Last 2 hours</SelectItem>
                <SelectItem value="1440">Last 24 hours</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={draft.includeExternalEvents}
            disabled={offline}
            onChange={(e) => setDraft((current) => ({ ...current, includeExternalEvents: e.target.checked }))}
            className="h-4 w-4 accent-slate-900 dark:accent-slate-100"
          />
          Include read-only Google and Apple calendar events
        </label>
      </SettingRow>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          disabled={busy || offline}
          onClick={saveDraft}
        >
          {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Save notifications
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-2"
          disabled={busy || offline || !deviceSubscribed || unavailable}
          onClick={() => testMutation.mutate()}
        >
          {testMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Send test
        </Button>
      </div>

      {statusMessage && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{statusMessage}</p>
      )}
    </section>
  );
}
