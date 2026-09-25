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
import { Placeholder } from "@tiptap/extensions";
import { OrderedListWithStyle, BulletListWithStyle } from "./orderedListStyle";
import { ParagraphIndent } from "./paragraphIndent";
import { TaskLink, taskLinkStatePlugin } from "./taskLink";

/** Purple, the first swatch in the toolbar's highlight picker. */
export const DEFAULT_HIGHLIGHT = "#e9d5ff";

/**
 * Highlight that is never colourless. Yellow is reserved for note↔task
 * links (see Toolbar.jsx), but ⌘⇧H, typing ==text== and pasted <mark>s all
 * made a highlight with no colour — which the browser paints yellow. They
 * now get the picker's first colour instead.
 */
const PaletteHighlight = Highlight.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      color: {
        ...parent.color,
        default: DEFAULT_HIGHLIGHT,
        parseHTML: (element) =>
          element.getAttribute("data-color") || element.style.backgroundColor || DEFAULT_HIGHLIGHT,
      },
    };
  },
});

/**
 * @param {{ onOpenTask?: (taskId: string) => void, placeholder?: string }} [opts]
 */
export function buildEditorExtensions({ onOpenTask, placeholder = "" } = {}) {
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
    PaletteHighlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    CharacterCount,           // word counter (.words())
    // Hint text for an empty box. It lives in a data attribute on the
    // empty paragraph (see .tiptap-prose in index.css), never in the doc.
    Placeholder.configure({ placeholder }),
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
