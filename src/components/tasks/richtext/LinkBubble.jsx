// @ts-nocheck
/**
 * @file The link bar: a small bubble under a link while the caret is in
 * it, showing where the link really goes (whatever its text says) with
 * Open, Edit and Remove. The same bubble is the editor for adding a link,
 * opened by the toolbar's Link button or ⌘K (SafeLink.openLinkEditor).
 *
 * A plain click in a link only moves the caret, so link text stays
 * editable; opening is this bar's job (or ⌘/Ctrl-click). Buttons act on
 * mousedown with preventDefault, like the toolbar, so they never blur the
 * editable on iOS. Only the URL input takes focus.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import { ExternalLink, Link2, Pencil, Unlink } from "lucide-react";
import { LINK_BUBBLE_KEY } from "./extensions";
import { linkLabel, normalizeLinkInput, openLink, safeHref } from "./links";

function BarButton({ title, testid, onAction, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testid}
      onMouseDown={(e) => { e.preventDefault(); onAction(); }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#222222]"
    >
      {children}
    </button>
  );
}

/**
 * @param {{ editor: any, onEditingChange?: (editing: boolean) => void }} props
 */
export default function LinkBubble({ editor, onEditingChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  // For onHide, which the bubble plugin may hold from an earlier render.
  const editingRef = useRef(false);

  const setEditingState = (next) => {
    editingRef.current = next;
    setEditing(next);
    onEditingChange?.(next);
  };

  // Clicking away mid-edit abandons the edit. Read through a ref so the
  // options object below never changes identity (see there).
  const onHideRef = useRef(null);
  onHideRef.current = () => {
    if (!editingRef.current) return;
    editor.storage.link.editorOpen = false;
    setEditingState(false);
  };

  // BubbleMenu re-dispatches its options whenever shouldShow or options
  // change identity, and this editor re-renders on every transaction — so
  // fresh objects per render loop forever. Both are built once.
  const bubbleProps = useMemo(
    () => ({
      shouldShow: ({ editor: ed }) => ed.isEditable && (ed.storage.link?.editorOpen || ed.isActive("link")),
      options: {
        placement: "bottom-start",
        offset: 6,
        flip: true,
        shift: { padding: 8 },
        onHide: () => onHideRef.current?.(),
      },
    }),
    []
  );

  const inLink = editor.isActive("link");
  const href = safeHref(editor.getAttributes("link").href);

  // Re-place the bar once its contents change. The bubble plugin positions
  // it as it opens — often before React has filled it in — so it was
  // measured narrow and then grew rightwards off a phone's screen. A
  // layout effect runs right after React writes the new contents.
  useLayoutEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(LINK_BUBBLE_KEY, "updatePosition"));
  }, [editor, inLink, href, editing, error]);

  const startEditing = () => {
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? "" : editor.state.doc.textBetween(from, to, " ").trim();
    // Editing an existing link starts from its address; a selection that
    // is itself an address starts from that; otherwise start empty.
    setDraft(inLink ? href || "" : normalizeLinkInput(selected) ? selected : "");
    setError("");
    setEditingState(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const close = ({ refocus = true } = {}) => {
    editor.storage.link.editorOpen = false;
    setEditingState(false);
    setError("");
    if (refocus) editor.chain().focus().run();
    // With the caret outside any link there's nothing left to show.
    if (!editor.isActive("link")) editor.view.dispatch(editor.state.tr.setMeta(LINK_BUBBLE_KEY, "hide"));
  };

  // Toolbar button / ⌘K flag an open request through the extension's
  // storage; this re-renders on every transaction, so it sees it at once.
  useEffect(() => {
    if (editor.storage.link?.editorOpen && !editing) startEditing();
  });

  const save = () => {
    const next = normalizeLinkInput(draft);
    if (!next) {
      setError("Enter a web address or an email.");
      return;
    }
    const chain = editor.chain().focus();
    if (editor.isActive("link")) {
      chain.extendMarkRange("link").setLink({ href: next });
    } else if (editor.state.selection.empty) {
      // Nothing selected: the address itself becomes the link text. Unset
      // the stored mark after, or the next word typed would join the link.
      chain
        .insertContent({ type: "text", text: draft.trim(), marks: [{ type: "link", attrs: { href: next } }] })
        .unsetMark("link");
    } else {
      chain.setLink({ href: next });
    }
    chain.run();
    close({ refocus: false });
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    close({ refocus: false });
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={LINK_BUBBLE_KEY}
      updateDelay={0}
      shouldShow={bubbleProps.shouldShow}
      options={bubbleProps.options}
      className="z-50"
      data-testid="richtext-link-bubble"
    >
      <div className="flex max-w-[calc(100vw-2rem)] items-center gap-0.5 rounded-lg border border-border-strong bg-surface-card p-1 shadow-lg">
        {editing ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => { e.preventDefault(); save(); }}
          >
            <Link2 className="ml-1 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
            <div className="flex flex-col">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
                }}
                placeholder="Paste or type a link"
                aria-label="Link address"
                data-testid="richtext-link-input"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                // 16px on phones so iOS doesn't zoom on focus.
                className="h-7 w-56 max-w-[60vw] rounded-md border border-slate-200 bg-white px-2 text-base text-slate-900 outline-none focus:border-slate-400 dark:border-[#343434] dark:bg-[#0c0c0c] dark:text-slate-100 md:text-sm"
              />
              {error && <span className="px-1 pt-0.5 text-[11px] text-red-600 dark:text-red-400">{error}</span>}
            </div>
            <button
              type="submit"
              data-testid="richtext-link-save"
              className="h-7 shrink-0 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Save
            </button>
          </form>
        ) : (
          href && (
            <>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={href}
                data-testid="richtext-link-label"
                onMouseDown={(e) => e.preventDefault()}
                className="max-w-[14rem] truncate px-1.5 text-xs text-blue-600 underline underline-offset-2 dark:text-blue-400"
              >
                {linkLabel(href)}
              </a>
              <BarButton title="Open link" testid="richtext-link-open" onAction={() => openLink(href)}>
                <ExternalLink className="h-3.5 w-3.5" />
              </BarButton>
              <BarButton title="Edit link" testid="richtext-link-edit" onAction={startEditing}>
                <Pencil className="h-3.5 w-3.5" />
              </BarButton>
              <BarButton title="Remove link" testid="richtext-link-remove" onAction={remove}>
                <Unlink className="h-3.5 w-3.5" />
              </BarButton>
            </>
          )
        )}
      </div>
    </BubbleMenu>
  );
}
