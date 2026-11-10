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
 *   - "export"                → ExportSection (download a ZIP of it all,
 *                                or restore one)
 *   - "recentlyDeleted"       → RecentlyDeleted (renders its own
 *                                chrome; we just route to it)
 *
 * Stays as the implementation file (not a shim under settings/)
 * because it also exports NAV_OPTIONS, consumed by @/lib/navigation.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Bell,
  Calendar,
  CheckSquare,
  ChevronRight,
  Download,
  FolderOpen,
  LogOut,
  Palette,
  Plug,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
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
import ExportSection from "@/components/settings/ExportSection";
import ConnectedAppsSection from "@/components/settings/ConnectedAppsSection";
import SessionsSection from "@/components/settings/SessionsSection";
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
  { value: "/Notes", label: "Notes" },
];

// ── Tiny inline UI primitives used only inside this file ─────────

/** Sub-page chrome: back-arrow + title, then children. */
function SubPage({ title, onBack, children }) {
  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title={title} back={onBack} backLabel="Back to Settings" />
      <div className="space-y-8 pt-3">
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
      className="w-full flex items-center gap-3 bg-surface-card px-4 py-3 hover:bg-ink-50 dark:hover:bg-night-raised transition-colors text-left"
    >
      <Icon className={cn("w-5 h-5 shrink-0", iconClassName || "text-ink-500 dark:text-ink-400")} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-900 dark:text-ink-100">{label}</p>
        {subtitle && (
          <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-ink-300 dark:text-ink-600 shrink-0" />
    </button>
  );
}

/** A labelled group of section rows, on one surface. */
function SettingsGroup({ label, children }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-medium text-ink-500 dark:text-ink-400">{label}</h2>
      <div className="ds-list">{children}</div>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default function Settings() {
  /** @type {[null | "appearance" | "tasks" | "calendars" | "notifications" | "advancedNotifications" | "files" | "export" | "recentlyDeleted", any]} */
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
      <SubPage title="Tasks and Notes" onBack={returnToMain}>
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
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100 mb-2">Storage</h2>
          <StorageSection />
        </div>
      </SubPage>
    );
  }

  if (activeSection === "connected") {
    return (
      <SubPage title="Connected apps" onBack={returnToMain}>
        <ConnectedAppsSection />
      </SubPage>
    );
  }

  if (activeSection === "devices") {
    return (
      <SubPage title="Signed-in devices" onBack={returnToMain}>
        <SessionsSection />
      </SubPage>
    );
  }

  if (activeSection === "export") {
    return (
      <SubPage title="Export & restore" onBack={returnToMain}>
        <ExportSection />
      </SubPage>
    );
  }

  if (activeSection === "recentlyDeleted") {
    return (
      <RecentlyDeleted onBack={returnToMain} />
    );
  }

  // ── Main page: quick toggles, then the sections in four groups ──

  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="Settings" sub={user?.email || "..."} />

      <div className="space-y-6 pt-3">
        {/* The two things changed most often, without opening a section. */}
        <Card className="divide-y divide-[var(--border-hairline)]">
          <QuickThemeToggle />
          <QuickNotificationsToggle />
        </Card>

        <SettingsGroup label="How it looks and works">
          <SettingsCard
            icon={Palette}
            label="Appearance"
            subtitle="Theme, default view, navigation order"
            onClick={() => openSection("appearance")}
          />
          <SettingsCard
            icon={CheckSquare}
            label="Tasks and Notes"
            subtitle="Shared priorities and tags"
            onClick={() => openSection("tasks")}
          />
          <SettingsCard
            icon={Bell}
            label="Notifications"
            subtitle="Reminders for tasks with due dates"
            onClick={() => openSection("notifications")}
          />
        </SettingsGroup>

        <SettingsGroup label="Connections">
          <SettingsCard
            icon={Calendar}
            label="Calendars"
            subtitle="Connected calendars and display"
            onClick={() => openSection("calendars")}
          />
          <SettingsCard
            icon={Plug}
            label="Connected apps"
            subtitle="AI apps that can read or change your tasks"
            onClick={() => openSection("connected")}
          />
        </SettingsGroup>

        <SettingsGroup label="Your data">
          <SettingsCard
            icon={FolderOpen}
            label="Files"
            subtitle="Search attachments and check storage"
            onClick={() => openSection("files")}
          />
          <SettingsCard
            icon={Download}
            label="Export & restore"
            subtitle="Download everything as a .zip, or bring one back"
            onClick={() => openSection("export")}
          />
          <SettingsCard
            icon={Trash2}
            label="Recently Deleted"
            subtitle="Bring back or clear what you've deleted"
            onClick={() => openSection("recentlyDeleted")}
          />
        </SettingsGroup>

        <SettingsGroup label="Account">
          <SettingsCard
            icon={ShieldCheck}
            label="Signed-in devices"
            subtitle="Where your account is signed in"
            onClick={() => openSection("devices")}
          />
          {/* Log out is a row like the others, not a red button in the
              header: it is the last thing here, and it asks first. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-3 bg-surface-card px-4 py-3 hover:bg-ink-50 dark:hover:bg-night-raised transition-colors text-left"
              >
                <LogOut className="w-5 h-5 shrink-0 text-ink-500 dark:text-ink-400" />
                <span className="flex-1 text-sm font-medium text-ink-900 dark:text-ink-100">Log out</span>
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Log out of Zephyrly?</AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => logout()}>Log out</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsGroup>
      </div>

      <p className="mt-6 text-center text-xs text-ink-400 dark:text-ink-500" data-testid="settings-legal-links">
        <Link to="/terms" className="underline underline-offset-2 hover:text-ink-600 dark:hover:text-ink-300">
          Terms
        </Link>
        {" · "}
        <Link to="/privacy" className="underline underline-offset-2 hover:text-ink-600 dark:hover:text-ink-300">
          Privacy
        </Link>
      </p>
    </div>
  );
}
