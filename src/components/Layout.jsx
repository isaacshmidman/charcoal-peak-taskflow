import { Outlet, Link, useLocation } from "react-router-dom";
import { ListTodo, CalendarDays, LayoutGrid, Settings, Sun, WifiOff, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useOfflineData } from "@/hooks/useOfflineData";
import { useAttachmentQueue } from "@/hooks/useAttachmentQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import DeleteToast from "@/components/tasks/DeleteToast";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_NAV_ORDER, sanitizeNavOrder, sanitizeNavRoute } from "@/lib/navigation";

const ALL_NAV_ITEMS = {
  "/Today":     { path: "/Today",     label: "Today",     icon: Sun },
  "/Groupings": { path: "/Groupings", label: "Groupings", icon: LayoutGrid },
  "/Calendar":  { path: "/Calendar",  label: "Calendar",  icon: CalendarDays },
  "/Active":    { path: "/Active",    label: "All Tasks", icon: ListTodo },
  "/Completed": { path: "/Completed", label: "Completed", icon: CheckCircle2 },
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
  const { helpOpen, setHelpOpen } = useGlobalShortcuts();

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
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-black backdrop-blur-xl dark:backdrop-blur-none border-b border-slate-100 dark:border-[#303030]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to={defaultNav} className="flex items-center gap-2.5">
            <img src="/zephyrly-logo.png" alt="Zephyrly" className="w-7 h-7 rounded-lg object-cover" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Zephyrly</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950" : "text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#161616]"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <item.icon className="w-3.5 h-3.5" />
                    {item.label}
                  </span>
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
                    className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-red-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116] transition-colors"
                    aria-label="Offline status"
                    title="Offline"
                  >
                    <WifiOff className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 rounded-lg border-slate-200 dark:border-[#303030] bg-white dark:bg-[#111111] p-3">
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Offline mode</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Cached tasks, priorities, tags, recently deleted items, calendar connection status, and notification settings remain readable.
                      </p>
                    </div>
                    <div className="rounded-md bg-slate-50 dark:bg-[#171717] border border-slate-100 dark:border-[#303030] p-2">
                      <p className="text-[11px] font-medium text-slate-700 dark:text-slate-200">Queued until you reconnect</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Task, priority, tag, and recently deleted edits sync automatically as soon as the app is back online.
                      </p>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
                "w-10 h-10 -mr-1",
                location.pathname === "/Settings"
                  ? "text-slate-900 dark:text-slate-950 bg-slate-100 dark:bg-slate-100"
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#161616]"
              )}
            >
              <Settings className="w-4 h-4 pointer-events-none" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile nav — raised from bottom edge for comfortable thumb reach */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 dark:bg-black backdrop-blur-xl dark:backdrop-blur-none border-t border-slate-100 dark:border-[#303030] px-1 pt-2 pb-5">
        <div className="flex justify-around">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all touch-manipulation flex-1 min-w-0",
                  isActive ? "text-slate-900 dark:text-slate-100 bg-slate-100/80 dark:bg-[#161616]" : "text-slate-400 dark:text-slate-500"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span className="truncate max-w-full">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-28 sm:pb-6">
        <Outlet />
      </main>

      <DeleteToast />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
