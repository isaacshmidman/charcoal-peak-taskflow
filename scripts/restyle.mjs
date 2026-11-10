// Converts code written before the November 2026 redesign to the current
// palette (docs/design-system.md): stock Tailwind greys become `ink`, and
// the dark-mode colours that used to be written out by hand get their
// `night-*` names.
//
//   node scripts/restyle.mjs            convert everything under src/
//   node scripts/restyle.mjs --check    only list the files it would change
//
// For landing a branch that predates the redesign. src/test/design-palette
// .test.js fails until it has been run (and names anything it can't convert).
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The old hand-written dark colours → what each one was for. */
const HEX_NAMES = {
  "0c0c0c": "night-sunken", "080808": "night-sunken", "141414": "night-sunken", "151515": "night-sunken",
  "111111": "night-card",
  "161616": "night-raised", "171717": "night-raised", "1a1a1a": "night-raised", "1c1c1c": "night-raised",
  "1d1d1d": "night-raised", "1f1f1f": "night-raised",
  "222222": "night-high", "252525": "night-high", "2c2c2c": "night-high",
  "303030": "night-line", "343434": "night-line-strong", "3a3a3a": "night-line-strong", "454545": "night-line-bold",
  "2a1116": "night-danger", "101f34": "night-info", "10261b": "night-good",
  "29230e": "night-warn", "1f1809": "night-warn", "4a3512": "night-warn-line",
};

/** @param {string} source */
export function restyle(source) {
  return source
    .replace(/\b(?:slate|gray|zinc|neutral|stone)-(50|[1-9]00|950)\b/g, "ink-$1")
    .replace(/colors\.(?:slate|gray|zinc|neutral|stone)\./g, "colors.ink.")
    .replace(/-\[#([0-9a-fA-F]{6})\]/g, (whole, hex) => {
      const name = HEX_NAMES[hex.toLowerCase()];
      return name ? `-${name}` : whole;
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((file) => /\.(jsx?|tsx?|css)$/.test(file) && !file.endsWith("design-palette.test.js"));
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = restyle(before);
    if (after === before) continue;
    changed += 1;
    console.log(`${check ? "would change" : "changed"}  ${file}`);
    if (!check) writeFileSync(file, after);
  }
  console.log(changed ? `${changed} file${changed === 1 ? "" : "s"}.` : "Nothing to convert.");
}
