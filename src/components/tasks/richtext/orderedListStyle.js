// @ts-nocheck
/**
 * @file List overrides that persist a `listStyleType` attribute so the
 * user's marker choice survives save/reload as inline
 * `style="list-style-type: ..."`.
 *
 * - OrderedList: decimal / lower-alpha / lower-roman / upper-roman.
 *   TipTap's stock OrderedList doesn't round-trip the HTML `type=a/i`
 *   attribute (ueberdosis/tiptap#3726), hence this.
 * - BulletList: disc (•) / circle (○) / a dash marker (the CSS string
 *   marker `'-  '`). Dash isn't a native keyword, so we store the
 *   keyword `dash` and map it to the CSS string at render time.
 */
import { OrderedList, BulletList } from "@tiptap/extension-list";

const TYPE_TO_STYLE = {
  "1": "decimal",
  a: "lower-alpha",
  A: "upper-alpha",
  i: "lower-roman",
  I: "upper-roman",
};

const VALID_STYLES = new Set([
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
]);

export const OrderedListWithStyle = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyleType: {
        default: "decimal",
        parseHTML: (element) => {
          const inline = element.style?.listStyleType;
          if (inline && VALID_STYLES.has(inline)) return inline;
          const legacy = element.getAttribute("type");
          if (legacy && TYPE_TO_STYLE[legacy]) return TYPE_TO_STYLE[legacy];
          return "decimal";
        },
        renderHTML: (attributes) => {
          const style = attributes.listStyleType;
          if (!style || style === "decimal") return {};
          return { style: `list-style-type: ${style}` };
        },
      },
    };
  },
});

const BULLET_VALID = new Set(["disc", "circle", "dash"]);

export const BulletListWithStyle = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyleType: {
        default: "disc",
        parseHTML: (element) => {
          const inline = element.style?.listStyleType;
          if (inline === "circle") return "circle";
          // The dash marker renders as the CSS string '-  '; detect it.
          if (inline && inline.replace(/["']/g, "").trim() === "-") return "dash";
          if (inline === "disc") return "disc";
          const attr = element.getAttribute("data-list-style");
          if (attr && BULLET_VALID.has(attr)) return attr;
          return "disc";
        },
        renderHTML: (attributes) => {
          const style = attributes.listStyleType;
          if (style === "circle") return { style: "list-style-type: circle" };
          if (style === "dash") {
            // String marker + a data-attr so parseHTML can recover it
            // reliably across browsers that normalize the inline string.
            return { style: "list-style-type: '-  '", "data-list-style": "dash" };
          }
          return {}; // disc = default
        },
      },
    };
  },
});

export default OrderedListWithStyle;
