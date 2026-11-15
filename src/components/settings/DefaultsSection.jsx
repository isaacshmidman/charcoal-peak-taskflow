// @ts-nocheck
/**
 * @file The Appearance page: how Zephyrly looks, how it opens, and the
 * order of its places.
 *
 *   Theme                 three pictures of the app: system, light, dark
 *   When Zephyrly opens   the page it starts on, and the view each place
 *                         with more than one view (Tasks, Calendar) opens in
 *   Order of places       the sidebar's order, which is also the phone's
 *
 * All of it is kept on this device (localStorage), so a phone and a
 * laptop can each open their own way. The theme goes through
 * ThemeProvider; the start page and Tasks' view through lib/navigation,
 * which tells the navigation at once; the calendar's view is the
 * `defaultCalendarView` key the Calendar page reads when it opens.
 */
import { useState } from "react";
import { Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DEFAULT_NAV_ORDER,
  NAV_LABELS,
  TASKS_VIEW_OPTIONS,
  readStartSettings,
  sanitizeNavOrder,
  saveStartSettings,
} from "@/lib/navigation";
import { useTheme } from "@/lib/ThemeProvider";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "@/components/nav/useNav";
import { ReorderButtons, SettingRow, SettingsSection, settingsHint, settingsTag } from "./parts";

/** How many places fit on the phone's tab bar (components/nav/PhoneTabs.jsx). */
const PHONE_TABS = 3;

const CALENDAR_VIEWS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const THEMES = [
  { value: "system", label: "System", says: "Matches device" },
  { value: "light", label: "Light", says: "Always light" },
  { value: "dark", label: "Dark", says: "Always dark" },
];

function getSavedNavOrder() {
  try {
    const saved = localStorage.getItem("navOrder");
    if (saved) return sanitizeNavOrder(JSON.parse(saved));
  } catch { /* unreadable: the default order */ }
  return DEFAULT_NAV_ORDER;
}

function getSavedCalendarView() {
  try {
    const saved = localStorage.getItem("defaultCalendarView");
    if (CALENDAR_VIEWS.some((view) => view.value === saved)) return saved;
  } catch { /* unreadable: month */ }
  return "month";
}

/**
 * A small picture of the app in one theme: the sidebar, a title, three
 * tasks, one of them done. Its colours are the theme's own and stay put
 * whichever theme the page around it is in, which is the point of it.
 */
