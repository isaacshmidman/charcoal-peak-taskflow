// @ts-nocheck
/**
 * @file Read-only rich-text preview for note cards. Renders the stored
 * ProseMirror JSON to React via createElement — NEVER
 * dangerouslySetInnerHTML (the JSON came from our own schema, but we
 * still don't reconstruct HTML from strings). Mark-agnostic: applies the
 * marks we know (bold/italic/underline/strike/highlight/color/font),
 * ignores anything else. Falls back to plaintext when there's no JSON.
 */
import { createElement, useMemo } from "react";
import { cn } from "@/lib/utils";

/** Apply inline marks to a text string, innermost-out. */
function renderText(node, key) {
  let el = node.text ?? "";
  const marks = node.marks || [];
  const style = {};
  let wrapper = null;
  for (const mark of marks) {
    if (mark.type === "bold") wrapper = "strong";
    else if (mark.type === "italic") el = createElement("em", { key: `${key}i` }, el);
    else if (mark.type === "underline") el = createElement("u", { key: `${key}u` }, el);
    else if (mark.type === "strike") el = createElement("s", { key: `${key}s` }, el);
    else if (mark.type === "code") el = createElement("code", { key: `${key}c`, className: "text-[0.85em]" }, el);
    else if (mark.type === "highlight") style.backgroundColor = mark.attrs?.color || "#fef08a";
    else if (mark.type === "textStyle") {
      if (mark.attrs?.color) style.color = mark.attrs.color;
      if (mark.attrs?.fontFamily) style.fontFamily = mark.attrs.fontFamily;
    }
  }
  const hasStyle = Object.keys(style).length > 0;
  if (wrapper || hasStyle) {
    return createElement(wrapper || "span", { key, style: hasStyle ? style : undefined }, el);
  }
  return createElement("span", { key }, el);
}

const LIST_MARKER = { bulletList: "•", orderedList: "–" };

function renderNode(node, key) {
  if (!node) return null;
  switch (node.type) {
    case "text":
      return renderText(node, key);
    case "hardBreak":
      return createElement("br", { key });
    case "paragraph":
      return createElement("p", { key, className: "m-0" }, (node.content || []).map(renderNode));
    case "heading":
      return createElement("p", { key, className: "m-0 font-semibold" }, (node.content || []).map(renderNode));
    case "blockquote":
      return createElement("div", { key, className: "pl-2 border-l-2 border-slate-200 dark:border-[#303030]" }, (node.content || []).map(renderNode));
    case "codeBlock":
      return createElement("code", { key, className: "block text-[0.85em]" }, (node.content || []).map(renderNode));
    case "bulletList":
    case "orderedList":
      return createElement("div", { key, className: "space-y-0" }, (node.content || []).map((li, i) => renderNode(li, `${key}-${i}`, node.type)));
    case "listItem":
      return createElement(
        "div",
        { key, className: "flex gap-1.5" },
        createElement("span", { key: `${key}m`, className: "shrink-0" }, LIST_MARKER[arguments[2]] || "•"),
        createElement("div", { key: `${key}b`, className: "min-w-0" }, (node.content || []).map(renderNode))
      );
    case "taskList":
      return createElement("div", { key, className: "space-y-0" }, (node.content || []).map(renderNode));
    case "taskItem":
      return createElement(
        "div",
        { key, className: "flex gap-1.5" },
        createElement("span", { key: `${key}c`, className: "shrink-0" }, node.attrs?.checked ? "☑" : "☐"),
        createElement("div", { key: `${key}b`, className: cn("min-w-0", node.attrs?.checked && "line-through opacity-60") }, (node.content || []).map(renderNode))
      );
    case "horizontalRule":
      return createElement("hr", { key, className: "my-1 border-slate-100 dark:border-[#303030]" });
    default:
      // Unknown node → render its children if any.
      return node.content ? createElement("div", { key }, node.content.map(renderNode)) : null;
  }
}

export default function NotePreview({ contentJson, contentText, className }) {
  const doc = useMemo(() => {
    const raw = typeof contentJson === "string" ? contentJson.trim() : "";
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }, [contentJson]);

  if (!doc || !doc.content?.length) {
    // No rich content — plaintext mirror.
    if (!contentText?.trim()) return null;
    return (
      <p className={cn("whitespace-pre-line", className)}>{contentText}</p>
    );
  }

  return (
    <div className={cn("leading-snug [&_p]:leading-snug space-y-0.5", className)}>
      {doc.content.map((n, i) => renderNode(n, `n-${i}`))}
    </div>
  );
}
