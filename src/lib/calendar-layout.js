// @ts-nocheck
import { parseTaskTime } from "@/lib/sort-helpers";

const DEFAULT_DURATION_MIN = 60;

/**
 * Given timed tasks for a single day, assign each event:
 *   - `col`     — its column index within its cluster (0..cols-1)
 *   - `cols`    — total columns in the cluster (the visual "tracks")
 *   - `colSpan` — how many columns this event spans, expanded right
 *                 into any adjacent free columns. Lets sparse parts of
 *                 a cluster look wide instead of being squeezed by an
 *                 unrelated dense overlap elsewhere in the cluster.
 *
 * Algorithm (matches Google Calendar / FullCalendar / Mozilla's reference
 * weekly view):
 *   1. Sort events by start asc, then end desc (longer event wins ties so
 *      it gets placed in the leftmost column).
 *   2. Group transitively-overlapping events into clusters.
 *   3. Within each cluster, place events column-by-column greedily —
 *      each event lands in the leftmost column whose previous event has
 *      already ended.
 *   4. After all events are placed, walk each event RIGHTWARD from its
 *      assigned col and expand `colSpan` while no other event in the next
 *      column overlaps in time. This is the "expand to fill empty
 *      adjacent columns" pass that prevents an event in a sparse part of
 *      a cluster from looking unjustly narrow when only one segment of
 *      the cluster is dense.
 *
 * Step 4 is the difference from the previous implementation. Without it,
 * a cluster like [A(9–10), B(9–10), C(10:30–11:30)] gives all three
 * `cols=2`, so C renders at 50% width even though nothing sits next to
 * it at 10:30. With step 4, C expands `colSpan` to 2 and renders full
 * width. Render code multiplies `colSpan / cols` instead of `1 / cols`.
 *
 * @returns {Array<{task, startMin, endMin, col, cols, colSpan}>}
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

  // 2. Cluster overlapping events.
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
    // 3. Greedy per-cluster column assignment.
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

    // 4. Expand each event rightward into empty adjacent columns.
    //    O(n²) per cluster but clusters are small (rarely > ~10 events).
    for (const e of assigned) {
      let span = 1;
      for (let nextCol = e.col + 1; nextCol < colCount; nextCol++) {
        const blocked = assigned.some(
          (other) =>
            other !== e &&
            other.col === nextCol &&
            other.startMin < e.endMin &&
            other.endMin > e.startMin
        );
        if (blocked) break;
        span += 1;
      }
      e.colSpan = span;
    }

    for (const a of assigned) out.push({ ...a, cols: colCount });
  }
  return out;
}
