// @ts-nocheck
import { useEffect, useState, useMemo } from "react";
import {
  getCalendarOrder,
  getHiddenOnNonCalendarPages,
  subscribeCalendarOrder,
} from "@/lib/calendar-order";

/**
 * Subscribe to live calendar-order + global hidden-set state so a page
 * re-renders when the user changes them in Settings (no route change
 * required).
 */
export function useCalendarOrderState() {
  const [order, setOrder] = useState(getCalendarOrder);
  const [hidden, setHidden] = useState(getHiddenOnNonCalendarPages);

  useEffect(() => {
    const refresh = () => {
      setOrder(getCalendarOrder());
      setHidden(getHiddenOnNonCalendarPages());
    };
    return subscribeCalendarOrder(refresh);
  }, []);

  // Convenience: O(1) index lookup for sort comparators.
  const indexByKey = useMemo(() => {
    const m = new Map();
    order.forEach((k, i) => m.set(k, i));
    return m;
  }, [order]);

  return { order, hidden, indexByKey };
}