function ThemePicture({ dark }) {
  const line = dark ? "bg-night-high" : "bg-ink-200";
  const ring = dark ? "border-night-line-bold" : "border-ink-300";
  return (
    <span aria-hidden className={cn("flex h-full min-w-0 flex-1", dark ? "bg-night-base" : "bg-ink-50")}>
      <span className={cn("flex w-[32%] shrink-0 flex-col gap-[5px] border-r p-1.5", dark ? "border-night-line bg-night-sunken" : "border-ink-200 bg-ink-100")}>
        <span className="h-2 w-2 rounded-[3px] bg-sun-400" />
        <span className={cn("h-1 w-full rounded-full", dark ? "bg-night-line-strong" : "bg-ink-300")} />
        <span className={cn("h-1 w-4/5 rounded-full", line)} />
        <span className={cn("h-1 w-full rounded-full", line)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[5px] p-1.5">
        <span className={cn("h-1.5 w-2/5 rounded-full", dark ? "bg-ink-200" : "bg-ink-800")} />
        <span className={cn("mt-0.5 flex flex-col gap-1 rounded-[5px] border p-1", dark ? "border-night-line bg-night-card" : "border-ink-200 bg-white")}>
          {[0, 1, 2].map((row) => (
            <span key={row} className="flex items-center gap-1">
              <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", row === 0 ? "bg-sun-400" : cn("border", ring))} />
              <span className={cn("h-1 rounded-full", line, row === 1 ? "w-3/5" : "w-4/5")} />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export default function DefaultsSection() {
  const { appearance, setAppearance } = useTheme();
  const [navOrder, setNavOrder] = useState(getSavedNavOrder);
  const [start, setStart] = useState(readStartSettings);
  const [calendarView, setCalendarView] = useState(getSavedCalendarView);

  const moveNav = (idx, dir) => {
    const reordered = [...navOrder];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= reordered.length) return;
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setNavOrder(reordered);
    try { localStorage.setItem("navOrder", JSON.stringify(reordered)); } catch { /* lasts for this visit */ }
    window.dispatchEvent(new Event("navOrderChanged"));
  };

  const saveCalendarView = (value) => {
    const next = CALENDAR_VIEWS.some((view) => view.value === value) ? value : "month";
    setCalendarView(next);
    try { localStorage.setItem("defaultCalendarView", next); } catch { /* lasts for this visit */ }
  };

  return (
    <>
      <SettingsSection label="Theme">
        <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {THEMES.map((theme) => {
            const chosen = appearance === theme.value;
            return (
              <button
                key={theme.value}
                type="button"
                aria-pressed={chosen}
                aria-label={`${theme.label} theme`}
                data-testid={`theme-${theme.value}`}
                onClick={() => setAppearance(theme.value)}
                className={cn(
                  "group flex min-w-0 flex-col rounded-xl border bg-surface-card p-1.5 text-left outline-none transition-colors",
                  chosen
                    ? "border-ink-900 dark:border-sun-400"
                    : "border-border-hairline hover:border-ink-300 focus-visible:border-ink-400 dark:hover:border-night-line-bold dark:focus-visible:border-ink-500",
                )}
              >
                <span className="flex h-[4.5rem] overflow-hidden rounded-lg border border-border-hairline sm:h-20">
                  {theme.value === "system" ? (
                    <>
                      <ThemePicture dark={false} />
                      <ThemePicture dark />
                    </>
                  ) : (
                    <ThemePicture dark={theme.value === "dark"} />
                  )}
                </span>
                <span className="flex items-start justify-between gap-1.5 px-1 pb-0.5 pt-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-900 dark:text-ink-100">{theme.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">{theme.says}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                      chosen ? "bg-ink-900 text-ink-50 dark:bg-sun-400 dark:text-ink-950" : "border border-border-strong",
                    )}
                  >
                    {chosen && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        label="When Zephyrly opens"
        footnote="Tasks and Calendar open in the view chosen here from the sidebar, the phone's tabs and the keyboard. The switch at the top of each page still changes the view."
      >
        <div className="ds-list">
          <SettingRow label="Start page">
            <Select value={start.start} onValueChange={(value) => setStart(saveStartSettings({ start: value }))}>
              <SelectTrigger className="w-36" aria-label="Start page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {navOrder.map((path) => (
                  <SelectItem key={path} value={path}>{NAV_LABELS[path]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Tasks opens as">
            <Select value={start.tasksView} onValueChange={(value) => setStart(saveStartSettings({ tasksView: value }))}>
              <SelectTrigger className="w-36" aria-label="Tasks opens as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASKS_VIEW_OPTIONS.map((view) => (
                  <SelectItem key={view.value} value={view.value}>{view.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Calendar opens as">
            <Select value={calendarView} onValueChange={saveCalendarView}>
              <SelectTrigger className="w-36" aria-label="Calendar opens as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALENDAR_VIEWS.map((view) => (
                  <SelectItem key={view.value} value={view.value}>{view.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </SettingsSection>

      <SettingsSection
        label="Order of places"
        hint={`The sidebar lists them in this order. On a phone the first ${PHONE_TABS === 3 ? "three" : PHONE_TABS} are the tabs along the bottom, and the rest are under More.`}
      >
        <div className="ds-list" data-testid="nav-order">
          {navOrder.map((path, idx) => {
            const Icon = NAV_ICONS[path];
            return (
              <div key={path} className="flex min-h-[2.75rem] items-center gap-3 py-1.5 pl-4 pr-2">
                {Icon ? <Icon className="h-[18px] w-[18px] shrink-0 text-ink-500 dark:text-ink-400" /> : null}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900 dark:text-ink-100">{NAV_LABELS[path]}</span>
                {idx < PHONE_TABS && <span className={settingsTag}>Phone tab</span>}
                <ReorderButtons
                  name={NAV_LABELS[path] || path}
                  onUp={() => moveNav(idx, -1)}
                  onDown={() => moveNav(idx, 1)}
                  first={idx === 0}
                  last={idx === navOrder.length - 1}
                />
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <p className={settingsHint}>Everything on this page is kept on this device, so a phone and a laptop can each look and open their own way.</p>
    </>
  );
}
