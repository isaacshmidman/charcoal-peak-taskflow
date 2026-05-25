// @ts-nocheck
/**
 * @file Title input + Description textarea. The first two fields of the
 * TaskForm dialog.
 */
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function TitleAndDescription({ form, setForm }) {
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

      <Textarea
        placeholder="Add details (optional)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className="h-20 resize-none"
      />
    </>
  );
}
