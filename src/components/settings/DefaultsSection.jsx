// @ts-nocheck
/**
 * @file Default View + Navigation Order sections. Combined because both
 * read from / write to the same `navOrder` localStorage key — Default
 * View's dropdown lists items in navOrder order, so a single section
 * file lets them share state without a context.
 *
 * Receives the canonical NAV_OPTIONS list from the parent (defined in
 * Settings.jsx and also consumed by lib/navigation.js).
 */
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_NAV_ORDER, sanitizeNavOrder, sanitizeNavRoute } from "@/lib/navigation";

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
      <section>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Default View</h2>
        <Select value={selectedDefaultNav} onValueChange={saveDefaultNav}>
          <SelectTrigger className="w-48 h-9 bg-white dark:bg-[#111111] dark:border-[#343434] text-sm font-medium text-slate-900 dark:text-slate-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white dark:bg-[#111111] dark:border-[#343434]">
            {navOrder.map((path) => {
              const opt = navOptions.find((o) => o.value === path);
              return opt ? <SelectItem key={opt.value} value={opt.value} className="text-sm font-medium text-slate-900 dark:text-slate-100">{opt.label}</SelectItem> : null;
            })}
          </SelectContent>
        </Select>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Navigation Order</h2>

        <div className="space-y-2">
          {navOrder.map((path, idx) =>
            <div key={path} className="flex items-center gap-3 bg-surface-card border border-border-hairline rounded-xl px-3 py-2.5 hover:border-slate-200 dark:hover:border-[#454545] transition-colors">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveNav(idx, -1)} disabled={idx === 0} className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors">
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button onClick={() => moveNav(idx, 1)} disabled={idx === navOrder.length - 1} className="disabled:opacity-20 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors">
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex-1">{NAV_LABELS[path]}</span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
