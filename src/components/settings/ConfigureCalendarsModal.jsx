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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIntegrationCalendars } from "@/hooks/useIntegrations";
import { Loader2, Lock, Star } from "lucide-react";

// Compact palette used for the per-calendar color swatch popover. We
// expose the same hex tones the priority-color outbound mapping emits
// (see backend/priority-color.js) so what users pick here matches what
// gets pushed back as event-level colors. Brown is omitted — the
// providers don't render it well as a calendar background.
const CALENDAR_COLOR_SWATCHES = [
  "#dc2626", "#ea580c", "#ca8a04", "#15803d", "#1d4ed8",
  "#6d28d9", "#f87171", "#fb923c", "#facc15", "#4ade80",
  "#60a5fa", "#a78bfa", "#f472b6", "#2dd4bf", "#22d3ee",
  "#fb7185", "#94a3b8", "#0f172a",
];

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
    setColor,
    settingColor,
  } = useIntegrationCalendars(integrationId, open);
  // Track which row is currently mid-color-update so we can show a
  // per-row spinner on the swatch instead of disabling the whole modal.
  const [colorTargetId, setColorTargetId] = useState(/** @type {string|null} */ (null));

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
      <DialogContent className="max-w-md w-[calc(100vw-2rem)]">
        {/* DialogContent is a CSS Grid; grid items have an intrinsic
            `min-width: auto` ≈ `min-content`, so an unbreakable long
            calendar name (e.g. a 50-char French class title) was blowing
            the modal past `max-w-md`. `min-w-0` on every direct grid
            child opts them into shrinkable behavior; the explicit
            `w-[calc(100vw-2rem)]` cap keeps the modal within the
            viewport on small screens.

            We also wrap the description in `min-w-0 break-words` so a
            very long URL in there can't blow the dialog either. */}
        <DialogHeader className="min-w-0">
          <DialogTitle>Configure calendars</DialogTitle>
          <DialogDescription className="min-w-0 break-words">
            Choose which calendars to sync with Zephyrly. The starred calendar
            receives new tasks created in Zephyrly. Read-only calendars
            (Birthdays, Holidays, etc.) appear as events that can't be edited.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-1 min-w-0">
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
            <ul className="min-w-0 max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
              {rows.map((c) => (
                <li
                  key={c.external_calendar_id}
                  className="flex items-center gap-3 px-3 py-2 min-w-0"
                >
                  {/* Color swatch — solid round dot matching Priority
                      Levels styling. For writable calendars it also
                      doubles as a popover trigger that lets the user
                      change the color on the provider. Read-only
                      calendars render a static dot (no popover). */}
                  {c.writable ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 w-3 h-3 rounded-full ring-1 ring-slate-200 hover:ring-slate-400 transition-shadow disabled:opacity-50 relative"
                          style={{ backgroundColor: c.color_hex || "#94a3b8" }}
                          title="Change calendar color"
                          aria-label="Change calendar color"
                          disabled={settingColor && colorTargetId === c.external_calendar_id}
                        >
                          {settingColor && colorTargetId === c.external_calendar_id && (
                            <Loader2 className="absolute inset-0 m-auto w-2.5 h-2.5 animate-spin text-slate-700" />
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-auto p-2">
                        <div className="grid grid-cols-6 gap-1.5">
                          {CALENDAR_COLOR_SWATCHES.map((hex) => {
                            const isCurrent =
                              (c.color_hex || "").toLowerCase() === hex.toLowerCase();
                            return (
                              <button
                                key={hex}
                                type="button"
                                onClick={async () => {
                                  setColorTargetId(c.external_calendar_id);
                                  try {
                                    await setColor({
                                      externalCalendarId: c.external_calendar_id,
                                      colorHex: hex,
                                    });
                                  } catch {
                                    // Hook surfaces the error in dev tools; we
                                    // intentionally don't toast inside the
                                    // popover (would close it on render). The
                                    // modal stays open so the user can retry.
                                  } finally {
                                    setColorTargetId(null);
                                  }
                                }}
                                className={
                                  "w-6 h-6 rounded-full ring-1 transition-shadow hover:scale-110 " +
                                  (isCurrent
                                    ? "ring-slate-900 ring-2"
                                    : "ring-slate-200 hover:ring-slate-400")
                                }
                                style={{ backgroundColor: hex }}
                                title={hex}
                                aria-label={`Set color ${hex}`}
                              />
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <span
                      className="inline-block w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: c.color_hex || "#94a3b8" }}
                      aria-hidden
                    />
                  )}
                  {/* Title + star get the flex-1 stretchy area; the
                      read-only badge lives in a FIXED-WIDTH slot to the
                      right so the toggle column is column-aligned across
                      all rows (writable rows don't show the badge but
                      reserve its space so the toggle doesn't shift left).

                      `basis-0` is the key bit: without it `flex-1` falls
                      back to `flex-basis: 0%` derived from content
                      intrinsic width, so a long unbreakable name still
                      sized this cell to fit and the modal blew past
                      max-w-md. With basis-0 the cell starts at 0 and
                      grows only into available space — `truncate` then
                      actually fires on overflow. */}
                  <div className="min-w-0 flex-1 basis-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm text-slate-900 truncate flex-1 min-w-0 basis-0">
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
                    </div>
                    {c.description && (
                      <p className="text-[11px] text-slate-400 truncate">
                        {c.description}
                      </p>
                    )}
                  </div>
                  {/* Read-only column: always present (w-20 ≈ width of the
                      badge), so the toggle stays in the same screen-x
                      position regardless of whether this row is writable. */}
                  <div className="w-[5.5rem] shrink-0 flex justify-end">
                    {!c.writable && (
                      <span
                        title="Read-only — events from this calendar can't be edited"
                        className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 px-1 py-0.5 rounded bg-slate-50"
                      >
                        <Lock className="w-2.5 h-2.5" /> read-only
                      </span>
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
