// @ts-nocheck
/**
 * @file The editor's extension list, in one place so it is the single
 * source of truth for every rich-text box in the app AND can be
 * exercised by tests without mounting React.
 *
 * Markdown typing shortcuts (`# `, `- `, `1. `, `> `, `**bold**`,
 * `*italic*`, `` `code` ``, ```` ``` ````) come from the StarterKit
 * extensions' own input rules. The two list extensions are disabled in
 * StarterKit and re-added as `.extend()`s of the very same classes, so
 * they inherit those input rules — replacing them outright would have
 * silently dropped `- ` and `1. `.
 */
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { TextStyle, Color, FontFamily } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import CharacterCount from "@tiptap/extension-character-count";
import { OrderedListWithStyle, BulletListWithStyle } from "./orderedListStyle";
import { ParagraphIndent } from "./paragraphIndent";
import { TaskLink, taskLinkStatePlugin } from "./taskLink";

/**
 * @param {{ onOpenTask?: (taskId: string) => void }} [opts]
 */
export function buildEditorExtensions({ onOpenTask } = {}) {
  return [
    StarterKit.configure({
      link: false,            // XSS hygiene — no links in descriptions
      bulletList: false,      // replaced by BulletListWithStyle
      orderedList: false,     // replaced by OrderedListWithStyle
    }),
    BulletListWithStyle,
    OrderedListWithStyle,
    TextStyle,
    Color,
    FontFamily.configure({ types: ["textStyle"] }),
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    CharacterCount,           // word counter (.words())
    ParagraphIndent,
    TaskLink,
    // Paints taskLink spans from live task state. Registered
    // unconditionally so the mark round-trips everywhere; with no task
    // map supplied it decorates nothing.
    Extension.create({
      name: "taskLinkState",
      addProseMirrorPlugins: () => [taskLinkStatePlugin({ onOpenTask })],
    }),
  ];
}
