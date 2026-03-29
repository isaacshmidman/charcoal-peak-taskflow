import { Button } from "@/components/ui/button";
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete Recurring Task</DialogTitle>
          <DialogDescription className="sr-only">
            Choose whether to delete only this occurrence of {task?.title || "this recurring task"} or all future occurrences.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="w-full h-auto py-2 text-center whitespace-normal"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="w-full h-auto py-2 text-center whitespace-normal bg-orange-500 hover:bg-orange-600 text-white"
            data-testid="recurring-delete-this"
            onClick={() => { onDeleteThis(); onOpenChange(false); }}
          >
            Delete This Task Only
          </Button>
          <Button
            type="button"
            className="w-full h-auto py-2 text-center whitespace-normal bg-red-600 hover:bg-red-700 text-white"
            data-testid="recurring-delete-all"
            onClick={() => { onDeleteAll(); onOpenChange(false); }}
          >
            Delete All Future Tasks
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
