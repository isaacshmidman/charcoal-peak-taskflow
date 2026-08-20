// @ts-nocheck
/**
 * @file The note ↔ task link: a TipTap mark that anchors to a span of
 * note text, plus the plugin that paints it from LIVE task state.
 *
 * Why a mark rather than stored offsets: ProseMirror marks already do
 * everything the anchoring rules ask for. Typing inside a mark extends
 * it, deleting part shrinks it, surrounding formatting doesn't fragment
 * it, and deleting the span removes the mark with the text — no offsets
 * to re-map on every keystroke, no zero-width characters, no orphaned
 * nodes left behind.
 *
 * Why the mark stores ONLY a taskId: the highlight is derived from task
 * state, never stored alongside it. Nothing here can drift out of sync
 * with the task, because nothing here records what the task looks like.
 *
 * Deleting a task leaves an inert mark in the note's saved JSON. That is
 * deliberate: it renders as plain text (see decorationsFor), and the
 * alternative — stripping marks whose task isn't found — would erase
 * every marker in every note during the first paint and any time the app
 * is offline, when the task list is legitimately empty.
 */
import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const taskLinkStateKey = new PluginKey("taskLinkState");

/** Reserved — this yellow can't be produced from the highlight picker. */
export const TASK_LINK_CLASS = "task-link";
export const TASK_LINK_OPEN_CLASS = "task-link-open";
export const TASK_LINK_DONE_CLASS = "task-link-done";

/**
 * Walk a doc and derive what to draw for every taskLink span.
 *
 * Pure and exported so the rules can be tested without an editor: the
 * whole feature's correctness is "highlight iff a task exists, struck
 * iff it's done", and that lives here.
 *
 * @param {any} doc  ProseMirror node to scan
 * @param {Map<string, string>} statusById  taskId → "done" | anything else.
 *   An id that is ABSENT means no such task (never created, or deleted).
 * @returns {Array<{ from: number, to: number, taskId: string, state: "open"|"done"|"missing" }>}
 */
export function taskLinkSpans(doc, statusById) {
  const spans = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === "taskLink");
    if (!mark?.attrs?.taskId) return;
    const taskId = String(mark.attrs.taskId);
    const from = pos;
    const to = pos + node.nodeSize;
    // Adjacent text nodes carrying the same task (e.g. a bolded word in
    // the middle of the span) merge into one range so the paint doesn't
    // visibly fragment.
    const prev = spans[spans.length - 1];
    if (prev && prev.taskId === taskId && prev.to === from) {
      prev.to = to;
      return;
    }
    const status = statusById?.get?.(taskId);
    spans.push({
      from,
      to,
      taskId,
      state: status === undefined ? "missing" : status === "done" ? "done" : "open",
    });
  });
  return spans;
}

/**
 * Decoration specs for a doc. Split from the plugin so it's testable.
 * A "missing" task draws NOTHING — the words stay, as plain text.
 */
export function decorationsFor(doc, statusById) {
  const out = [];
  for (const span of taskLinkSpans(doc, statusById)) {
    if (span.state === "missing") continue;
    out.push({
      type: "inline",
      from: span.from,
      to: span.to,
      class:
        span.state === "done"
          ? `${TASK_LINK_OPEN_CLASS} ${TASK_LINK_DONE_CLASS}`
          : TASK_LINK_OPEN_CLASS,
    });
    // The dot is a widget, not document content: it can't be typed over,
    // selected, copied, or saved into the note. It exists so the text
    // itself stays ordinary clickable, editable text.
    out.push({ type: "widget", pos: span.to, taskId: span.taskId, state: span.state });
  }
  return out;
}

/**
 * @param {{ onOpenTask?: (taskId: string) => void }} opts
 */
export function taskLinkStatePlugin({ onOpenTask } = {}) {
  return new Plugin({
    key: taskLinkStateKey,
    state: {
      init: () => ({ statusById: new Map(), decorations: DecorationSet.empty }),
      apply(tr, value, _oldState, newState) {
        const incoming = tr.getMeta(taskLinkStateKey);
        const statusById = incoming instanceof Map ? incoming : value.statusById;
        // Nothing to redo when neither the doc nor the task state moved.
        if (!incoming && !tr.docChanged) return value;
        return { statusById, decorations: build(newState.doc, statusById, onOpenTask) };
      },
    },
    props: {
      decorations(state) {
        return taskLinkStateKey.getState(state)?.decorations || DecorationSet.empty;
      },
    },
  });
}

function build(doc, statusById, onOpenTask) {
  const decos = [];
  for (const spec of decorationsFor(doc, statusById)) {
    if (spec.type === "inline") {
      decos.push(Decoration.inline(spec.from, spec.to, { class: spec.class }));
    } else {
      decos.push(
        Decoration.widget(spec.pos, () => renderDot(spec, onOpenTask), {
          side: 1,
          // Keep the widget out of the document's own coordinate space so
          // typing next to it behaves like typing next to plain text.
          ignoreSelection: true,
          // The dot owns its own clicks; the editor must not treat them
          // as an attempt to move the caret.
          stopEvent: () => true,
        })
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

function renderDot(spec, onOpenTask) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "task-link-dot";
  btn.contentEditable = "false";
  btn.setAttribute("data-task-dot", spec.taskId);
  btn.setAttribute("aria-label", spec.state === "done" ? "Open completed task" : "Open task");
  btn.title = spec.state === "done" ? "Completed task — open" : "Open task";
  // mousedown, not click: the editor would otherwise move the selection
  // into the widget before the handler runs.
  btn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenTask?.(spec.taskId);
  });
  return btn;
}

export const TaskLink = Mark.create({
  name: "taskLink",
  // Text typed at either edge falls OUTSIDE the span.
  inclusive: false,
  // Coexists with bold/italic/highlight instead of replacing them, so
  // formatting the surrounding paragraph can't break the link.
  excludes: "",
  spanning: true,

  addAttributes() {
    return {
      taskId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-task-id"),
        renderHTML: (attrs) => (attrs.taskId ? { "data-task-id": attrs.taskId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-task-id]" }];
  },

  // Neutral class only — the paint comes from decorations, so a mark
  // whose task no longer exists renders as ordinary text.
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: TASK_LINK_CLASS }), 0];
  },

  addCommands() {
    return {
      setTaskLink:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetTaskLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
