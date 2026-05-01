#!/usr/bin/env node
/**
 * Mechanical dark-mode pass for Phase 2.
 *
 * Walks the listed JSX files line-by-line. For each (light, dark) class
 * pair, if a line contains the light class but NOT the corresponding
 * dark variant, appends the dark variant beside every instance of the
 * light class on that line. Lines already carrying the dark variant
 * are left alone — so this is safe to re-run without duplicating.
 *
 * Negative lookbehind `(?<![\w:\-])` and negative lookahead `(?![\w\-])`
 * ensure we only match WHOLE class tokens — `bg-white` won't match
 * inside `bg-white-something` (hypothetical) or be confused with the
 * tail of `dark:bg-white`.
 *
 * Usage: node scripts/dark-mode-sweep.mjs <file1> <file2> ...
 */
import fs from "node:fs";

// Order matters: more specific keys first so e.g. `hover:bg-slate-50`
// is matched before the bare `bg-slate-50` rule fires for the same
// substring (Tailwind's hover: prefix would otherwise be left without
// its dark-paired hover variant).
const PAIRS = [
  ["hover:bg-slate-50", "dark:hover:bg-slate-800"],
  ["hover:bg-slate-100", "dark:hover:bg-slate-700"],
  ["hover:bg-slate-200", "dark:hover:bg-slate-700"],
  ["hover:text-slate-900", "dark:hover:text-slate-100"],
  ["hover:text-slate-700", "dark:hover:text-slate-200"],
  ["hover:text-slate-600", "dark:hover:text-slate-300"],
  ["hover:text-slate-500", "dark:hover:text-slate-400"],
  ["hover:border-slate-200", "dark:hover:border-slate-700"],
  ["hover:border-slate-300", "dark:hover:border-slate-600"],
  ["text-slate-900", "dark:text-slate-100"],
  ["text-slate-800", "dark:text-slate-100"],
  ["text-slate-700", "dark:text-slate-200"],
  ["text-slate-600", "dark:text-slate-300"],
  ["text-slate-500", "dark:text-slate-400"],
  ["text-slate-400", "dark:text-slate-500"],
  ["text-slate-300", "dark:text-slate-600"],
  ["bg-white", "dark:bg-slate-900/60"],
  ["bg-slate-50", "dark:bg-slate-800/50"],
  ["bg-slate-100", "dark:bg-slate-800"],
  ["bg-slate-200", "dark:bg-slate-700"],
  ["border-slate-100", "dark:border-slate-800"],
  ["border-slate-200", "dark:border-slate-700"],
  ["border-slate-300", "dark:border-slate-600"],
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function processFile(file) {
  let content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (const [light, dark] of PAIRS) {
      // If the line already mentions this dark variant, skip — it was
      // hand-tuned earlier and we don't want to corrupt it.
      if (line.includes(dark)) continue;
      // Block matching when followed by `/` too — Tailwind opacity
      // suffixes like `bg-white/80` would otherwise yield a broken
      // composite (`bg-white dark:bg-slate-900/60/80`). Run a separate
      // post-fix pass for those if you want the dark variant on opacity
      // forms.
      const re = new RegExp(
        `(?<![\\w:\\-])${escapeRegex(light)}(?![\\w\\-/])`,
        "g"
      );
      line = line.replace(re, (m) => `${m} ${dark}`);
    }
    lines[i] = line;
  }
  const next = lines.join("\n");
  if (next !== content) {
    fs.writeFileSync(file, next);
    console.log(`updated: ${file}`);
  }
}

for (const file of process.argv.slice(2)) processFile(file);
