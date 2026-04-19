// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { apiClient } from "@/api/apiClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isOnline, queueTagMutation } from "@/lib/offlineCache";
import { isRecoverableConnectionError } from "@/lib/network";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar as CalendarIcon, X, Plus, Trash2, CheckSquare } from "lucide-react";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useOutsideClick } from "@/hooks/useOutsideClick";
import { getNextRecurrenceDate } from "@/lib/recurrence";

const toDateStr = (date) => format(date, "yyyy-MM-dd");
const fromDateStr = (str) => new Date(str + "T00:00:00");

const WEEKDAYS = [
  { label: "S", fullLabel: "Sun", value: 0 },
  { label: "M", fullLabel: "Mon", value: 1 },
  { label: "T", fullLabel: "Tue", value: 2 },
  { label: "W", fullLabel: "Wed", value: 3 },
  { label: "T", fullLabel: "Thu", value: 4 },
  { label: "F", fullLabel: "Fri", value: 5 },
  { label: "S", fullLabel: "Sat", value: 6 },
];

const defaultTask = {
  title: "",
  description: "",
  priority_id: "",
  status: "todo",
  task_type: "one_time",
  recurrence: "none",
  recurrence_days: [],
  recurrence_end_date: "",
  due_date: "",
  task_time: "",
  tags: [],
  subtask_titles: [],
};

