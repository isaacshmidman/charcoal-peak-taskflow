// @ts-nocheck
/**
 * @file Settings page — composes the section subcomponents under
 * @/components/settings/. Stays as the implementation file (not a shim
 * to a sub-dir) because it also exports `NAV_OPTIONS` consumed by
 * @/lib/navigation.js; keeping it here avoids an explicit re-export
 * dance for that single named symbol.
 *
 * Sections rendered, in order:
 *   AppearanceSection
 *   DefaultsSection       (Default View + Nav Order)
 *   PrioritiesSection
 *   TagsSection
 *   <Recently Deleted trigger — short-circuits the page render>
 *   IntegrationsPanel
 *   DefaultCalendarViewSection
 *   CalendarOrderSection  (renders nothing if no calendars discovered)
 *   NotificationsPanel
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import RecentlyDeleted from "@/pages/RecentlyDeleted";
import IntegrationsPanel from "@/components/settings/IntegrationsPanel";
import NotificationsPanel from "@/components/settings/NotificationsPanel";
import AppearanceSection from "@/components/settings/AppearanceSection";
import DefaultsSection from "@/components/settings/DefaultsSection";
import PrioritiesSection from "@/components/settings/PrioritiesSection";
import TagsSection from "@/components/settings/TagsSection";
import DefaultCalendarViewSection from "@/components/settings/DefaultCalendarViewSection";
import CalendarOrderSection from "@/components/settings/CalendarOrderSection";

export const NAV_OPTIONS = [
  { value: "/Active", label: "All Tasks" },
  { value: "/Today", label: "Today" },
  { value: "/Groupings", label: "Groupings" },
  { value: "/Calendar", label: "Calendar" },
  { value: "/Completed", label: "Completed" },
];

export default function Settings() {
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  const scrollPosRef = useRef(0);
  const pendingScrollRestoreRef = useRef(null);
  const { user, logout } = useAuth();
  const location = useLocation();

  // Scroll to section (e.g. from Calendar page deep link).
  useEffect(() => {
    const id = location.state?.scrollTo;
    if (!id) return;
    if (id === "bottom") {
      // Content may still be loading (queries, lazy images). Re-scroll to the
      // bottom while the document height is still growing, up to ~1.5s.
      let cancelled = false;
      let lastHeight = -1;
      let attempts = 0;
      const maxAttempts = 15;
      const tick = () => {
        if (cancelled) return;
        const h = document.documentElement.scrollHeight;
        window.scrollTo({ top: h, left: 0, behavior: attempts === 0 ? "auto" : "smooth" });
        attempts += 1;
        if (h !== lastHeight && attempts < maxAttempts) {
          lastHeight = h;
          setTimeout(tick, 100);
        }
      };
      requestAnimationFrame(tick);
      return () => { cancelled = true; };
    }
    const el = document.getElementById(id);
    if (el) {
      // Defer so the section has mounted.
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [location.state]);

  useLayoutEffect(() => {
    if (showRecentlyDeleted || pendingScrollRestoreRef.current === null) return;
    window.scrollTo({ top: pendingScrollRestoreRef.current, left: 0, behavior: "auto" });
    pendingScrollRestoreRef.current = null;
  }, [showRecentlyDeleted]);

  // Return to main Settings (restoring scroll) when the top Settings icon is clicked
  useEffect(() => {
    const handler = () => {
      setShowRecentlyDeleted((current) => {
        if (!current) return current;
        pendingScrollRestoreRef.current = scrollPosRef.current;
        return false;
      });
    };
    window.addEventListener("settingsNavClicked", handler);
    return () => window.removeEventListener("settingsNavClicked", handler);
  }, []);

  if (showRecentlyDeleted) {
    return (
      <div>
        <RecentlyDeleted onBack={() => {
          pendingScrollRestoreRef.current = scrollPosRef.current;
          setShowRecentlyDeleted(false);
        }} />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">{user?.email || "..."}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 text-slate-900 dark:text-slate-100 hover:text-red-400 dark:hover:text-red-300 hover:border-red-200 dark:hover:border-red-800 text-sm font-medium shrink-0">
              <LogOut className="w-4 h-4" />
              Log out
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => logout()}>Log out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <AppearanceSection />

      <DefaultsSection navOptions={NAV_OPTIONS} />

      <PrioritiesSection />

      <TagsSection />

      {/* Recently Deleted */}
      <section>
        <button
          onClick={() => { scrollPosRef.current = window.scrollY; setShowRecentlyDeleted(true); }}
          className="w-full flex items-center justify-between bg-white dark:bg-[#111111] border border-slate-100 dark:border-[#303030] rounded-xl px-4 py-3 hover:border-slate-200 dark:hover:border-[#454545] transition-colors"
        >
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-400" />
            Recently Deleted
          </span>
          <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
        </button>
      </section>

      <IntegrationsPanel />

      {/* Calendar-specific config grouped right under the Integrations
          (Connect Google / Apple) panel for a logical flow:
            1. Connect a calendar provider
            2. Pick which calendar view opens by default
            3. Set order + visibility of those calendars on other pages
          Order matches the user's mental model of "set up, then tune". */}
      <DefaultCalendarViewSection />

      <CalendarOrderSection />

      <NotificationsPanel />

    </div>
  );
}
