// @ts-nocheck
/**
 * @file The Appearance page: theme and default view on one list, then
 * the navigation order. Default view and the order are together because
 * both read from / write to the same `navOrder` localStorage key — the
 * dropdown lists pages in that order. The theme reads and writes through
 * ThemeProvider (which owns the `appearance` key and the .dark class).
 *
 * Receives the canonical NAV_OPTIONS list from the parent (defined in
 * Settings.jsx and also consumed by lib/navigation.js).
 */
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_NAV_ORDER, sanitizeNavOrder, sanitizeNavRoute } from "@/lib/navigation";
import { useTheme } from "@/lib/ThemeProvider";
import { ReorderButtons, SettingRow, SettingsSection } from "./parts";

const NAV_LABELS = {
  "/Active": "All Tasks",
  "/Today": "Today",
  "/Groupings": "Groupings",
  "/Calendar": "Calendar",
  "/Completed": "Completed",
  "/Notes": "Notes",
};

function getSavedNavOrder() {
  try {
    const saved = localStorage.getItem("navOrder");
    if (saved) return sanitizeNavOrder(JSON.parse(saved));
  } catch {}
  return DEFAULT_NAV_ORDER;
}

export default function DefaultsSection({ navOptions }) {
  const { appearance, setAppearance } = useTheme();
  const [navOrder, setNavOrder] = useState(getSavedNavOrder);
  const [selectedDefaultNav, setSelectedDefaultNav] = useState(() => sanitizeNavRoute(localStorage.getItem("defaultNav")));

  const moveNav = (idx, dir) => {
    const reordered = [...navOrder];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= reordered.length) return;
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setNavOrder(reordered);
    localStorage.setItem("navOrder", JSON.stringify(reordered));
    window.dispatchEvent(new Event("navOrderChanged"));
  };

  const saveDefaultNav = (val) => {
    const nextValue = sanitizeNavRoute(val);
    setSelectedDefaultNav(nextValue);
    localStorage.setItem("defaultNav", nextValue);
    window.dispatchEvent(new Event("navOrderChanged"));
  };

  return (
    <>
      <SettingsSection label="Look and start">
        <div className="ds-list">
          <SettingRow label="Theme">
            <Select value={appearance} onValueChange={setAppearance}>
              <SelectTrigger className="w-36" aria-label="Theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Default view" hint="The page Zephyrly opens on">
            <Select value={selectedDefaultNav} onValueChange={saveDefaultNav}>
              <SelectTrigger className="w-36" aria-label="Default view">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {navOrder.map((path) => {
                  const opt = navOptions.find((o) => o.value === path);
                  return opt ? <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem> : null;
                })}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </SettingsSection>

      <SettingsSection label="Navigation order">
        <div className="ds-list">
          {navOrder.map((path, idx) => (
            <div key={path} className="flex min-h-[2.75rem] items-center gap-3 py-1.5 pl-4 pr-2">
              <span className="min-w-0 flex-1 text-sm font-medium text-ink-900 dark:text-ink-100">{NAV_LABELS[path]}</span>
              <ReorderButtons
                name={NAV_LABELS[path] || path}
                onUp={() => moveNav(idx, -1)}
                onDown={() => moveNav(idx, 1)}
                first={idx === 0}
                last={idx === navOrder.length - 1}
              />
            </div>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}