export default function TaskForm({ open, onOpenChange, task, onSubmit, onDelete, parentId, existingSubtasks = [], onToggleSubtask, onDeleteSubtask, onEditSubtask, defaultDueDate }) {
  const [form, setForm] = useState(defaultTask);
  const [tagInput, setTagInput] = useState("");
  const [tagInputFocused, setTagInputFocused] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);
  const [subtaskInput, setSubtaskInput] = useState("");
  const [dayError, setDayError] = useState(false);
  const queryClient = useQueryClient();

  // Priorities — sorted by order so dropdown always reflects latest order from Settings
  const { data: rawPriorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });
  const priorities = [...rawPriorities].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100),
  });

  // Auto-save new tags to SavedTag (both online and offline)
  const persistNewTags = (tags) => {
    const existingNames = new Set((queryClient.getQueryData(["savedTags"]) || []).map(t => t.name));
    const newTags = tags.filter(t => !existingNames.has(t));
    if (!newTags.length) return;
    const now = new Date().toISOString();
    const optimistic = newTags.map(name => ({ id: `offline_tag_${Date.now()}_${name}`, name, created_date: now }));
    queryClient.setQueryData(["savedTags"], (old = []) => [...old, ...optimistic]);
    if (isOnline()) {
      newTags.forEach((name) => {
        apiClient.entities.SavedTag.create({ name }).catch((error) => {
          if (isRecoverableConnectionError(error)) {
            queueTagMutation({ type: "create", name });
          }
        });
      });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["savedTags"] }), 600);
    } else {
      newTags.forEach(name => queueTagMutation({ type: "create", name }));
    }
  };



  // Stable serialized key for priorities so we don't re-run on every render
  const prioritiesKey = priorities.map(p => p.id + p.order).join(",");

  useEffect(() => {
    if (task) {
      setForm({ ...defaultTask, ...task, tags: task.tags || [], recurrence_days: task.recurrence_days || [], recurrence_end_date: task.recurrence_end_date || "", task_time: task.task_time || "", subtask_titles: [] });
      setShowEndDate(!!task.recurrence_end_date);
    } else {
      // Default to the middle priority by order
      const mid = Math.floor(priorities.length / 2);
      const defaultPriority = priorities[mid] || priorities[0] || null;
      const dueDate = defaultDueDate ?? format(new Date(), "yyyy-MM-dd");
      setForm({ ...defaultTask, priority_id: defaultPriority?.id || "", parent_id: parentId || "", due_date: dueDate });
      setShowEndDate(false);
    }
    setTagInput("");
    setSubtaskInput("");
    setDayError(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, open, prioritiesKey]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (
      form.task_type === "recurring" &&
      form.recurrence === "custom_days" &&
      (form.recurrence_days || []).length === 0
    ) {
      setDayError(true);
      return;
    }
    const data = { ...form };
    if (parentId && !task) data.parent_id = parentId;
    if (data.task_type !== "recurring") { data.recurrence = "none"; data.recurrence_days = []; data.recurrence_end_date = ""; }
    if (data.recurrence !== "custom_days") data.recurrence_days = [];
    const subtaskTitles = (data.subtask_titles || []).filter(t => t.trim());
    delete data.subtask_titles;
    // Persist any new tags to SavedTag
    if (data.tags?.length) persistNewTags(data.tags);
    onSubmit(data, subtaskTitles);
    onOpenChange(false);
  };

  const addSubtask = () => {
    const val = subtaskInput.trim();
    if (!val) return;
    setForm({ ...form, subtask_titles: [...(form.subtask_titles || []), val] });
    setSubtaskInput("");
  };

  const removeSubtask = (idx) => {
    setForm({ ...form, subtask_titles: form.subtask_titles.filter((_, i) => i !== idx) });
  };

  const toggleRecurrenceDay = (day) => {
    const days = form.recurrence_days || [];
    const updated = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
    setForm({ ...form, recurrence_days: updated.sort((a, b) => a - b) });
    setDayError(false);
  };

  const addTag = (tagName) => {
    const tag = (tagName || tagInput).trim();
    if (tag && !form.tags.includes(tag)) {
      setForm({ ...form, tags: [...form.tags, tag] });
    }
    setTagInput("");
  };

  const removeTag = (tag) => setForm({ ...form, tags: form.tags.filter(t => t !== tag) });

  const colorDotClass = {
    red: "bg-red-400", orange: "bg-orange-400", yellow: "bg-yellow-400",
    green: "bg-green-400", blue: "bg-blue-400", violet: "bg-violet-400",
    pink: "bg-pink-400", teal: "bg-teal-400", cyan: "bg-cyan-400",
    rose: "bg-rose-400", slate: "bg-slate-400",
  };

  const filteredSuggestions = savedTags
    .map((tag) => tag.name)
    .filter((tag) => !form.tags.includes(tag))
    .filter((tag) => !tagInput || tag.toLowerCase().includes(tagInput.toLowerCase()))
    .slice(0, 30);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-md max-h-[90vh] overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
          data-testid="task-form-dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-slate-900">
              {task ? "Edit Task" : parentId ? "New Subtask" : "New Task"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-slate-900 mb-1.5 block">Priority</Label>
                <Select value={form.priority_id} onValueChange={(v) => setForm({ ...form, priority_id: v })}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {priorities.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          <span className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", colorDotClass[p.color] || colorDotClass.slate)} />
                          {p.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-900 mb-1.5 block">Type</Label>
                <Select value={form.task_type} onValueChange={(v) => setForm({ ...form, task_type: v, recurrence: v === "recurring" ? "weekly" : form.recurrence })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="recurring">Recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.task_type === "recurring" && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold text-slate-900 mb-1.5 block">Repeats</Label>
                  <Select
                    value={form.recurrence}
                    onValueChange={(v) => {
                      setForm({ ...form, recurrence: v });
                      if (v !== "custom_days") setDayError(false);
                    }}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
                      <SelectItem value="custom_days">Custom days of week</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Biweekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.recurrence === "custom_days" && (
                  <div>
                    <Label className="text-xs font-semibold text-slate-900 mb-2 block">Select days</Label>
                    <div className="flex gap-1.5">
                      {WEEKDAYS.map((day) => {
                        const selected = (form.recurrence_days || []).includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => toggleRecurrenceDay(day.value)}
                            title={day.fullLabel}
                            className={cn(
                              "w-9 h-9 rounded-full text-xs font-semibold transition-all border-2",
                              selected
                                ? "bg-slate-900 text-white border-slate-900"
                                : "bg-slate-100 text-slate-500 hover:bg-slate-200 border-transparent",
                              dayError && "border-red-500"
                            )}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs font-semibold text-slate-900 mb-1.5 block">Repeats until</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={showEndDate ? "until" : "indefinite"}
                      onValueChange={(v) => {
                        if (v === "indefinite") {
                          setShowEndDate(false);
                          setForm({ ...form, recurrence_end_date: "" });
                        } else {
                          setShowEndDate(true);
                          // Default end date to the next occurrence — user can override via the picker.
                          if (!form.recurrence_end_date) {
                            const next = getNextRecurrenceDate({
                              due_date: form.due_date,
                              recurrence: form.recurrence,
                              recurrence_days: form.recurrence_days,
                            });
                            if (next) {
                              setForm((f) => ({ ...f, recurrence_end_date: toDateStr(next) }));
                            }
                          }
                        }
                      }}
                    >
                      <SelectTrigger className={cn("h-9", showEndDate ? "flex-1" : "w-full")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="indefinite">Indefinitely</SelectItem>
                        <SelectItem value="until">Set end date</SelectItem>
                      </SelectContent>
                    </Select>
                    {showEndDate && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="h-9 flex-1 justify-start text-sm font-normal">
                            <CalendarIcon className="w-4 h-4 mr-2 text-slate-400" />
                            {form.recurrence_end_date ? format(fromDateStr(form.recurrence_end_date), "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.recurrence_end_date ? fromDateStr(form.recurrence_end_date) : undefined}
                            onSelect={(date) => { if (date) setForm({ ...form, recurrence_end_date: toDateStr(date) }); }}
                            showOutsideDays fixedWeeks
                          />
                          <div className="p-2 border-t">
                            <Button type="button" variant="ghost" size="sm" className="w-full text-xs" onClick={() => setForm({ ...form, recurrence_end_date: "" })}>
                              Clear
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Date + Time */}
            <div className="space-y-2">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label className="text-xs font-semibold text-slate-900 mb-1.5 block">Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start h-9 text-sm font-normal">
                        <CalendarIcon className="w-4 h-4 mr-2 text-slate-400" />
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
                          <Button type="button" variant="ghost" size="sm" className="w-full text-xs" onClick={() => setForm({ ...form, due_date: "", task_time: "" })}>
                            Clear date
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>

                {form.due_date && (
                  <div className="flex flex-col items-center gap-1 pb-0.5">
                    <Label className="text-xs font-semibold text-slate-900">Set time</Label>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, task_time: form.task_time ? "" : "9:00AM" })}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${form.task_time ? "bg-slate-900" : "bg-slate-200"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${form.task_time ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                )}
              </div>

              {form.due_date && form.task_time && (
                <TimeInput value={form.task_time} onChange={(v) => setForm({ ...form, task_time: v })} />
              )}
            </div>

            {/* Tags */}
            <div>
              <Label className="text-xs font-semibold text-slate-900 mb-1.5 block">Tags</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    placeholder="Type or pick a tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    onFocus={() => setTagInputFocused(true)}
                    onBlur={() => setTimeout(() => setTagInputFocused(false), 150)}
                    className=""
                  />
                  {tagInputFocused && filteredSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                      {filteredSuggestions.map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
                          className="w-full text-left text-xs font-medium px-3 py-1.5 hover:bg-slate-50 text-slate-900"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button type="button" size="sm" onClick={() => addTag()} className="h-9 px-3 bg-slate-900 hover:bg-slate-800 text-white">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="text-slate-400 hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Subtasks — not shown when this form IS a subtask form */}
            {!parentId && (
              <div>
                <Label className="text-xs font-semibold text-slate-900 mb-1.5 block">Subtasks</Label>

                <div className="flex gap-2">
                  <Input
                    placeholder="Add a subtask..."
                    value={subtaskInput}
                    onChange={(e) => setSubtaskInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
                    className=""
                  />
                  <Button type="button" size="sm" onClick={addSubtask} className="h-9 px-3 bg-slate-900 hover:bg-slate-800 text-white">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                {/* Existing subtasks (when editing) */}
                {task && existingSubtasks.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {existingSubtasks.map((sub) => (
                      <div key={sub.id} className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold group">
                        <button
                          type="button"
                          onClick={() => onToggleSubtask && onToggleSubtask(sub)}
                          className={cn(
                            "shrink-0 w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-all",
                            sub.status === "done" ? "bg-slate-900 border-slate-900 text-white" : "border-slate-400 hover:border-slate-600"
                          )}
                        >
                          {sub.status === "done" && <CheckSquare className="w-2 h-2" />}
                        </button>
                        <span
                          className={cn("cursor-pointer hover:text-slate-600", sub.status === "done" && "line-through opacity-50")}
                          onClick={() => onEditSubtask && onEditSubtask(sub)}
                        >
                          {sub.title}
                        </span>
                        <button
                          type="button"
                          onPointerDown={(e) => { e.preventDefault(); onDeleteSubtask && onDeleteSubtask(sub); }}
                          className="text-slate-400 hover:text-red-400 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {(form.subtask_titles || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(form.subtask_titles || []).map((title, idx) => (
                      <div key={idx} className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold group">
                        <div className="shrink-0 w-3.5 h-3.5 rounded border-2 border-slate-400" />
                        <span>{title}</span>
                        <button type="button" onPointerDown={(e) => { e.preventDefault(); removeSubtask(idx); }} className="text-slate-400 hover:text-red-400 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div>
                {task && onDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-red-400 hover:text-red-600 hover:bg-red-50"
                    data-testid="task-form-delete"
                    onClick={() => { onDelete(task); onOpenChange(false); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" className="bg-slate-900 hover:bg-slate-800" data-testid="task-form-submit">
                  {task ? "Save Changes" : "Create Task"}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>


    </>
  );
}

// Generate all time slots
function generateTimeSlots() {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const ampm = h < 12 ? "AM" : "PM";
      const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${hour}:${String(m).padStart(2, "0")}${ampm}`;
      slots.push(label);
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

function TimeInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);
  const selectedRef = useRef(null);
  const containerRef = useRef(null);

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
        className="w-full flex items-center justify-between px-3 py-1.5 border border-slate-200 rounded-lg bg-white text-sm text-slate-700 hover:bg-slate-50 transition-colors"
      >
        {value}
        <svg className={cn("w-3.5 h-3.5 text-slate-400 transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-md w-full">
          <div ref={listRef} className="max-h-48 overflow-y-auto">
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
                    isSelected ? "bg-slate-900 text-white font-medium" : "text-slate-700 hover:bg-slate-50"
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
