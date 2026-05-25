// @ts-nocheck
/**
 * @file Advanced notification options. Rendered as a sub-page of
 * Settings.jsx (same pattern as RecentlyDeleted) — Settings flips a
 * `showAdvancedNotifications` flag and early-returns to this component.
 *
 * Each toggle auto-saves on change (debounced ~500ms via the same
 * mutation used by NotificationsPanel). Features the user's device
 * can't support are shown disabled with a "Not supported on this device"
 * tooltip + label, so the picker stays consistent across devices.
 *
 * Capability detection is best-effort. The shape:
 *   - actions:           `'actions' in Notification.prototype`
 *   - vibrate:           `'vibrate' in Notification.prototype`
 *   - image:             `'image' in Notification.prototype` (not used yet)
 *   - silent toggle:     always supported (silent is universal)
 *   - requireInteraction: always supported on push, but iOS only honors
 *     it on installed PWAs — we still let users toggle.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  getBrowserTimeZone,
  normalizeNotificationSettings,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** Pill toggle, mirrored from NotificationsPanel for visual consistency. */
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

/** A single toggle row in a SettingBox. Greys out when unsupported. */
function OptionRow({ title, description, checked, onChange, disabled, supported = true }) {
  return (
    <div className={cn(
      "flex items-start justify-between gap-3 py-2.5",
      !supported && "opacity-60"
    )}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          {!supported ? "Not supported on this device" : description}
        </p>
      </div>
      <Toggle
        checked={supported && checked}
        disabled={disabled || !supported}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Detect browser capability for the four advanced features that aren't
 * universal. Returns a memo-stable object so re-renders don't reshuffle
 * the disabled state.
 */
function useNotificationCapabilities() {
  return useMemo(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return { actions: false, vibrate: false, image: false, silent: false };
    }
    const proto = Notification.prototype || {};
    return {
      actions: "actions" in proto,
      vibrate: "vibrate" in proto,
      image: "image" in proto,
      silent: "silent" in proto,
    };
  }, []);
}

/**
 * @param {{ onBack: () => void }} props
 */
export default function AdvancedNotificationSettings({ onBack }) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const capabilities = useNotificationCapabilities();
  const [draft, setDraft] = useState(() => normalizeNotificationSettings({}, { defaulted: true }));
  const [statusMessage, setStatusMessage] = useState("");
  const userTouchedRef = useRef(false);

  const { data } = useQuery({
    queryKey: ["notificationSettings"],
    queryFn: () => apiClient.notifications.getSettings(),
  });

  useEffect(() => {
    if (!data?.settings) return;
    setDraft(normalizeNotificationSettings(data.settings, { defaulted: data.defaulted }));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (settings) => apiClient.notifications.updateSettings(settings),
    onSuccess: (result) => {
      queryClient.setQueryData(["notificationSettings"], result);
      setStatusMessage("Saved.");
    },
    onError: (err) => setStatusMessage(err?.message || "Could not save settings."),
  });

  // Debounced auto-save (same 500ms cadence as the main panel).
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

  const patch = (changes) => {
    userTouchedRef.current = true;
    setStatusMessage("");
    setDraft((current) => ({ ...current, ...changes }));
  };

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          onClick={onBack}
          aria-label="Back to Settings"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Advanced Notification Settings</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            Fine-tune how reminders behave on this account. Per-device limits show up in grey.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#111111] px-4 py-1 divide-y divide-slate-100 dark:divide-[#303030]">
        <OptionRow
          title="Persistence"
          description="Notifications stay visible until you dismiss them."
          checked={draft.requireInteraction}
          onChange={(next) => patch({ requireInteraction: next })}
          disabled={!online}
        />
        <OptionRow
          title="Vibration"
          description="Vibrate the device when a notification arrives."
          checked={draft.vibrate}
          onChange={(next) => patch({ vibrate: next })}
          disabled={!online}
          supported={capabilities.vibrate}
        />
        <OptionRow
          title="Preview"
          description="Include the task description in the notification body."
          checked={draft.showDescription}
          onChange={(next) => patch({ showDescription: next })}
          disabled={!online}
        />
        <OptionRow
          title="Mute sound"
          description="Send notifications silently — no chime."
          checked={draft.silent}
          onChange={(next) => patch({ silent: next })}
          disabled={!online}
          supported={capabilities.silent}
        />
        <OptionRow
          title="Snooze button"
          description="Add a “Snooze 10m” button to the notification (opens the app)."
          checked={draft.snoozeAction}
          onChange={(next) => patch({ snoozeAction: next })}
          disabled={!online}
          supported={capabilities.actions}
        />
        <OptionRow
          title="Mark done button"
          description="Add a “Mark done” button to the notification (opens the app)."
          checked={draft.doneAction}
          onChange={(next) => patch({ doneAction: next })}
          disabled={!online}
          supported={capabilities.actions}
        />
      </div>

      {statusMessage && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{statusMessage}</p>
      )}
    </div>
  );
}
