// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIntegrationCalendars } from "@/hooks/useIntegrations";
import { Loader2, Lock, Star } from "lucide-react";

/**
 * Configure-which-calendars modal for an integration.
 * Lists every calendar exposed by the provider with a per-row toggle.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   integration: { id: string, provider: string, external_account_email?: string } | null,
 * }} props
 */
export default function ConfigureCalendarsModal({ open, onOpenChange, integration }) {
  const integrationId = integration?.id || null;
  const {
    calendars,
    isLoading,
    isFetching,
    error,
    refetch,
    setCalendars,
    saving,
    setPrimary,
    settingPrimary,
  } = useIntegrationCalendars(integrationId, open);

  // Local override of sync_enabled so toggling feels instant.
  const [overrides, setOverrides] = useState(/** @type {Record<string, boolean>} */ ({}));

  // Reset overrides whenever the modal reopens for a different integration.
  useEffect(() => {
    if (!open) setOverrides({});
  }, [open, integrationId]);

  const rows = useMemo(() => {
    return (calendars || [])
      .map((c) => ({
        ...c,
        enabled: overrides[c.external_calendar_id] ?? !!c.sync_enabled,
      }))
      .sort((a, b) => {
        // Primary first, then writable, then alpha.
        if (a.primary !== b.primary) return a.primary ? -1 : 1;
        if (a.writable !== b.writable) return a.writable ? -1 : 1;
        return (a.summary || "").localeCompare(b.summary || "");
      });
  }, [calendars, overrides]);

  const dirty = useMemo(() => {
    return Object.keys(overrides).some(
      (k) => overrides[k] !== !!(calendars || []).find((c) => c.external_calendar_id === k)?.sync_enabled
    );
  }, [overrides, calendars]);

  const toggle = (extId, next) => {
    setOverrides((o) => ({ ...o, [extId]: next }));
  };

  const handleSave = async () => {
    if (!dirty) {
      onOpenChange(false);
      return;
    }
    try {
      await setCalendars(overrides);
      setOverrides({});
      onOpenChange(false);
    } catch (e) {
      // The hook surfaces the error; keep the modal open so the user can retry.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure calendars</DialogTitle>
          <DialogDescription>
            Choose which calendars to sync with Zephyrly. The starred calendar
            receives new tasks created in Zephyrly. Read-only calendars
            (Birthdays, Holidays, etc.) appear as events that can't be edited.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-1">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-6 justify-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading calendars…
            </div>
          ) : error ? (
            <div className="space-y-2 py-3">
              <p className="text-xs text-red-600">
                Couldn't load calendars: {error.message || "network error"}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              No calendars found on this account.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
              {rows.map((c) => (
                <li
                  key={c.external_calendar_id}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0 border border-slate-200"
                    style={{ backgroundColor: c.color_hex || "#94a3b8" }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    {/* Title row needs `min-w-0` on the inner flex so the
                        truncating <p> can actually shrink — without that,
                        `truncate` is a no-op when the badge/star siblings
                        are present and a long name pushes them off-screen
                        (or into the toggle on the right). The badge + star
                        get `shrink-0` so they keep their full width and
                        the name is the only thing that ellipses. */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm text-slate-900 truncate flex-1 min-w-0">
                        {c.summary || c.external_calendar_id}
                      </p>
                      {c.primary ? (
                        <span
                          title="Primary calendar — new tasks land here."
                          className="shrink-0 inline-flex items-center text-amber-500"
                        >
                          <Star className="w-3 h-3 fill-current" />
                        </span>
                      ) : c.writable ? (
                        <button
                          type="button"
                          title="Make this the primary calendar"
                          aria-label="Make primary"
                          onClick={() => setPrimary(c.external_calendar_id)}
                          disabled={settingPrimary}
                          className="shrink-0 inline-flex items-center text-slate-300 hover:text-amber-500 transition-colors disabled:opacity-50"
                        >
                          <Star className="w-3 h-3" />
                        </button>
                      ) : null}
                      {!c.writable && (
                        <span
                          title="Read-only — events from this calendar can't be edited"
                          className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-slate-400 px-1 py-0.5 rounded bg-slate-50"
                        >
                          <Lock className="w-2.5 h-2.5" /> read-only
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="text-[11px] text-slate-400 truncate">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <label className="inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => toggle(c.external_calendar_id, e.target.checked)}
                      className="sr-only peer"
                    />
                    <span className="relative w-9 h-5 rounded-full bg-slate-200 peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-3">
          <p className="text-[11px] text-slate-400">
            {isFetching && !isLoading ? "Refreshing…" : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || isLoading}
              className="gap-1"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {dirty ? "Save" : "Done"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
