// @ts-nocheck
/**
 * @file Quick-toggle row for the top of Settings: appearance icon +
 * label + 3-button segmented (System / Light / Dark). One-tap theme
 * change without diving into the Appearance sub-page.
 *
 * The full picker (with the explanatory "Default Appearance" header)
 * still lives in AppearanceSection on the Appearance sub-page; this is
 * the shortcut.
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/ThemeProvider";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export default function QuickThemeToggle() {
  const { appearance, setAppearance, isDark } = useTheme();
  // Icon next to the label flips between sun/moon based on the EFFECTIVE
  // theme — feels more responsive than always showing the same icon.
  const LeadIcon = isDark ? Moon : Sun;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <LeadIcon className="w-5 h-5 text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Appearance
        </span>
      </div>
      <div className="inline-flex rounded-lg border border-slate-100 dark:border-[#303030] bg-slate-50 dark:bg-[#0c0c0c] p-0.5 shrink-0">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setAppearance(value)}
            title={label}
            aria-label={label}
            aria-pressed={appearance === value}
            className={cn(
              "inline-flex items-center justify-center w-9 h-7 rounded-md transition-colors",
              appearance === value
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
