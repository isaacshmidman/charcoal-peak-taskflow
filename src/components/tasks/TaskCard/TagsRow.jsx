// @ts-nocheck
/**
 * @file Desktop-only tag chip row for TaskCard. Hidden on mobile via
 * `hidden sm:flex`. Renders up to 2 tags as plain small text with a
 * "+N more" counter when overflowing.
 */
// React default import is required: vitest's esbuild transform compiles
// JSX in this file to classic React.createElement calls (the app build
// uses the automatic runtime and doesn't need it).
import React from "react";

export default function TagsRow({ tags }) {
  if (!tags?.length) return null;
  return (
    <div className="hidden sm:flex items-center gap-2">
      {tags.slice(0, 2).map((tag) => (
        <span key={tag} className="text-xs text-ink-500 dark:text-ink-400">
          {tag.length > 20 ? `${tag.slice(0, 20)}…` : tag}
        </span>
      ))}
      {tags.length > 2 && (
        <span className="text-xs text-ink-400 dark:text-ink-500">+{tags.length - 2}</span>
      )}
    </div>
  );
}
