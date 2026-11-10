import { Outlet, Link, useLocation } from "react-router-dom";
import { ListTodo, CalendarDays, LayoutGrid, NotebookPen, Settings, Sun, WifiOff, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";
import { useEffect, useState } from "react";
import { useOfflineData } from "@/hooks/useOfflineData";
import { useAttachmentQueue } from "@/hooks/useAttachmentQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import DeleteToast from "@/components/tasks/DeleteToast";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import CommandPalette from "@/components/CommandPalette";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_NAV_ORDER, sanitizeNavOrder, sanitizeNavRoute } from "@/lib/navigation";

const ALL_NAV_ITEMS = {
  "/Today":     { path: "/Today",     label: "Today",     icon: Sun },
  "/Groupings": { path: "/Groupings", label: "Groupings", icon: LayoutGrid },
  "/Calendar":  { path: "/Calendar",  label: "Calendar",  icon: CalendarDays },
  "/Active":    { path: "/Active",    label: "All Tasks", icon: ListTodo },
  "/Completed": { path: "/Completed", label: "Completed", icon: CheckCircle2 },
  "/Notes":     { path: "/Notes",     label: "Notes",     icon: NotebookPen },
};

function getNavItems() {
  try {
    const saved = localStorage.getItem("navOrder");
    if (saved) {
      const order = sanitizeNavOrder(JSON.parse(saved));
      return order.map(p => ALL_NAV_ITEMS[p]).filter(Boolean);
    }
  } catch {}
  return DEFAULT_NAV_ORDER.map(p => ALL_NAV_ITEMS[p]);
}

function getDefaultNav() {
  return sanitizeNavRoute(localStorage.getItem("defaultNav"));
}

export default function Layout() {
  const location = useLocation();
  const [navItems, setNavItems] = useState(getNavItems);
  const [defaultNav, setDefaultNav] = useState(getDefaultNav);
  const online = useOnlineStatus();
  useOfflineData();
  useAttachmentQueue();
  const { helpOpen, setHelpOpen, paletteOpen, setPaletteOpen } = useGlobalShortcuts();

  // Listen for nav order/default changes from Settings
  useEffect(() => {
    const handler = () => { setNavItems(getNavItems()); setDefaultNav(getDefaultNav()); };
    window.addEventListener("navOrderChanged", handler);
    return () => window.removeEventListener("navOrderChanged", handler);
  }, []);

  // No redirect needed here — handled by DefaultRedirect in App.jsx

  return (
    <div className="min-h-screen bg-transparent">
      {/* Top nav */}
      {/* The bar sits on the page wash and takes its colour, so there is
          no line under it: a soft blur is all that separates it from what
          scrolls beneath. */}
      <header className="ds-bar sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to={defaultNav} className="flex items-center gap-2.5">
            <Logo size={26} />
            <span className="text-[15px] font-semibold tracking-tight text-ink-900 dark:text-ink-100">Zephyrly</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  // Tapping the nav icon for the page you're already on
                  // returns to that page's top level — the same gesture
                  // Settings uses to get back to its menu.
                  onClick={() => window.dispatchEvent(new Event(`navClicked:${item.path}`))}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    // Words on a wide screen, icons where there's no room for them.
                    "flex items-center justify-center h-8 w-10 lg:w-auto lg:px-3 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-selected text-ink-900 dark:text-ink-50 font-semibold"
                      : "text-ink-600 dark:text-ink-400 font-medium hover:text-ink-900 dark:hover:text-ink-100 hover:bg-selected"
                  )}
                >
                  <item.icon className="w-[18px] h-[18px] lg:hidden" />
                  <span className="hidden lg:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1">
            {!online && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-red-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-night-danger transition-colors"
                    aria-label="Offline status"
                    title="Offline"
                  >
                    <WifiOff className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 rounded-lg border-ink-200 dark:border-night-line bg-surface-card p-3">
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">Offline mode</p>
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                        Cached tasks, priorities, tags, recently deleted items, calendar connection status, and notification settings remain readable.
                      </p>
                    </div>
                    <div className="rounded-md bg-ink-50 dark:bg-night-raised border border-ink-100 dark:border-night-line p-2">
                      <p className="text-[11px] font-medium text-ink-700 dark:text-ink-200">Queued until you reconnect</p>
                      <p className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5">
                        Task, priority, tag, and recently deleted edits sync automatically as soon as the app is back online.
                      </p>
                    </div>
                    <p className="text-[11px] text-ink-500 dark:text-ink-400">
                      Calendar connect/sync/configuration, push notification subscription/tests, and server-scheduled reminders require an internet connection.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Link
              to="/Settings"
              onClick={() => window.dispatchEvent(new Event("settingsNavClicked"))}
              className={cn(
                "flex items-center justify-center rounded-lg transition-colors",
                "w-9 h-9 -mr-1",
                location.pathname === "/Settings"
                  ? "text-ink-900 dark:text-ink-50 bg-selected"
                  : "text-ink-600 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100 hover:bg-selected"
              )}
            >
              <Settings className="w-4 h-4 pointer-events-none" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile nav — raised from bottom edge for comfortable thumb reach */}
      {/* px-5 keeps the row off the screen edges; the items are square
          tap targets rather than flex-1 cells, so six of them read as a
          tidy row instead of six wide bars butted together. */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-ink-50/90 dark:bg-night-base/90 backdrop-blur-xl border-t border-border-hairline px-5 pt-2 pb-5">
        <div className="flex items-center justify-between">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                title={item.label}
                aria-label={item.label}
                // Same gesture as the desktop nav: tapping the icon for the
                // page you're on returns to that page's top level.
                onClick={() => window.dispatchEvent(new Event(`navClicked:${item.path}`))}
                className={cn(
                  // h-11/w-11 = a 44px tap target, the accessible minimum,
                  // and it keeps the active pill square around the icon
                  // instead of stretching the full width of a cell.
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all touch-manipulation",
                  isActive ? "text-ink-900 dark:text-ink-50 bg-selected" : "text-ink-400 dark:text-ink-500"
                )}
              >
                <item.icon className="w-[22px] h-[22px]" />
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7 pb-28 sm:pb-10">
        <Outlet />
      </main>

      <DeleteToast />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
