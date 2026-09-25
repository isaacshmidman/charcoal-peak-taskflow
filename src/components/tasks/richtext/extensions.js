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
import Link from "@tiptap/extension-link";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { OrderedListWithStyle, BulletListWithStyle } from "./orderedListStyle";
import { ParagraphIndent } from "./paragraphIndent";
import { TaskLink, taskLinkStatePlugin } from "./taskLink";
import { isAllowedLink, openLink, safeHref, shouldAutoLink, unlinkedUrlRanges } from "./links";

/** Plugin key of the link bar's bubble menu (LinkBubble.jsx). */
export const LINK_BUBBLE_KEY = "linkBubble";
/** Meta on the load-time linkify transaction, so hosts don't save it. */
export const LINKIFY_ON_LOAD = "linkifyOnLoad";

/**
 * Clicking a link. While editing, a plain click only places the caret —
 * you have to be able to edit link text — and the link bar offers Open;
 * ⌘/Ctrl-click opens straight away. Read-only (a calendar event you can't
 * edit), the browser follows the link itself, but only a vetted href.
 */
const linkClickPlugin = new Plugin({
  key: new PluginKey("safeLinkClick"),
  props: {
    handleDOMEvents: {
      click(view, event) {
        if (event.button !== 0) return false;
        const target = event.target instanceof Element ? event.target : null;
        const anchor = target?.closest("a");
        if (!anchor || !view.dom.contains(anchor)) return false;
        const href = safeHref(anchor.getAttribute("href"));
        if (!view.editable) {
          if (!href) event.preventDefault();
          return false;
        }
        if (!(event.metaKey || event.ctrlKey)) return false;
        event.preventDefault();
        openLink(href);
        return true;
      },
    },
  },
});

/**
 * Links, restricted to http, https and mailto (see links.js).
 *
 * Only `href` and `title` are real attributes. Link also defines target,
 * rel and class and reads them from pasted HTML, so an imported invite
 * could set class="task-link-open" and fake the reserved task highlight,
 * or target="_self" and navigate the app away. Those are fixed at render
 * time instead, and the href is re-checked there too, so a stored
 * document can't smuggle a javascript: link past the paste checks.
 */
const SafeLink = Link.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return { href: parent.href, title: parent.title };
  },
  parseHTML() {
    return [{ tag: "a[href]", getAttrs: (dom) => (safeHref(dom.getAttribute("href")) ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      {
        href: safeHref(HTMLAttributes.href),
        title: HTMLAttributes.title ?? null,
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      },
      0,
    ];
  },
  addStorage() {
    // Set by openLinkEditor; LinkBubble reads it and clears it on close.
    return { editorOpen: false };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      /** Open the link bar's editor at the selection (toolbar button, ⌘K). */
      openLinkEditor:
        () =>
        ({ tr, dispatch }) => {
          if (!this.editor.isEditable) return false;
          if (dispatch) {
            this.storage.editorOpen = true;
            tr.setMeta(LINK_BUBBLE_KEY, "show");
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-k": () => this.editor.commands.openLinkEditor() };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), linkClickPlugin];
  },
}).configure({
  openOnClick: false, // linkClickPlugin decides instead
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: "https",
  isAllowedUri: (url) => isAllowedLink(url),
  shouldAutoLink: (url) => shouldAutoLink(url),
});

/**
 * Turn plain URLs already in the document into links — text written
 * before links existed, and plain-text calendar descriptions. Runs once
 * when an editor opens, outside undo history and tagged LINKIFY_ON_LOAD
 * so hosts don't treat it as an edit and autosave on open.
 *
 * @param {import("@tiptap/core").Editor} editor
 */
export function linkifyExistingUrls(editor) {
  const linkType = editor.schema.marks.link;
  if (!linkType) return;
  const ranges = unlinkedUrlRanges(editor.state.doc);
  if (!ranges.length) return;
  const tr = editor.state.tr;
  for (const { from, to, href } of ranges) tr.addMark(from, to, linkType.create({ href }));
  tr.setMeta("addToHistory", false).setMeta(LINKIFY_ON_LOAD, true);
  editor.view.dispatch(tr);
}

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
      link: false,            // replaced by SafeLink (http/https/mailto only)
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
    SafeLink,
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
