// @ts-nocheck
/**
 * @file The frame every signed-in page sits in: the sidebar down the
 * left (nav/Sidebar.jsx), or on a phone a tab bar along the bottom
 * (nav/PhoneTabs.jsx), and the page beside or above it.
 *
 * Nothing sits across the top. A page begins with its own header
 * (PageHeader.jsx), which stays put while the page scrolls.
 */
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useOfflineData } from "@/hooks/useOfflineData";
import { useAttachmentQueue } from "@/hooks/useAttachmentQueue";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import DeleteToast from "@/components/tasks/DeleteToast";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import CommandPalette from "@/components/CommandPalette";
import Sidebar from "@/components/nav/Sidebar";
import PhoneTabs from "@/components/nav/PhoneTabs";
import OfflineStatus from "@/components/nav/OfflineStatus";
import { useNavCounts, useNavItems } from "@/components/nav/useNav";
import { emitShortcut, SHORTCUT_EVENTS } from "@/lib/shortcuts";

/**
 * How wide a page may grow. Pages you look across (the calendar, the
 * board, Notes) take the whole width; Home is a grid that stops before
 * its blocks get too wide to read; the rest are a column a line of text
 * can be read across.
 */
const PAGE_WIDTH = {
  "/Calendar": "max-w-[100rem]",
  "/Groupings": "max-w-[100rem]",
  "/Notes": "max-w-[100rem]",
  "/Home": "max-w-7xl",
};

/** Pages that open their own "new" form when asked (the others hand over to Today). */
const ADDS_HERE = new Set(["/Home", "/Today", "/Active", "/Groupings", "/Calendar", "/Notes"]);

function readCollapsed() {
  try {
    return localStorage.getItem("sidebarCollapsed") === "1";
  } catch {
    return false;
  }
}

export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { items, defaultNav } = useNavItems();
  const counts = useNavCounts();
  const online = useOnlineStatus();
  useOfflineData();
  useAttachmentQueue();
  const { helpOpen, setHelpOpen, paletteOpen, setPaletteOpen } = useGlobalShortcuts();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try { localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0"); } catch { /* private mode: just don't remember */ }
  }, [collapsed]);

  // The phone's + button. A page with a form of its own opens it; from
  // anywhere else (Settings, Completed) it goes to Today and opens there.
  const add = () => {
    if (ADDS_HERE.has(pathname)) emitShortcut(SHORTCUT_EVENTS.newTask);
    else navigate("/Today", { state: { newTask: true } });
  };

  return (
    <div className="min-h-screen">
      <Sidebar
        items={items}
        counts={counts}
        defaultNav={defaultNav}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onSearch={() => setPaletteOpen(true)}
        online={online}
      />
      <PhoneTabs items={items} counts={counts} onAdd={add} addLabel={pathname === "/Notes" ? "New note" : "New Task"} />
      {!online && (
        <OfflineStatus
          side="top"
          className="fixed bottom-[85px] left-3 z-40 h-10 w-10 justify-center border border-border-hairline bg-surface-card shadow-pop sm:hidden"
        />
      )}

      {/* The left padding is the sidebar's width (nav/Sidebar.jsx). */}
      <main className={cn("min-w-0 pb-28 sm:pb-10 sm:pl-16", !collapsed && "lg:pl-60")}>
        <div className={cn("mx-auto w-full px-4 sm:px-6", PAGE_WIDTH[pathname] || "max-w-4xl")}>
          <Outlet />
        </div>
      </main>

      <DeleteToast />
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
