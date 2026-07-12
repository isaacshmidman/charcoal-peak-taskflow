// @ts-nocheck
/**
 * @file Presentational dropdown for QuickAdd token completion. Anchored
 * full-input-width below the input (the TagsField precedent, calmer than
 * caret-mirroring). Selection uses onMouseDown + preventDefault so the
 * input never blurs; keyboard state lives in useTokenCompletion.
 */
import { colorDot } from "@/lib/colors";
import { cn } from "@/lib/utils";

export default function TokenAutocomplete({ open, items, activeIndex, onHover, onSelect }) {
  if (!open) return null;
  return (
    <div
      className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface-card border border-border-strong rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto"
      data-testid="quickadd-autocomplete"
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault(); // keep the input focused
            onSelect(item);
          }}
          onMouseEnter={() => onHover(index)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200",
            index === activeIndex && "bg-slate-50 dark:bg-[#161616]"
          )}
        >
          {item.sigil === "!" && (
            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", colorDot[item.color] || colorDot.slate)} />
          )}
          {item.sigil === "#" && (
            <span className="text-slate-400 dark:text-slate-500 shrink-0">#</span>
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
