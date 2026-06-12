// @ts-nocheck
/**
 * @file Tab / Shift+Tab indentation for plain paragraphs (and headings).
 *
 * Inside a list, TipTap's ListKeymap (bundled in StarterKit v3) already
 * owns Tab/Shift+Tab for nesting, so this extension defers there — it
 * only acts when the selection is NOT in a list item. It stores an
 * integer `indent` level (0–8) as a `data-indent` attribute, rendered
 * as `margin-left` so it round-trips through save/reload.
 *
 * Accessibility: when at indent 0 and Shift+Tab is pressed, we return
 * false so focus can still escape the editor backwards; Tab past the max
 * also returns false. (A fully empty editor still traps Tab to indent,
 * which matches Notion/Docs behavior — acceptable for a notes field.)
 */
import { Extension } from "@tiptap/core";

const MAX_INDENT = 8;
const STEP_REM = 1.5;
const INDENTABLE_TYPES = ["paragraph", "heading"];

export const ParagraphIndent = Extension.create({
  name: "paragraphIndent",

  addGlobalAttributes() {
    return [
      {
        types: INDENTABLE_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const raw = element.getAttribute("data-indent");
              const n = raw ? parseInt(raw, 10) : 0;
              return Number.isFinite(n) ? Math.min(MAX_INDENT, Math.max(0, n)) : 0;
            },
            renderHTML: (attributes) => {
              const n = attributes.indent || 0;
              if (!n) return {};
              return {
                "data-indent": String(n),
                style: `margin-left: ${n * STEP_REM}rem`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const shift = (delta) => ({ state, tr, dispatch }) => {
      const { from, to } = state.selection;
      let handled = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!INDENTABLE_TYPES.includes(node.type.name)) return;
        const current = node.attrs.indent || 0;
        const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
        if (next !== current) {
          handled = true;
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        }
      });
      return handled;
    };
    return {
      indentParagraph: () => shift(+1),
      outdentParagraph: () => shift(-1),
    };
  },

  addKeyboardShortcuts() {
    const inList = (editor) =>
      editor.isActive("listItem") ||
      editor.isActive("taskItem") ||
      editor.isActive("bulletList") ||
      editor.isActive("orderedList") ||
      editor.isActive("taskList");

    return {
      Tab: ({ editor }) => {
        if (inList(editor)) return false; // ListKeymap handles list nesting
        return editor.commands.indentParagraph();
      },
      "Shift-Tab": ({ editor }) => {
        if (inList(editor)) return false;
        return editor.commands.outdentParagraph();
      },
    };
  },
});

export default ParagraphIndent;
