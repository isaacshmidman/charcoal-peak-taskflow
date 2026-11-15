// @ts-check
import { useEffect, useState } from "react";
import { addDays } from "date-fns/addDays";
import { startOfDay } from "date-fns/startOfDay";

/**
 * Midnight this morning, kept right: it moves on by itself when the day
 * changes, so a page left open overnight shows the new day's tasks
 * without being reloaded.
 * @returns {Date}
 */
export function useTodayStart() {
  const [todayStart, setTodayStart] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    const nextMidnight = startOfDay(addDays(new Date(), 1));
    const timeout = setTimeout(
      () => setTodayStart(startOfDay(new Date())),
      Math.max(1000, nextMidnight.getTime() - Date.now() + 1000),
    );
    return () => clearTimeout(timeout);
  }, [todayStart]);

  return todayStart;
}
