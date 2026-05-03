// @ts-nocheck
import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Search input that animates its width open/closed, matching the sort menu transition style.
 * Expanded width is ~1.5x the legacy `w-40`, but capped on small viewports so it never pushes
 * the other header icons off-screen.
 *
 * Close triggers (all animate):
 *   - Pressing the external toggle button (button sets `open` to false in the parent).
 *   - Blurring the empty input.
 *   - Clicking/tapping anywhere outside the input AND outside any element marked
 *     `data-search-toggle` (so the toggle button can own its own close path).
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
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      const target = event.target;
      if (!target || !(target instanceof Node)) return;
      if (wrapperRef.current && wrapperRef.current.contains(target)) return;
      // Clicking the external toggle button is handled by the button itself
      if (target instanceof Element && target.closest("[data-search-toggle]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open, onClose]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "transition-all duration-200 ease-out",
        open
          ? "w-[min(15rem,calc(100vw-14rem))] sm:w-60 opacity-100"
          : "w-0 opacity-0"
      )}
    >
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={open}
        tabIndex={open ? 0 : -1}
        className={cn(
          "h-9 w-full text-sm bg-white dark:bg-[#0c0c0c] border-slate-100 dark:border-[#303030] whitespace-nowrap",
          open ? "px-3" : "p-0 border-0",
          className
        )}
      />
    </div>
  );
}
