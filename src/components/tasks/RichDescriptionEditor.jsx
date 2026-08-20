// @ts-nocheck
/**
 * @file Rich-text task description editor (TipTap v3). Lazy-loaded
 * behind the TaskForm modal so its ~120 KB never enters the initial
 * PWA bundle.
 *
 * Storage contract (see content.js): the editor is hydrated from a
 * stored ProseMirror JSON string (`valueJson`) when present, else from
 * the plaintext mirror (`plainFallback`). On every change it calls
 * `onChange({ json, text })` — both empty ("") for an empty document.
 * The parent stores `json` in `description_json` and `text` in the
 * legacy `description` column (notifications/search keep reading the
 * plaintext mirror).
 *
 * Toolbar: a docked bar shown only while the editor is focused (or a
 * picker is open). All buttons use onMouseDown+preventDefault so they
 * never blur the editable on iOS — see Toolbar.jsx.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontFamily } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import CharacterCount from "@tiptap/extension-character-count";
import { OrderedListWithStyle, BulletListWithStyle } from "./richtext/orderedListStyle";
import { ParagraphIndent } from "./richtext/paragraphIndent";
import { initialContentFrom, normalizeOutput, WORD_LIMIT } from "./richtext/content";
import Toolbar from "./richtext/Toolbar";
import { TaskLink, taskLinkStateKey, taskLinkStatePlugin } from "./richtext/taskLink";
import { cn } from "@/lib/utils";

const NON_INSERT_KEYS = new Set([
  "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Home", "End", "PageUp", "PageDown", "Tab", "Enter", "Escape",
]);

/**
 * @param {object} props
 * @param {Map<string, string>} [props.taskStatusById]  taskId → status, for
 *   note↔task highlights. Omit entirely (task descriptions) and the taskLink
 *   machinery stays inert.
 * @param {(text: string, range: {from: number, to: number}) => void} [props.onMakeTask]
 * @param {(taskId: string) => void} [props.onOpenTask]
 * @param {(editor: any) => void} [props.onEditorReady]
 */
export default function RichDescriptionEditor({
  valueJson, plainFallback, onChange, disabled, wordLimit = WORD_LIMIT,
  taskStatusById, onMakeTask, onOpenTask, onEditorReady,
  chromeless = false, minHeight = "5rem",
  // "docked" renders the toolbar inside this component (task forms).
  // "external" hands focus state up so the host can place the toolbar
  // itself — Notes puts it above the title, like Apple Notes.
  toolbar = "docked", onFocusChange,
}) {
  // Hydrate once from the incoming props. We intentionally do NOT make
  // the editor a controlled mirror of valueJson on every keystroke
  // (that fights the cursor); the form re-keys the whole TaskForm on
  // open, so a fresh editor mounts per task.
  const initialRef = useRef(initialContentFrom(valueJson, plainFallback));
  // The ProseMirror plugin is built once when the editor is created, so it
  // closes over a ref rather than the prop — otherwise opening a task from
  // a note would call whatever handler existed on first render.
  const onOpenTaskRef = useRef(onOpenTask);
  onOpenTaskRef.current = onOpenTask;
  // Same reason: the editor's callbacks are bound once at creation.
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const editor = useEditor({
    editable: !disabled,
    // TipTap v3 stopped re-rendering per transaction by default, which
    // silently froze everything in the toolbar that reads editor state:
    // the Bold/Italic/list active states never updated, and Make task
    // could never see a selection. Opt back in.
    shouldRerenderOnTransaction: true,
    extensions: [
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
      // The plugin paints taskLink spans from live task state. Registered
      // unconditionally so the mark round-trips everywhere, but with no
      // task map supplied it decorates nothing.
      Extension.create({
        name: "taskLinkState",
        addProseMirrorPlugins: () => [taskLinkStatePlugin({ onOpenTask: (id) => onOpenTaskRef.current?.(id) })],
      }),
    ],
    content: initialRef.current,
    editorProps: {
      attributes: {
        // minHeight is baked in at creation — it never changes for a
        // given host (dialog vs full-page note), so this needs no reactivity.
        class: `tiptap-prose focus:outline-none px-3 py-2`,
        style: `min-height: ${minHeight}`,
      },
      // Hard word cap: block character insertion + paste past the limit,
      // while always allowing navigation/deletion so the user can edit
      // back down. Enter (a new block, not a word) stays allowed.
      handleKeyDown(view, event) {
        if (event.metaKey || event.ctrlKey || event.altKey) return false;
        if (NON_INSERT_KEYS.has(event.key)) return false;
        if (event.key.length !== 1) return false;
        const words = editor?.storage.characterCount?.words?.() ?? 0;
        const { empty } = view.state.selection;
        // Only block when typing into an empty selection at/over the cap
        // (replacing a selection can't grow the word count).
        if (words >= wordLimit && empty) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      handlePaste(view) {
        const words = editor?.storage.characterCount?.words?.() ?? 0;
        if (words >= wordLimit) return true; // swallow the paste
        return false;
      },
    },
    onUpdate({ editor }) {
      onChange?.(normalizeOutput({
        isEmpty: editor.isEmpty,
        json: editor.getJSON(),
        text: editor.getText(),
      }));
    },
    onFocus() { setFocused(true); onFocusChangeRef.current?.(true); },
    onBlur() {
      // Defer so opening a picker (which momentarily blurs) doesn't flash
      // the toolbar closed; the picker sets pickerOpen synchronously.
      setTimeout(() => { setFocused(false); onFocusChangeRef.current?.(false); }, 0);
    },
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  // Push live task state into the decoration plugin. This dispatches a
  // META-ONLY transaction: docChanged stays false, so TipTap does not fire
  // onUpdate and the note is NOT re-saved. That matters — without it every
  // task status change anywhere in the app would rewrite every open note.
  const statusKey = useMemo(
    () => (taskStatusById ? [...taskStatusById.entries()].map(([k, v]) => k + ':' + v).sort().join(',') : ''),
    [taskStatusById]
  );
  useEffect(() => {
    if (!editor || !taskStatusById) return;
    editor.view.dispatch(editor.state.tr.setMeta(taskLinkStateKey, taskStatusById));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, statusKey]);

  // Hand the editor instance up so the page can read the selection, apply
  // the taskLink mark after a task is created, and restore the caret.
  useEffect(() => {
    if (editor) onEditorReady?.(editor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const showToolbar = toolbar === "docked" && !disabled && (focused || pickerOpen);

  return (
    <div
      className={cn(
        "transition-colors",
        // Chromeless: the note IS the page, so no card around the words.
        chromeless
          ? "h-full"
          : cn(
              "rounded-md border bg-white dark:bg-[#0c0c0c]",
              showToolbar ? "border-slate-300 dark:border-[#454545]" : "border-slate-200 dark:border-[#343434]"
            )
      )}
      // Keep the editor focused when interacting with the toolbar chrome.
      onMouseDown={(e) => {
        if (e.target.closest?.("[data-richtext-toolbar]")) return;
      }}
    >
      <EditorContent editor={editor} />
      {showToolbar && (
        <div
          data-richtext-toolbar
          // In a full-page note the body scrolls, so the toolbar sticks to
          // the bottom instead of drifting off with the text.
          className={cn(chromeless && "sticky bottom-0 z-10 rounded-md border border-slate-200 bg-white dark:border-[#343434] dark:bg-[#0c0c0c]")}
        >
          <Toolbar
            editor={editor}
            onPickerOpenChange={setPickerOpen}
            wordLimit={wordLimit}
            onMakeTask={onMakeTask}
          />
        </div>
      )}
    </div>
  );
}
