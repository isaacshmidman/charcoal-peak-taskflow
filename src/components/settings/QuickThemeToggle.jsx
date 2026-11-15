// @ts-nocheck
/**
 * @file Quick-toggle row for the top of Settings: a sun or moon, the
 * word "Theme", and System / Light / Dark as three buttons. One tap,
 * without opening the Appearance page (which has the same choice as
 * three pictures, in DefaultsSection).
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/ThemeProvider";

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
        <LeadIcon className="w-5 h-5 text-ink-500 dark:text-ink-400 shrink-0" />
        <span className="text-sm font-medium text-ink-900 dark:text-ink-100">
          Theme
        </span>
      </div>
      <div className="ds-seg shrink-0">
        {OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setAppearance(value)}
            title={label}
            aria-label={label}
            aria-pressed={appearance === value}
            className="ds-seg-item w-9 h-7"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
