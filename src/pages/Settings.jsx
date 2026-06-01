// @ts-nocheck
/**
 * @file Settings page — iOS-style category cards + two quick-toggle
 * shortcuts at the top.
 *
 * Top-level structure:
 *   1. Header (page title + email + Log out)
 *   2. Quick-toggles card (Appearance segmented + Notifications switch)
 *   3. Five category cards (Appearance / Tasks / Calendars /
 *      Notifications / Data). Tapping a card flips `activeSection`
 *      and the page early-returns to that sub-page; back-arrow on the
 *      sub-page clears `activeSection` and restores the saved scroll
 *      position.
 *
 * Sub-pages:
 *   - "appearance"            → AppearanceSection + DefaultsSection
 *   - "tasks"                 → PrioritiesSection + TagsSection
 *   - "calendars"             → IntegrationsPanel + Default Calendar
 *                                View + Calendar Order
 *   - "notifications"         → NotificationsPanel (Advanced still
 *                                opens from inside it as a sub-sub-page)
 *   - "advancedNotifications" → AdvancedNotificationSettings; back
 *                                arrow returns to "notifications" (not
 *                                main) so the back-stack feels natural
 *   - "recentlyDeleted"       → RecentlyDeleted (renders its own
 *                                chrome; we just route to it)
 *
 * Stays as the implementation file (not a shim under settings/)
 * because it also exports NAV_OPTIONS, consumed by @/lib/navigation.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Bell,
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  LogOut,
  Palette,
  Trash2,
} from "lucide-react";
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
import AdvancedNotificationSettings from "@/components/settings/AdvancedNotificationSettings";
import StorageSection from "@/components/settings/StorageSection";
import FilesSection from "@/components/settings/FilesSection";
import AppearanceSection from "@/components/settings/AppearanceSection";
import DefaultsSection from "@/components/settings/DefaultsSection";
import PrioritiesSection from "@/components/settings/PrioritiesSection";
import TagsSection from "@/components/settings/TagsSection";
import DefaultCalendarViewSection from "@/components/settings/DefaultCalendarViewSection";
import CalendarOrderSection from "@/components/settings/CalendarOrderSection";
import QuickThemeToggle from "@/components/settings/QuickThemeToggle";
import QuickNotificationsToggle from "@/components/settings/QuickNotificationsToggle";
import { cn } from "@/lib/utils";

export const NAV_OPTIONS = [
  { value: "/Active", label: "All Tasks" },
  { value: "/Today", label: "Today" },
  { value: "/Groupings", label: "Groupings" },
  { value: "/Calendar", label: "Calendar" },
  { value: "/Completed", label: "Completed" },
];

// ── Tiny inline UI primitives used only inside this file ─────────

/** Sub-page chrome: back-arrow + title, then children. */
function SubPage({ title, onBack, children }) {
  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
          onClick={onBack}
          aria-label="Back to Settings"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
      </div>
      <div className="space-y-8">
        {children}
      </div>
    </div>
  );
}

