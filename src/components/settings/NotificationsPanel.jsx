// @ts-nocheck
/**
 * @file Notifications settings — full rewrite (post Phase 5).
 *
 * Structure:
 *   1. Bell box: master "Notifications On/Off" toggle. When off, the
 *      rest of the panel is hidden — same pattern as recurring-task
 *      options in TaskForm.
 *   2. (when on) This device box: a single Allow/Block button that
 *      flips based on the device's current subscription state.
 *   3. (when on) Remind me box: timed-task offset, all-day reminder
 *      time, missed-reminder grace window, and an "include read-only
 *      Google/Apple calendar events" checkbox that's auto-disabled
 *      when no calendar integration is connected.
 *
 * All settings auto-save on change (debounced ~500ms). No explicit
 * Save button. A small "Saved." status line appears after each commit.
 * No "Send test" button — the real reminder schedule is the only path.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, ShieldOff, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useIntegrationsConnected } from "@/hooks/useIntegrations";
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
  { value: "-30", label: "30 min before" },
  { value: "-60", label: "1 hour before" },
  { value: "custom", label: "Custom" },
];

function presetForOffset(offset) {
  return ["0", "-10", "-15", "-30", "-60"].includes(String(offset)) ? String(offset) : "custom";
}

function SettingBox({ children, className = "" }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#111111] px-4 py-3",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Pill-style toggle matching the "Set time" toggle pattern in
 * TaskForm/TimeFields.jsx (h-6 w-11 rounded-full, dark/light themed).
 */
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none shrink-0",
        checked ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-200 dark:bg-[#222222]",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-900 shadow transition-transform duration-200",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

export default function NotificationsPanel() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const supported = isPushSupported();
  const calendarsConnected = useIntegrationsConnected();
  const [permission, setPermission] = useState(() => (supported ? Notification.permission : "unsupported"));
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [timedMode, setTimedMode] = useState("0");
  const [draft, setDraft] = useState(() => normalizeNotificationSettings({}, { defaulted: true }));
  // Track whether the user has interacted at least once, so we don't
  // fire an auto-save the moment the panel mounts.
  const userTouchedRef = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["notificationSettings"],
    queryFn: () => apiClient.notifications.getSettings(),
  });

  // Hydrate the local draft from server-loaded settings.
  useEffect(() => {
    if (!data?.settings) return;
    const next = normalizeNotificationSettings(data.settings, { defaulted: data.defaulted });
    setDraft(next);
    setTimedMode(presetForOffset(next.timedOffsetMinutes));
  }, [data]);

  // Look up current device subscription state once on mount.
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
      setStatusMessage("Saved.");
    },
    onError: (err) => setStatusMessage(err?.message || "Could not save settings."),
  });

  // Debounced auto-save: any change to `draft` after the first user
  // interaction queues a save. Cancelled if another change lands within
  // 500ms so rapid edits coalesce into one network round-trip.
  useEffect(() => {
    if (!userTouchedRef.current) return;
    if (!online) return;
    const handle = setTimeout(() => {
      saveMutation.mutate({
        ...draft,
        timeZone: draft.timeZone || getBrowserTimeZone(),
      });
    }, 500);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, online]);

  const patchDraft = (patch) => {
    userTouchedRef.current = true;
    setStatusMessage("");
    setDraft((current) => ({ ...current, ...patch }));
  };

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      setStatusMessage("");
      if (!supported) throw new Error("This browser doesn't support push notifications.");
      if (!data?.available || !data?.vapidPublicKey) {
        throw new Error(data?.reason || "Notifications aren't configured on this server.");
      }
      let nextPermission = Notification.permission;
      if (nextPermission === "default") {
        nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
      }
      if (nextPermission !== "granted") {
        throw new Error("Allow notifications in your browser settings to continue.");
      }
      const subscription = await subscribeCurrentDevice(data.vapidPublicKey);
      await apiClient.notifications.subscribe(subscription.toJSON ? subscription.toJSON() : subscription);
    },
    onSuccess: () => {
      setDeviceSubscribed(true);
      setStatusMessage("This device will now receive notifications.");
    },
    onError: (err) => setStatusMessage(err?.message || "Couldn't enable notifications on this device."),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeCurrentDevice();
      if (endpoint) await apiClient.notifications.unsubscribe(endpoint);
    },
    onSuccess: () => {
      setDeviceSubscribed(false);
      setStatusMessage("This device will no longer receive notifications.");
    },
    onError: (err) => setStatusMessage(err?.message || "Couldn't block notifications on this device."),
  });

  const customParts = useMemo(
    () => offsetToCustomParts(draft.timedOffsetMinutes),
    [draft.timedOffsetMinutes]
  );

  const updateCustomOffset = (patch) => {
    const next = { ...customParts, ...patch };
    patchDraft({ timedOffsetMinutes: customPartsToOffset(next) });
  };

  const offline = !online;
  const unavailable = data ? !data.available : false;
  const deviceBusy = subscribeMutation.isPending || unsubscribeMutation.isPending;

  return (
    <section id="notifications" className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</h2>

      {offline && (
        <p className="rounded-lg border border-amber-100 dark:border-[#4a3512] bg-amber-50 dark:bg-[#1f1809] px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          Offline — notification settings will save when you reconnect.
        </p>
      )}

      {error && !isLoading && (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Couldn't load notification settings: {error.message || "network error"}
        </p>
      )}

      {/* ── Master toggle ───────────────────────────────────────── */}
      <SettingBox className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {draft.enabled ? (
            <Bell className="w-5 h-5 text-emerald-500 shrink-0" />
          ) : (
            <BellOff className="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0" />
          )}
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Notifications {draft.enabled ? "on" : "off"}
          </p>
        </div>
        <Toggle
          checked={draft.enabled}
          disabled={offline}
          onChange={(next) => patchDraft({ enabled: next })}
        />
      </SettingBox>

      {/* ── Device + Remind-me only visible when master is on ──── */}
      {draft.enabled && (
        <>
          {/* This device — one button, label depends on current state.
              Hidden entirely if the browser can't do push or the server
              hasn't been configured with VAPID keys (a real environment
              error the user can't act on from this panel). */}
          {supported && !unavailable && (
            <SettingBox className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {deviceSubscribed ? (
                  <Smartphone className="w-5 h-5 text-emerald-500 shrink-0" />
                ) : (
                  <Smartphone className="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0" />
                )}
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  This device
                </p>
              </div>
              {permission === "denied" ? (
                <p className="text-xs text-amber-600 dark:text-amber-300 max-w-[18rem] text-right">
                  Notifications are blocked at the browser level — re-enable them in your browser's site settings.
                </p>
              ) : deviceSubscribed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 text-xs"
                  disabled={deviceBusy || offline}
                  onClick={() => unsubscribeMutation.mutate()}
                >
                  {unsubscribeMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ShieldOff className="w-3 h-3" />
                  )}
                  Block notifications for this device
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 text-xs"
                  disabled={deviceBusy || offline}
                  onClick={() => subscribeMutation.mutate()}
                >
                  {subscribeMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Bell className="w-3 h-3" />
                  )}
                  Allow notifications for this device
                </Button>
              )}
            </SettingBox>
          )}

          {!supported && (
            <SettingBox>
              <p className="text-xs text-amber-600 dark:text-amber-300">
                This browser doesn't support push notifications.
              </p>
            </SettingBox>
          )}

          {unavailable && supported && (
            <SettingBox>
              <p className="text-xs text-amber-600 dark:text-amber-300">
                {data?.reason || "Notifications aren't configured on this server."}
              </p>
            </SettingBox>
          )}

          {/* Remind me — reminder timing options. */}
          <SettingBox className="space-y-3">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Remind me</p>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Timed tasks</label>
              <Select
                value={timedMode}
                disabled={offline}
                onValueChange={(value) => {
                  userTouchedRef.current = true;
                  setStatusMessage("");
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
                    <SelectItem
                      key={preset.value}
                      value={preset.value}
                      className="text-sm font-medium text-slate-900 dark:text-slate-100"
                    >
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
                    onChange={(e) => patchDraft({ allDayEnabled: e.target.checked })}
                    className="h-4 w-4 accent-slate-900 dark:accent-slate-100"
                  />
                  <Input
                    type="time"
                    value={taskTimeToNativeTime(draft.allDayTime)}
                    disabled={offline || !draft.allDayEnabled}
                    onChange={(e) => patchDraft({ allDayTime: nativeTimeToTaskTime(e.target.value) })}
                    className="h-9 text-sm"
                  />
                </div>
              </label>

              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Missed reminders</span>
                <Select
                  value={String(draft.missedGraceMinutes)}
                  disabled={offline}
                  onValueChange={(value) => patchDraft({ missedGraceMinutes: Number(value) })}
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

            <label
              className={cn(
                "flex items-center gap-2 text-xs font-medium",
                calendarsConnected
                  ? "text-slate-700 dark:text-slate-200 cursor-pointer"
                  : "text-slate-400 dark:text-slate-500 cursor-not-allowed"
              )}
              title={
                calendarsConnected
                  ? undefined
                  : "Connect a Google or Apple calendar in Settings → Integrations to enable this."
              }
            >
              <input
                type="checkbox"
                checked={draft.includeExternalEvents && calendarsConnected}
                disabled={offline || !calendarsConnected}
                onChange={(e) => patchDraft({ includeExternalEvents: e.target.checked })}
                className="h-4 w-4 accent-slate-900 dark:accent-slate-100 disabled:opacity-50"
              />
              Include read-only Google and Apple calendar events
            </label>
          </SettingBox>
        </>
      )}

      {statusMessage && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{statusMessage}</p>
      )}
    </section>
  );
}
