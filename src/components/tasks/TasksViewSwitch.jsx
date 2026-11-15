// @ts-nocheck
/**
 * @file List · Board · Completed: the three ways of looking at tasks,
 * as one switch at the top of each of them. They are three addresses
 * (/Active, /Groupings, /Completed) so a link or the Back button lands on
 * the view it meant, but to the person it is one place, Tasks.
 *
 * A tag picked in the sidebar (`?tag=`) stays picked across the switch.
 */
import { Link, useLocation } from "react-router-dom";
import { TASK_VIEWS } from "@/lib/navigation";
import { taskPagePath, useTagFilter } from "@/hooks/useTagFilter";

export default function TasksViewSwitch({ className = "" }) {
  const { pathname } = useLocation();
  const tag = useTagFilter();
  return (
    <nav aria-label="Task views" className={`ds-seg ${className}`}>
      {TASK_VIEWS.map((view) => {
        const on = pathname === view.path;
        return (
          <Link
            key={view.path}
            to={taskPagePath(view.path, tag)}
            data-on={on ? "true" : undefined}
            aria-current={on ? "page" : undefined}
            className="ds-seg-item flex-1 px-3 py-1 text-xs sm:flex-none"
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
