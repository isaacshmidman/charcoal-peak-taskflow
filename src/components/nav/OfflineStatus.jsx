// @ts-nocheck
/**
 * @file The "you're offline" mark and what it means, shown in the
 * sidebar (and floating above the tab bar on a phone) only while there
 * is no connection.
 */
import { WifiOff } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function OfflineStatus({ className, side = "right", children }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Offline status"
          title="Offline"
          className={cn(
            "inline-flex items-center gap-2.5 rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-night-danger dark:hover:text-red-300",
            className,
          )}
        >
          <WifiOff className="h-[17px] w-[17px] shrink-0" />
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align="end" className="w-72 rounded-lg border-ink-200 bg-surface-card p-3 dark:border-night-line">
        <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">You're offline</p>
        <p className="mt-1 text-xs leading-5 text-ink-500 dark:text-ink-400">
          Everything already on this device can still be read and changed. What you change is kept here and sent as soon as you're back online.
        </p>
        <p className="mt-2 text-xs leading-5 text-ink-500 dark:text-ink-400">
          Connecting or syncing a calendar, and turning notifications on, need a connection.
        </p>
      </PopoverContent>
    </Popover>
  );
}
