// @ts-nocheck
/**
 * @file Title input + rich-text Description editor. The first two fields
 * of the TaskForm dialog.
 *
 * The TipTap editor (~133 KB gzipped) is lazy-loaded so it never enters
 * the initial PWA bundle — it loads when a TaskForm first opens. Two
 * fallbacks guard the load:
 *   - Suspense: a textarea-shaped skeleton while the chunk is in flight.
 *   - EditorLoadBoundary: if the chunk FAILS to load (e.g. the user is
 *     offline and it isn't cached yet), degrade to a plain <textarea>
 *     that edits the plaintext `description`. Without this boundary a
 *     failed lazy import throws in render and unmounts the whole form
 *     subtree (detaching the title input) — which is exactly what the
 *     offline e2e test caught.
 */
import { Component, lazy, Suspense } from "react";
import { Textarea } from "@/components/ui/textarea";
import TitleTokenInput from "@/components/tasks/QuickAdd/TitleTokenInput";

const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

/** Catches a failed lazy editor load and renders `fallback` instead.
 * Exported for reuse by other rich-text hosts (NoteEditor). */
export class EditorLoadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Swallow — the fallback textarea keeps the form usable. (A console
    // error here would just be noise; the offline case is expected.)
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

/** Plain-text degradation when the rich editor can't load. Edits the
 * plaintext mirror and clears the rich JSON (only on actual edits). */
function PlainDescriptionFallback({ form, setForm }) {
  return (
    <Textarea
      placeholder="Add details (optional)"
      value={form.description || ""}
      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value, description_json: "" }))}
      className="h-20 resize-none"
    />
  );
}

export default function TitleAndDescription({ form, setForm, task, priorities = [], savedTags = [], onTitleEnter }) {
  // The editor hydrates ONCE at mount. Read its initial content straight
  // from the `task` prop (available on first render) rather than from
  // `form.description_json` — the form's hydration effect runs after the
  // first paint, so reading the form here would mount the editor empty
  // and miss an existing task's content. Keying by task id (or "new")
  // remounts the editor when you switch which task you're editing, but
  // NOT on every keystroke (onChange writes to form, never to the key).
  const editorKey = task?.id || "new";
  return (
    <>
      {/* Title understands in-title tokens: !priority / #tag (dropdown),
          and natural-language dates/times/"every…" recurrence, applied to
          the real fields on completion. */}
      <TitleTokenInput
        form={form}
        setForm={setForm}
        grammar={{ dates: true, times: true, recurrence: true, tags: true, priority: true }}
        priorities={priorities}
        savedTags={savedTags}
        placeholder="What needs to be done?"
        testid="task-form-title"
        // Enter in the title finishes the task (already autosaved); the
        // description below keeps Enter as a paragraph break.
        onEnter={onTitleEnter}
      />

      <EditorLoadBoundary fallback={<PlainDescriptionFallback form={form} setForm={setForm} />}>
        <Suspense
          fallback={
            <div className="h-20 rounded-md border border-slate-200 dark:border-[#343434] bg-white dark:bg-[#0c0c0c] px-3 py-2 text-sm text-slate-400 dark:text-slate-500">
              Loading editor…
            </div>
          }
        >
          <RichDescriptionEditor
            key={editorKey}
            valueJson={task?.description_json}
            plainFallback={task?.description}
            onChange={({ json, text }) => setForm((f) => ({ ...f, description_json: json, description: text }))}
          />
        </Suspense>
      </EditorLoadBoundary>
    </>
  );
}
