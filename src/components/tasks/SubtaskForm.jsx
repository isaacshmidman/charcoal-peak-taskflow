// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/useAutosave";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import TitleTokenInput from "@/components/tasks/QuickAdd/TitleTokenInput";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, Trash2 } from "lucide-react";
import { format } from "date-fns/format";
import { useOutsideClick } from "@/hooks/useOutsideClick";
import { fromDateStr, toDateStr } from "@/lib/dates";

/**
 * @typedef {import("@/types/tasks").TaskCreateInput} TaskCreateInput
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   task?: TaskRecord | null,
 *   parentId?: string,
 *   onSubmit: (data: TaskCreateInput) => void,
 *   onDelete?: (task: TaskRecord) => void,
 * }} props
 */
export default function SubtaskForm({ open, onOpenChange, task, parentId, onSubmit, onDelete }) {
  /** @type {[TaskCreateInput, import("react").Dispatch<import("react").SetStateAction<TaskCreateInput>>]} */
  const [form, setForm] = useState({ title: "", description: "", due_date: "", task_time: "" });
  // Frozen at open — keeps the button label from flipping during close.
  const [isEditMode, setIsEditMode] = useState(!!task);
  const idRef = useRef(task?.id || null);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title || "",
        description: task.description || "",
        due_date: task.due_date || "",
        task_time: task.task_time || "",
      });
    } else {
      const todayStr = format(new Date(), "yyyy-MM-dd");
      setForm({ title: "", description: "", due_date: todayStr, task_time: "" });
    }
  }, [task, open]);

  const isValid = !!form.title.trim();
  const payload = useMemo(() => ({ ...form, ...(parentId ? { parent_id: parentId } : {}) }), [form, parentId]);

  // Upsert: create on first valid write (parent adds parent_id), then update.
  const saveSubtask = useCallback(async (data) => {
    const res = await onSubmit(data, idRef.current);
    if (res?.id) idRef.current = res.id;
    return res;
  }, [onSubmit]);

  const { flush, reset } = useAutosave({ payload, valid: isValid, onSave: saveSubtask });

  const initedRef = useRef(false);
  useEffect(() => {
    if (!open) { initedRef.current = false; return; }
    if (initedRef.current) return;
    initedRef.current = true;
    idRef.current = task?.id || null;
    setIsEditMode(!!task);
    const initial = task
      ? { title: task.title || "", description: task.description || "", due_date: task.due_date || "", task_time: task.task_time || "" }
      : { title: "", description: "", due_date: format(new Date(), "yyyy-MM-dd"), task_time: "" };
    reset({ ...initial, ...(parentId ? { parent_id: parentId } : {}) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const commitAndClose = () => { if (isValid) flush(); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { commitAndClose(); } else { onOpenChange(true); } }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isEditMode ? "Edit Subtask" : "Add Subtask"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          {/* Title parses natural-language dates/times only (subtasks
              have no tags/priority/recurrence). */}
          <TitleTokenInput
            form={form}
            setForm={setForm}
            grammar={{ dates: true, times: true, recurrence: false, tags: false, priority: false }}
            placeholder="What needs to be done?"
          />

          <Textarea
            placeholder="Add details (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="h-20 resize-none"
          />

          {/* Date + Time */}
          <div className="space-y-2">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start h-9 text-sm font-normal">
                      <CalendarIcon className="w-4 h-4 mr-2 text-slate-400 dark:text-slate-500" />
                      {form.due_date ? format(fromDateStr(form.due_date), "PPP") : "No date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={form.due_date ? fromDateStr(form.due_date) : undefined}
                      onSelect={(date) => { if (date) setForm({ ...form, due_date: toDateStr(date) }); }}
                      showOutsideDays fixedWeeks
                    />
                    {form.due_date && (
                      <div className="p-2 border-t">
                        <Button variant="ghost" size="sm" className="w-full text-xs"
                          onClick={() => setForm({ ...form, due_date: "", task_time: "" })}>
                          Clear date
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              {form.due_date && (
                <div className="flex flex-col items-center gap-1 pb-0.5">
                  <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100">Set time</Label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, task_time: form.task_time ? "" : "9:00AM" })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${form.task_time ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-200 dark:bg-[#222222]"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-900 shadow transition-transform duration-200 ${form.task_time ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              )}
            </div>

            {form.due_date && form.task_time && (
              <TimeInput value={form.task_time} onChange={(v) => setForm({ ...form, task_time: v })} />
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              {task && onDelete && (
                <Button type="button" variant="ghost" size="icon"
                  className="text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-[#2a1116]"
                  onClick={() => { onDelete(task); onOpenChange(false); }}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            {/* Autosaves; button greys until there's a title, then closes. */}
            <Button type="button" disabled={!isValid} onClick={commitAndClose} className="bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
              {isEditMode ? "Save Changes" : "Create Subtask"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function generateTimeSlots() {
  /** @type {string[]} */
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const ampm = h < 12 ? "AM" : "PM";
      const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      slots.push(`${hour}:${String(m).padStart(2, "0")}${ampm}`);
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

/**
 * @param {{ value: string, onChange: (value: string) => void }} props
 */
function TimeInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selectedRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  useOutsideClick(containerRef, () => setOpen(false), open);

  useEffect(() => {
    if (open && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "center" });
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-36">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 border border-border-strong rounded-lg bg-surface-card text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#222222] transition-colors"
      >
        {value}
        <svg className={cn("w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 border border-border-strong rounded-lg overflow-hidden bg-surface-card shadow-md w-full">
          <div className="max-h-48 overflow-y-auto">
            {TIME_SLOTS.map((slot) => {
              const isSelected = slot === value;
              return (
                <button
                key={slot}
                ref={isSelected ? selectedRef : null}
                type="button"
                onClick={() => { onChange(slot); setOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-base md:text-sm transition-colors",
                  isSelected ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-medium" : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#222222]"
                )}
                >
                {slot}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
