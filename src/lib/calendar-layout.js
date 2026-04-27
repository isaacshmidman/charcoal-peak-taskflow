// @ts-nocheck
import { parseTaskTime } from "@/lib/sort-helpers";

const DEFAULT_DURATION_MIN = 60;

/**
 * Given timed tasks for a single day, assign each a column index +
 * total column count so overlapping blocks render side-by-side.
 * Standard greedy sweep (same algorithm Google Calendar uses).
 *
 * @returns {Array<{task, startMin, endMin, col, cols}>}
 */
export function layoutTimedTasks(tasks) {
  const events = tasks
    .map((t) => {
      const startMin = parseTaskTime(t.task_time);
      if (startMin == null) return null;
      const endParsed = parseTaskTime(t.task_end_time);
      const endMin =
        endParsed != null && endParsed > startMin
          ? endParsed
          : startMin + DEFAULT_DURATION_MIN;
      return { task: t, startMin, endMin };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  // Cluster overlapping events, then assign columns within the cluster.
  const clusters = [];
  let cur = [];
  let curEnd = -1;
  for (const e of events) {
    if (cur.length && e.startMin < curEnd) {
      cur.push(e);
      curEnd = Math.max(curEnd, e.endMin);
    } else {
      if (cur.length) clusters.push(cur);
      cur = [e];
      curEnd = e.endMin;
    }
  }
  if (cur.length) clusters.push(cur);

  const out = [];
  for (const cluster of clusters) {
    const cols = []; // last endMin per column
    const assigned = [];
    for (const e of cluster) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        if (cols[i] <= e.startMin) {
          cols[i] = e.endMin;
          assigned.push({ ...e, col: i });
          placed = true;
          break;
        }
      }
      if (!placed) {
        assigned.push({ ...e, col: cols.length });
        cols.push(e.endMin);
      }
    }
    const colCount = cols.length;
    for (const a of assigned) out.push({ ...a, cols: colCount });
  }
  return out;
}
