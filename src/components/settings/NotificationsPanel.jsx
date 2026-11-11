// @ts-nocheck
/**
 * @file Notifications settings.
 *
 * Structure (rows on shared surfaces, like the rest of Settings):
 *   1. The master "Notifications" switch. When off, the rest of the
 *      panel is hidden.
 *   2. (when on) "This device": allow reminders here, or turn them off.
 *   3. (when on) "When to remind": timed-task offset, all-day reminder
 *      time, missed-reminder grace window, and whether events from
 *      connected calendars get reminders too (off and greyed when no
 *      calendar is connected).
 *   4. (when on) "Advanced": a row that opens a sub-page managed by
 *      Settings.jsx.
 *
 * All settings auto-save on change (debounced ~500ms). No explicit
 * Save button. A small "Saved." status line appears after each commit.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TimeInput from "@/components/tasks/TaskForm/TimeInput.jsx";
import SettingsToggle from "@/components/settings/SettingsToggle";
import { SettingRow, SettingsLink, SettingsSection, settingsHint } from "@/components/settings/parts";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useIntegrationsConnected } from "@/hooks/useIntegrations";
import {
  customPartsToOffset,
  getBrowserTimeZone,
  getCurrentPushSubscription,
  isPushSupported,
  normalizeNotificationSettings,
  offsetToCustomParts,
  subscribeCurrentDevice,
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

/**
 * @param {{ onOpenAdvanced?: () => void }} props
 */
export default function NotificationsPanel({ onOpenAdvanced }) {
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
    <section id="notifications" className="space-y-6">
      {offline && (
        <p className="rounded-lg border border-amber-100 dark:border-night-warn-line bg-amber-50 dark:bg-night-warn px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          Offline: notification settings will save when you reconnect.
        </p>
      )}

      {error && !isLoading && (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Couldn't load notification settings: {error.message || "network error"}
        </p>
      )}

      {/* ── Master switch, and this device ──────────────────────── */}
      <div className="ds-list">
        <div className="flex min-h-[3.25rem] items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {draft.enabled ? (
              <Bell className="h-5 w-5 shrink-0 text-ink-700 dark:text-ink-200" />
            ) : (
              <BellOff className="h-5 w-5 shrink-0 text-ink-400 dark:text-ink-500" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900 dark:text-ink-100">Notifications</p>
              <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">Reminders for tasks with a date</p>
            </div>
          </div>
          <SettingsToggle
            label="Notifications"
            checked={draft.enabled}
            disabled={offline}
            onChange={(next) => patchDraft({ enabled: next })}
          />
        </div>

        {/* This device: one row, whose button depends on whether the
            device is subscribed. A browser that can't do push, a server
            with no keys, or a blocked permission says so instead. */}
        {draft.enabled && (
          !supported ? (
            <p className="px-4 py-3 text-xs text-amber-600 dark:text-amber-300">
              This browser doesn't support push notifications.
            </p>
          ) : unavailable ? (
            <p className="px-4 py-3 text-xs text-amber-600 dark:text-amber-300">
              {data?.reason || "Notifications aren't configured on this server."}
            </p>
          ) : permission === "denied" ? (
            <p className="px-4 py-3 text-xs text-amber-600 dark:text-amber-300">
              Notifications are blocked in this browser. Allow them in the browser's site settings to continue.
            </p>
          ) : (
            <SettingRow
              label="This device"
              hint={deviceSubscribed ? "Gets your reminders" : "Doesn't get reminders yet"}
            >
              {deviceSubscribed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-night-danger dark:hover:text-red-200"
                  disabled={deviceBusy || offline}
                  onClick={() => unsubscribeMutation.mutate()}
                >
                  {unsubscribeMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Turn off here
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={deviceBusy || offline}
                  onClick={() => subscribeMutation.mutate()}
                >
                  {subscribeMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Allow on this device
                </Button>
              )}
            </SettingRow>
          )
        )}
      </div>

      {/* ── When, and what about: only while notifications are on ── */}
      {draft.enabled && (
        <>
          <SettingsSection label="When to remind">
            <div className="ds-list">
              <SettingRow label="Timed tasks">
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
                  <SelectTrigger className="w-40" aria-label="When to remind about timed tasks">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMED_PRESETS.map((preset) => (
                      <SelectItem key={preset.value} value={preset.value}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>

              {timedMode === "custom" && (
                <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 px-4 py-2.5">
                  <Input
                    type="number"
                    min="0"
                    max="10080"
                    value={customParts.amount}
                    disabled={offline}
                    onChange={(e) => updateCustomOffset({ amount: e.target.value })}
                    aria-label="How long"
                  />
                  <Select
                    value={customParts.unit}
                    disabled={offline}
                    onValueChange={(unit) => updateCustomOffset({ unit })}
                  >
                    <SelectTrigger aria-label="Unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={customParts.direction}
                    disabled={offline}
                    onValueChange={(direction) => updateCustomOffset({ direction })}
                  >
                    <SelectTrigger aria-label="Before or after">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before">Before</SelectItem>
                      <SelectItem value="after">After</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <SettingRow label="All-day tasks" hint={draft.allDayEnabled ? "A reminder on the day, at this time" : "No reminder"}>
                <div className={cn((!draft.allDayEnabled || offline) && "pointer-events-none opacity-40")}>
                  <TimeInput
                    value={draft.allDayTime || "9:00AM"}
                    onChange={(value) => patchDraft({ allDayTime: value })}
                  />
                </div>
                <SettingsToggle
                  label="Remind me about all-day tasks"
                  checked={!!draft.allDayEnabled}
                  disabled={offline}
                  onChange={(on) => patchDraft({ allDayEnabled: on })}
                />
              </SettingRow>

              <SettingRow label="Missed reminders" hint="If this device was off when one was due">
                <Select
                  value={String(draft.missedGraceMinutes)}
                  disabled={offline}
                  onValueChange={(value) => patchDraft({ missedGraceMinutes: Number(value) })}
                >
                  <SelectTrigger className="w-40" aria-label="Missed reminders">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Skip them</SelectItem>
                    <SelectItem value="30">Up to 30 min late</SelectItem>
                    <SelectItem value="120">Up to 2 hours late</SelectItem>
                    <SelectItem value="1440">Up to a day late</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow
                label="Calendar events"
                hint={
                  calendarsConnected
                    ? "Also remind me about events from Google and Apple calendars"
                    : "Connect a calendar in Settings → Calendars to use this"
                }
                className={cn(!calendarsConnected && "opacity-60")}
              >
                <SettingsToggle
                  label="Remind me about calendar events"
                  checked={!!(draft.includeExternalEvents && calendarsConnected)}
                  disabled={offline || !calendarsConnected}
                  onChange={(on) => patchDraft({ includeExternalEvents: on })}
                />
              </SettingRow>
            </div>
          </SettingsSection>

          {onOpenAdvanced && (
            <div className="ds-list">
              <SettingsLink
                icon={SlidersHorizontal}
                label="Advanced"
                subtitle="Sound, vibration, and the buttons on a reminder"
                onClick={onOpenAdvanced}
              />
            </div>
          )}
        </>
      )}

      {statusMessage && (
        <p className={settingsHint}>{statusMessage}</p>
      )}
    </section>
  );
}
