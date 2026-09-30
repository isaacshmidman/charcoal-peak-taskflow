// @ts-check
/**
 * @file Whether two task titles name the same thing, ignoring the little
 * words people add ("go to the gym tmr" and "Gym"). Used when a schedule is
 * added to the calendar, to offer merging a slot into a task already on
 * that day instead of adding a second one. Shared by the Notes page
 * (src/lib/similar-tasks.js re-exports this) and the AI tools.
 */

/** Words that say nothing about what a task is. */
const LITTLE_WORDS = new Set(
  (
    // articles, pronouns, possessives
    "a an the this that these those some any my your our his her their its me i we you he she they it us them mine yours " +
    // prepositions and conjunctions
    "at in on of to for with from by about into onto over under after before during around up down out off near via per " +
    "till until and or but nor so then also plus w re " +
    // when (the day and time are the slot's, not the task's name)
    "today tonight tomorrow tmr tmrw tmw tmrow tn rn asap now later soon morning afternoon evening night noon midnight " +
    "am pm daily weekly week day next every each weekend " +
    "mon monday tue tues tuesday wed weds wednesday thu thur thurs thursday fri friday sat saturday sun sunday " +
    // filler verbs and asks
    "go goes going get do does have has need needs want gotta gonna should must will can remember remind reminder try make take " +
    "please pls plz just quick quickly maybe"
  ).split(/\s+/)
);

/**
 * One word, reduced so plurals and possessives match: groceries → grocery,
 * classes → class, meetings → meeting, mom's → mom.
 * @param {string} word
 */
function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * The words that say what a task is.
 * @param {string} title
 * @returns {Set<string>}
 */
export function titleWords(title) {
  const words = String(title || "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}:]+/u)
    .filter(Boolean)
    // Numbers and times ("7", "9:30", "7pm") are when, not what.
    .filter((word) => !/^\d/.test(word))
    .filter((word) => !LITTLE_WORDS.has(word))
    .map(stem)
    .filter((word) => word && !LITTLE_WORDS.has(word));
  return new Set(words);
}

/**
 * How alike two titles are, 0–1, or 0 when they aren't similar at all.
 * Similar: they share a word, and either one's words are all in the
 * other's, or they share most of their words.
 * @param {string} a
 * @param {string} b
 */
export function titleSimilarity(a, b) {
  const x = titleWords(a);
  const y = titleWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  if (!shared) return 0;
  const dice = (2 * shared) / (x.size + y.size);
  const within = shared === Math.min(x.size, y.size);
  if (!within && dice < 0.6) return 0;
  // One inside the other ranks above a looser overlap.
  return within ? 0.5 + dice / 2 : dice / 2;
}

/**
 * @typedef {{ id: string, title?: string, due_date?: string, task_time?: string, task_end_time?: string,
 *   status?: string, parent_id?: string | null, source_provider?: string, recurrence?: string }} TaskLike
 * @typedef {{ slotId: string, title: string, due_date: string, task_time: string, task_end_time: string }} SlotTaskLike
 * @typedef {{ slotId: string, task: TaskLike, score: number, canMerge: boolean, why: "" | "calendar" | "repeating" }} SimilarMatch
 */

/**
 * For each slot about to be added, the task already on that day that
 * looks like the same thing, if any: open, top-level tasks on the slot's
 * day, best match first, each task matched to one slot at most.
 * A task from a connected calendar, or one that repeats, can't be merged
 * (it would move the real event, or every time it repeats).
 * @param {SlotTaskLike[]} slotTasks
 * @param {TaskLike[]} tasks
 * @returns {SimilarMatch[]}
 */
export function findSimilarTasks(slotTasks, tasks) {
  /** @type {Array<{ slot: SlotTaskLike, task: TaskLike, score: number }>} */
  const options = [];
  for (const slot of slotTasks) {
    for (const task of tasks) {
      if (task.parent_id || task.status === "done" || task.due_date !== slot.due_date) continue;
      const score = titleSimilarity(slot.title, task.title || "");
      if (score > 0) options.push({ slot, task, score });
    }
  }
  options.sort((p, q) => q.score - p.score);
  const slotsTaken = new Set();
  const tasksTaken = new Set();
  /** @type {SimilarMatch[]} */
  const matches = [];
  for (const { slot, task, score } of options) {
    if (slotsTaken.has(slot.slotId) || tasksTaken.has(task.id)) continue;
    slotsTaken.add(slot.slotId);
    tasksTaken.add(task.id);
    const why = task.source_provider ? "calendar" : task.recurrence && task.recurrence !== "none" ? "repeating" : "";
    matches.push({ slotId: slot.slotId, task, score, canMerge: !why, why });
  }
  // In the schedule's order.
  const order = new Map(slotTasks.map((slot, i) => [slot.slotId, i]));
  return matches.sort((p, q) => Number(order.get(p.slotId)) - Number(order.get(q.slotId)));
}

/** What to do with a slot that looks like a task already on the day. */
export const SIMILAR_CHOICES = /** @type {const} */ (["ask", "merge", "keep"]);

/**
 * @param {unknown} value
 * @returns {"ask" | "merge" | "keep"}
 */
export function cleanSimilarChoice(value) {
  return value === "merge" || value === "keep" ? value : "ask";
}
