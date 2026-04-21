// @ts-nocheck
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Search input that animates its width open/closed, matching the sort menu transition style.
 * Expanded width is ~1.5x the legacy `w-40`.
 *
 * @param {{
 *   open: boolean,
 *   value: string,
 *   onChange: (value: string) => void,
 *   onClose: () => void,
 *   placeholder?: string,
 *   className?: string,
 * }} props
 */
export function AnimatedSearchInput({ open, value, onChange, onClose, placeholder = "Search...", className }) {
  return (
    <Input
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={open}
      onBlur={() => { if (!value) onClose(); }}
      className={cn(
        "h-9 text-sm bg-white border-slate-100 whitespace-nowrap transition-all duration-200 ease-out",
        open ? "w-60 opacity-100 px-3" : "w-0 opacity-0 p-0 border-0",
        className
      )}
    />
  );
}
