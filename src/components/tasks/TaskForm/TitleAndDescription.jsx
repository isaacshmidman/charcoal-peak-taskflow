// @ts-nocheck
/**
 * @file Title input + rich-text Description editor. The first two fields
 * of the TaskForm dialog.
 *
 * The TipTap editor (~120 KB) is lazy-loaded so it never enters the
 * initial PWA bundle — it loads when a TaskForm first opens. While the
 * chunk is in flight, a plain textarea-shaped skeleton stands in.
 */
import { lazy, Suspense } from "react";
import { Input } from "@/components/ui/input";

const RichDescriptionEditor = lazy(() => import("@/components/tasks/RichDescriptionEditor"));

export default function TitleAndDescription({ form, setForm, task }) {
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
      <Input
        placeholder="What needs to be done?"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        className=""
        autoFocus={false}
        data-testid="task-form-title"
      />

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
    </>
  );
}
