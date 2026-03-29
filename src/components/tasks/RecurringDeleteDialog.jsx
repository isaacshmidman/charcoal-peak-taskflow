import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete recurring reminder?</AlertDialogTitle>
          <AlertDialogDescription>
            "{task?.title}" is a recurring task. Would you like to delete just this reminder, or this and all future reminders?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-orange-500 hover:bg-orange-600 text-white"
            data-testid="recurring-delete-this"
            onClick={() => { onDeleteThis(); onOpenChange(false); }}
          >
            Delete this reminder only
          </AlertDialogAction>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700 text-white"
            data-testid="recurring-delete-all"
            onClick={() => { onDeleteAll(); onOpenChange(false); }}
          >
            Delete all future reminders
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
