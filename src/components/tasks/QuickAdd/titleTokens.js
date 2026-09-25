// @ts-check
/**
 * @file The in-title tokens that remain: `#tag`, `#"multi word tag"` and
 * `!priority`. Each needs an explicit sigil, so nothing is ever inferred
 * from ordinary words in a title.
 *
 * Natural-language scheduling — "thursday at 7pm", "tomorrow", "every
 * monday" — used to be parsed out of titles too, and was removed on
 * purpose: a title that happened to mention a day or a time silently
 * rescheduled its task. Dates, times and recurrence are set with their own
 * controls and nowhere else. Do not reintroduce them here.
 */

/** Levenshtein distance, bailing out early past the threshold we use. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Fuzzy-match a `!query` against the user's own priority names:
 * exact > prefix > substring > edit distance ≤ 2. Below that threshold
 * nothing matches, and the text stays in the title — a priority is never
 * guessed silently.
 *
 * @param {string} query
 * @param {Array<{ id: string, name: string }>} priorities
 * @returns {{ id: string, name: string } | null}
 */
export function fuzzyMatchPriority(query, priorities) {
  const q = String(query || "").toLowerCase();
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const p of priorities || []) {
    const name = String(p.name || "").toLowerCase();
    if (!name) continue;
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (q.length >= 3 && editDistance(name, q) <= 2) score = 40;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best && bestScore >= 40 ? { id: best.id, name: best.name } : null;
}

/**
 * The sigil token that ends exactly at `end` — the position of a space the
 * user has just typed after it — or null when there isn't one.
 *
 * @param {string} text
 * @param {number} end  index one past the token's last character
 * @param {{ tags?: boolean, priority?: boolean }} grammar  which sigils the form honours
 * @param {Array<{ id: string, name: string }>} [priorities]
 * @returns {{ start: number, end: number, fields: Record<string, any> } | null}
 */
export function completedTokenAt(text, end, grammar, priorities = []) {
  const upto = String(text || "").slice(0, end);

  // `#"multi word tag"` — the only token allowed to contain spaces.
  if (grammar.tags) {
    const quoted = /#"([^"]+)"$/.exec(upto);
    if (quoted) {
      const value = quoted[1].trim();
      if (value) return { start: end - quoted[0].length, end, fields: { tags: [value] } };
    }
  }

  const start = Math.max(upto.lastIndexOf(" "), upto.lastIndexOf("\t"), upto.lastIndexOf("\n")) + 1;
  const token = upto.slice(start);

  if (grammar.tags) {
    const tag = /^#([^\s#!"]+)$/.exec(token);
    if (tag) return { start, end, fields: { tags: [tag[1]] } };
  }

  if (grammar.priority) {
    const pri = /^!([^\s#!"]+)$/.exec(token);
    if (pri) {
      const match = fuzzyMatchPriority(pri[1], priorities);
      if (match) return { start, end, fields: { priority_id: match.id } };
    }
  }

  return null;
}
