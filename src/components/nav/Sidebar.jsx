// @ts-nocheck
/**
 * @file The sidebar: where everything is, down the left of the screen.
 *
 * From a tablet up it is always there. On a wide screen it shows words
 * and counts and can be folded to a narrow rail of icons; between a
 * phone and a laptop it is always the rail. (A phone gets the tab bar,
 * nav/PhoneTabs.jsx.) Layout.jsx gives the page the matching left
 * padding: the two widths, w-16 and w-60, are repeated there.
 *
 * Top to bottom: the name, search, the places (in the person's order),
 * tags, then Recently deleted and Settings at the foot.
 */
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Hash, PanelLeftClose, PanelLeftOpen, Search, Settings, Trash2 } from "lucide-react";
import Logo from "@/components/Logo";
import OfflineStatus from "@/components/nav/OfflineStatus";
import { navRouteFor, TASK_VIEWS } from "@/lib/navigation";
import { isMacLike } from "@/lib/shortcuts";
import { taskPagePath, useTagFilter } from "@/hooks/useTagFilter";
import { cn } from "@/lib/utils";

/** How many tags show before "Show all". */
const TAGS_SHOWN = 8;

const rest = "text-ink-600 hover:bg-selected hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100";
const chosen = "bg-selected font-semibold text-ink-900 dark:text-ink-50";

export default function Sidebar({ items, counts, defaultNav, collapsed, onToggleCollapsed, onSearch, online }) {
  const { pathname } = useLocation();
  const tag = useTagFilter();
  const onTaskPage = TASK_VIEWS.some((view) => view.path === pathname);
  const activeTag = onTaskPage ? tag : "";
  const [allTags, setAllTags] = useState(false);

  // Words show on a wide screen unless folded; everywhere else, icons.
  const words = collapsed ? "hidden" : "hidden lg:block";
  const row = cn(
    "flex h-8 items-center gap-2.5 rounded-lg text-[13px] transition-colors",
    collapsed ? "mx-auto w-10 justify-center" : "mx-auto w-10 justify-center lg:mx-0 lg:w-auto lg:justify-start lg:px-2.5",
  );

  const tags = counts.tags;
  const shownTags = allTags ? tags : tags.slice(0, TAGS_SHOWN);

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border-hairline bg-surface-page sm:flex",
        collapsed ? "w-16" : "w-16 lg:w-60",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-1 px-3", collapsed ? "justify-center" : "justify-center lg:justify-between")}>
        <Link to={defaultNav} aria-label="Zephyrly" className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1">
          <Logo size={24} />
          <span className={cn("truncate text-[15px] font-semibold tracking-tight text-ink-900 dark:text-ink-100", words)}>Zephyrly</span>
        </Link>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Fold the sidebar"
          title="Fold the sidebar"
          className={cn("h-8 w-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-selected hover:text-ink-900 dark:text-ink-500 dark:hover:text-ink-100", collapsed ? "hidden" : "hidden lg:inline-flex")}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
        {collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Unfold the sidebar"
            title="Unfold the sidebar"
            className={cn(row, rest, "hidden lg:flex")}
          >
            <PanelLeftOpen className="h-[17px] w-[17px] shrink-0" />
          </button>
        )}

        <button
          type="button"
          onClick={onSearch}
          // Not just "Search": that is the name of each page's own search button.
          aria-label="Search everything"
          title="Search everything, or jump to a page"
          className={cn(
            row,
            "mb-2 text-ink-400 dark:text-ink-500",
            collapsed
              ? "hover:bg-selected hover:text-ink-900 dark:hover:text-ink-100"
              : "hover:bg-selected hover:text-ink-900 dark:hover:text-ink-100 lg:border lg:border-border-hairline lg:bg-surface-card lg:hover:border-border-strong lg:hover:bg-surface-card",
          )}
        >
          <Search className="h-[15px] w-[15px] shrink-0" />
          <span className={cn("min-w-0 flex-1 truncate text-left", words)}>Search</span>
          <kbd className={cn("rounded border border-border-hairline px-1 font-sans text-[10px] text-ink-400 dark:text-ink-500", words)}>
            {isMacLike() ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>

        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = !activeTag && navRouteFor(pathname) === item.path;
            const count = counts.byPath[item.path] || 0;
            return (
              <Link
                key={item.path}
                to={item.path}
                // Clicking the place you're already in takes its page back
                // to its top level, as it always has.
                onClick={() => window.dispatchEvent(new Event(`navClicked:${item.path}`))}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={cn(row, active ? chosen : rest)}
              >
                <item.icon className="h-[17px] w-[17px] shrink-0" />
                <span className={cn("min-w-0 flex-1 truncate", words)}>{item.label}</span>
                {count > 0 && (
                  <span data-testid={`nav-count-${item.path.slice(1)}`} className={cn("text-[11px] font-normal tabular-nums text-ink-400 dark:text-ink-500", words)}>
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {tags.length > 0 && (
          <nav aria-label="Tags" className={cn("mt-4 flex-col gap-0.5", collapsed ? "hidden" : "hidden lg:flex")}>
            <p className="px-2.5 pb-1 text-[11px] font-medium text-ink-400 dark:text-ink-500">Tags</p>
            {shownTags.map(({ tag: name, count }) => {
              const active = activeTag === name;
              return (
                <Link
                  key={name}
                  to={taskPagePath(onTaskPage ? pathname : "/Active", name)}
                  aria-label={`Tag ${name}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(row, active ? chosen : rest)}
                >
                  <Hash className="h-[15px] w-[15px] shrink-0 text-ink-400 dark:text-ink-500" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {count > 0 && <span className="text-[11px] font-normal tabular-nums text-ink-400 dark:text-ink-500">{count}</span>}
                </Link>
              );
            })}
            {tags.length > TAGS_SHOWN && (
              <button
                type="button"
                onClick={() => setAllTags((value) => !value)}
                className="mt-0.5 h-7 rounded-lg px-2.5 text-left text-xs text-ink-400 transition-colors hover:text-ink-900 dark:text-ink-500 dark:hover:text-ink-100"
              >
                {allTags ? "Show fewer" : `Show all ${tags.length}`}
              </button>
            )}
          </nav>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border-hairline px-3 py-2.5">
        {!online && (
          <OfflineStatus className={cn(row, "text-[13px]")}>
            <span className={cn("min-w-0 flex-1 truncate text-left", words)}>Offline</span>
          </OfflineStatus>
        )}
        <Link
          to="/RecentlyDeleted"
          aria-label="Recently deleted"
          aria-current={pathname === "/RecentlyDeleted" ? "page" : undefined}
          title="Recently deleted"
          className={cn(row, pathname === "/RecentlyDeleted" ? chosen : rest)}
        >
          <Trash2 className="h-[17px] w-[17px] shrink-0" />
          <span className={cn("min-w-0 flex-1 truncate", words)}>Recently deleted</span>
        </Link>
        <Link
          to="/Settings"
          onClick={() => window.dispatchEvent(new Event("settingsNavClicked"))}
          aria-label="Settings"
          aria-current={pathname === "/Settings" ? "page" : undefined}
          title="Settings"
          className={cn(row, pathname === "/Settings" ? chosen : rest)}
        >
          <Settings className="h-[17px] w-[17px] shrink-0" />
          <span className={cn("min-w-0 flex-1 truncate", words)}>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
