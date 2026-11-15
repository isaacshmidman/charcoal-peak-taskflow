// @ts-nocheck
/**
 * @file The phone's navigation: a bar along the bottom with a word under
 * every icon. The first three places in the person's order get a tab,
 * adding sits in the middle under the thumb, and More holds the rest:
 * the other places, tags, Recently deleted and Settings.
 *
 * The bar is 73px tall (8 + 44 + 20 + the hairline). Pages that fill the
 * screen exactly (the board, Notes, the calendar) subtract that number,
 * so change them together.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Ellipsis, Hash, Plus, Settings, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { navRouteFor, TASK_VIEWS } from "@/lib/navigation";
import { taskPagePath, useTagFilter } from "@/hooks/useTagFilter";
import { cn } from "@/lib/utils";

/** How many places get a tab of their own. */
const TABS = 3;
/** How many tags More lists. */
const TAGS_SHOWN = 6;

const tab = "flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] touch-manipulation transition-colors";
const tabOn = "font-semibold text-ink-900 dark:text-ink-50";
const tabOff = "font-medium text-ink-400 dark:text-ink-500";
const moreRow = "flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm text-ink-700 dark:text-ink-200";

export default function PhoneTabs({ items, counts, tagsTo = "/Active", onAdd, addLabel }) {
  const { pathname, search } = useLocation();
  const tag = useTagFilter();
  const [moreOpen, setMoreOpen] = useState(false);

  // Going anywhere closes More.
  useEffect(() => { setMoreOpen(false); }, [pathname, search]);

  const current = navRouteFor(pathname);
  const tabs = items.slice(0, TABS);
  const others = items.slice(TABS);
  const onTaskPage = TASK_VIEWS.some((view) => view.path === pathname);
  const inMore = !tabs.some((item) => item.path === current);

  const renderTab = (item) => {
    const active = current === item.path;
    return (
      <Link
        key={item.path}
        to={item.to}
        onClick={() => window.dispatchEvent(new Event(`navClicked:${item.path}`))}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(tab, active ? tabOn : tabOff)}
      >
        <item.icon className="h-5 w-5" />
        <span className="max-w-full truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      data-testid="phone-tabs"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-hairline bg-surface-page/95 px-2 pb-5 pt-2 backdrop-blur-xl sm:hidden"
    >
      <div className="grid grid-cols-5 items-center">
        {tabs.slice(0, 2).map(renderTab)}
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground touch-manipulation transition-transform active:scale-95"
        >
          <Plus className="h-5 w-5" />
        </button>
        {tabs.slice(2).map(renderTab)}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="More" className={cn(tab, inMore || moreOpen ? tabOn : tabOff)}>
              <Ellipsis className="h-5 w-5" />
              <span>More</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={12}
            className="max-h-[70dvh] w-60 overflow-y-auto rounded-xl border-border-hairline bg-surface-card p-1.5"
          >
            {others.map((item) => (
              <Link
                key={item.path}
                to={item.to}
                // As with a tab: the place you're already in goes back to its top level.
                onClick={() => window.dispatchEvent(new Event(`navClicked:${item.path}`))}
                aria-label={item.label}
                className={cn(moreRow, current === item.path && !tag && "bg-selected font-medium")}
              >
                <item.icon className="h-[18px] w-[18px] text-ink-500 dark:text-ink-400" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {counts.byPath[item.path] > 0 && <span className="text-xs tabular-nums text-ink-400 dark:text-ink-500">{counts.byPath[item.path]}</span>}
              </Link>
            ))}
            {counts.tags.length > 0 && (
              <>
                <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-ink-400 dark:text-ink-500">Tags</p>
                {counts.tags.slice(0, TAGS_SHOWN).map(({ tag: name, count }) => (
                  <Link
                    key={name}
                    to={taskPagePath(tagsTo, name)}
                    aria-label={`Tag ${name}`}
                    className={cn(moreRow, onTaskPage && tag === name && "bg-selected font-medium")}
                  >
                    <Hash className="h-4 w-4 text-ink-400 dark:text-ink-500" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {count > 0 && <span className="text-xs tabular-nums text-ink-400 dark:text-ink-500">{count}</span>}
                  </Link>
                ))}
              </>
            )}
            <div className="my-1.5 h-px bg-border-hairline" />
            <Link to="/RecentlyDeleted" className={cn(moreRow, pathname === "/RecentlyDeleted" && "bg-selected font-medium")}>
              <Trash2 className="h-[18px] w-[18px] text-ink-500 dark:text-ink-400" />
              Recently deleted
            </Link>
            <Link
              to="/Settings"
              onClick={() => window.dispatchEvent(new Event("settingsNavClicked"))}
              className={cn(moreRow, pathname === "/Settings" && "bg-selected font-medium")}
            >
              <Settings className="h-[18px] w-[18px] text-ink-500 dark:text-ink-400" />
              Settings
            </Link>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
