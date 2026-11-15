// @ts-check
import { useSearchParams } from "react-router-dom";

/**
 * The tag a task page is narrowed to: `?tag=work` in the address, which
 * is where the sidebar's tag links point. "" when the page shows
 * everything.
 * @returns {string}
 */
export function useTagFilter() {
  const [params] = useSearchParams();
  return params.get("tag") || "";
}

/**
 * The address of a task page, narrowed to a tag (or not).
 * @param {string} path
 * @param {string} [tag]
 */
export function taskPagePath(path, tag) {
  return tag ? `${path}?tag=${encodeURIComponent(tag)}` : path;
}
