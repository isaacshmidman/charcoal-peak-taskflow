/* @vitest-environment node */
/**
 * The app has one palette (docs/design-system.md): `ink` for neutrals,
 * `sun` for the accent, `night` for dark surfaces. This scans the source
 * and fails on the two ways the old look creeps back in:
 *
 *   - a stock Tailwind grey (`text-slate-500`, `bg-gray-100`, …), which is
 *     a different, colder colour that sits wrongly beside the yellow;
 *   - a colour written out by hand in a class (`dark:bg-[#111111]`), which
 *     no theme change can ever reach.
 *
 * Branches written before the redesign use both. When one lands,
 * `node scripts/restyle.mjs` converts it.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { restyle } from "../../scripts/restyle.mjs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => /\.(jsx?|tsx?|css)$/.test(file) && !file.endsWith("design-palette.test.js"));

const STOCK_GREY = /\b(?:slate|gray|zinc|neutral|stone)-(?:50|[1-9]00|950)\b/g;
const HAND_COLOUR = /[a-z:-]+-\[#[0-9a-fA-F]{3,8}\]/g;

/** @param {RegExp} pattern */
function offenders(pattern) {
  const found = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const match of line.match(pattern) || []) found.push(`${file}:${index + 1}  ${match}`);
    });
  }
  return found;
}

describe("the palette", () => {
  it("uses ink for greys, never a stock Tailwind grey", () => {
    expect(offenders(STOCK_GREY)).toEqual([]);
  });

  it("names its colours instead of writing them out in a class", () => {
    expect(offenders(HAND_COLOUR)).toEqual([]);
  });
});

describe("restyle (the converter for code written before the redesign)", () => {
  it("renames stock greys to ink", () => {
    expect(restyle('className="text-slate-500 dark:text-slate-400 hover:bg-gray-100"')).toBe(
      'className="text-ink-500 dark:text-ink-400 hover:bg-ink-100"'
    );
    expect(restyle('color: theme("colors.slate.900");')).toBe('color: theme("colors.ink.900");');
  });

  it("gives the old hand-written dark colours their names", () => {
    expect(restyle('"bg-white dark:bg-[#111111] border-slate-100 dark:border-[#303030]"')).toBe(
      '"bg-white dark:bg-night-card border-ink-100 dark:border-night-line"'
    );
    expect(restyle("dark:hover:bg-[#161616] dark:bg-[#0C0C0C]")).toBe("dark:hover:bg-night-raised dark:bg-night-sunken");
  });

  it("leaves alone what it doesn't know, for the test above to point at", () => {
    expect(restyle("dark:bg-[#123456] slate tasks-100")).toBe("dark:bg-[#123456] slate tasks-100");
  });
});