/** Top-level category card: icon + label/subtitle + chevron. */
function SettingsCard({ icon: Icon, label, subtitle, onClick, iconClassName }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-white dark:bg-[#111111] border border-slate-100 dark:border-[#303030] rounded-xl px-4 py-3.5 hover:border-slate-200 dark:hover:border-[#454545] transition-colors text-left"
    >
      <Icon className={cn("w-5 h-5 shrink-0", iconClassName || "text-slate-500 dark:text-slate-400")} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
        {subtitle && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default function Settings() {
  /** @type {[null | "appearance" | "tasks" | "calendars" | "notifications" | "advancedNotifications" | "files" | "recentlyDeleted", any]} */
  const [activeSection, setActiveSection] = useState(null);
  const scrollPosRef = useRef(0);
  const pendingScrollRestoreRef = useRef(null);
  const { user, logout } = useAuth();
  const location = useLocation();

  // Deep links from elsewhere in the app:
  //   - Calendar page's "Connect Calendars in Settings" → state.scrollTo === "bottom"
  //   - Google OAuth callback redirect → hash #calendar-integrations
  //   - Notification subscribe-confirmation click → hash #notifications
  // Each maps to the right category sub-page so the user lands where
  // they expected, without scrolling.
  useEffect(() => {
    const scrollTarget = location.state?.scrollTo;
    const hash = (location.hash || "").replace(/^#/, "");
    let next = null;
    if (scrollTarget === "bottom" || scrollTarget === "integrations" || hash === "calendar-integrations" || hash === "integrations") {
      next = "calendars";
    } else if (scrollTarget === "notifications" || hash === "notifications") {
      next = "notifications";
    }
    if (next) setActiveSection(next);
  }, [location.state, location.hash]);

  // Restore scroll when returning to main from any sub-page.
  useLayoutEffect(() => {
    if (activeSection !== null || pendingScrollRestoreRef.current === null) return;
    window.scrollTo({ top: pendingScrollRestoreRef.current, left: 0, behavior: "auto" });
    pendingScrollRestoreRef.current = null;
  }, [activeSection]);

  // Top-nav Settings icon → return to main from any depth.
  useEffect(() => {
    const handler = () => {
      setActiveSection((current) => {
        if (current === null) return current;
        pendingScrollRestoreRef.current = scrollPosRef.current;
        return null;
      });
    };
    window.addEventListener("settingsNavClicked", handler);
    return () => window.removeEventListener("settingsNavClicked", handler);
  }, []);

  // Helpers for card → sub-page navigation.
  const openSection = (id) => {
    scrollPosRef.current = window.scrollY;
    setActiveSection(id);
  };
  const returnToMain = () => {
    pendingScrollRestoreRef.current = scrollPosRef.current;
    setActiveSection(null);
  };

  // ── Sub-page renders (early return, in order of likelihood) ───

  if (activeSection === "appearance") {
    return (
      <SubPage title="Appearance" onBack={returnToMain}>
        <AppearanceSection />
        <DefaultsSection navOptions={NAV_OPTIONS} />
      </SubPage>
    );
  }

  if (activeSection === "tasks") {
    return (
      <SubPage title="Tasks" onBack={returnToMain}>
        <PrioritiesSection />
        <TagsSection />
      </SubPage>
    );
  }

  if (activeSection === "calendars") {
    return (
      <SubPage title="Calendars" onBack={returnToMain}>
        <IntegrationsPanel />
        <DefaultCalendarViewSection />
        <CalendarOrderSection />
      </SubPage>
    );
  }

  if (activeSection === "notifications") {
    return (
      <SubPage title="Notifications" onBack={returnToMain}>
        <NotificationsPanel
          onOpenAdvanced={() => setActiveSection("advancedNotifications")}
        />
      </SubPage>
    );
  }

  if (activeSection === "advancedNotifications") {
    // Back-stack: Advanced → Notifications (not main).
    return (
      <AdvancedNotificationSettings onBack={() => setActiveSection("notifications")} />
    );
  }

  if (activeSection === "files") {
    return (
      <SubPage title="Files" onBack={returnToMain}>
        <FilesSection />
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Storage</h2>
          <StorageSection />
        </div>
      </SubPage>
    );
  }

  if (activeSection === "recentlyDeleted") {
    return (
      <RecentlyDeleted onBack={returnToMain} />
    );
  }

  // ── Main page (cards + quick toggles) ─────────────────────────

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">{user?.email || "..."}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-red-500 dark:text-red-300 border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-[#2a1116] hover:text-red-600 dark:hover:text-red-200 hover:border-red-300 dark:hover:border-red-800 text-sm font-medium shrink-0"
            >
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

      {/* Quick toggles — two rows in one rounded card with a divider */}
      <div className="rounded-xl border border-slate-100 dark:border-[#303030] bg-white dark:bg-[#111111] divide-y divide-slate-100 dark:divide-[#303030]">
        <QuickThemeToggle />
        <QuickNotificationsToggle />
      </div>

      {/* Category cards */}
      <div className="space-y-2">
        <SettingsCard
          icon={Palette}
          label="Appearance"
          subtitle="Theme, default view, navigation order"
          onClick={() => openSection("appearance")}
        />
        <SettingsCard
          icon={CheckSquare}
          label="Tasks"
          subtitle="Priorities and tags"
          onClick={() => openSection("tasks")}
        />
        <SettingsCard
          icon={Calendar}
          label="Calendars"
          subtitle="Connected calendars and display"
          onClick={() => openSection("calendars")}
        />
        <SettingsCard
          icon={Bell}
          label="Notifications"
          subtitle="Reminders for tasks with due dates"
          onClick={() => openSection("notifications")}
        />
        <SettingsCard
          icon={FolderOpen}
          label="Files"
          subtitle="Search attachments and check storage"
          onClick={() => openSection("files")}
        />
        <SettingsCard
          icon={Trash2}
          iconClassName="text-red-400"
          label="Recently Deleted"
          onClick={() => openSection("recentlyDeleted")}
        />
      </div>
    </div>
  );
}
