import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * @typedef {import("@/types/tasks").TaskRecord} TaskRecord
 */

/**
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   task?: TaskRecord | null,
 *   onDeleteThis: () => void,
 *   onDeleteAll: () => void,
 * }} props
 */
export default function RecurringDeleteDialog({ open, onOpenChange, task, onDeleteThis, onDeleteAll }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete recurring task</DialogTitle>
          <DialogDescription className="sr-only">
            Choose whether to delete only this occurrence of {task?.title || "this recurring task"} or all future occurrences.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <button
            type="button"
            data-testid="recurring-delete-this"
            onClick={() => { onDeleteThis(); onOpenChange(false); }}
            className="w-full h-12 rounded-xl bg-orange-400 hover:bg-orange-500 text-white text-sm font-medium shadow-sm transition-colors"
          >
            Delete this task only
          </button>
          <button
            type="button"
            data-testid="recurring-delete-all"
            onClick={() => { onDeleteAll(); onOpenChange(false); }}
            className="w-full h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium shadow-sm transition-colors"
          >
            Delete this and all future tasks
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium shadow-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
