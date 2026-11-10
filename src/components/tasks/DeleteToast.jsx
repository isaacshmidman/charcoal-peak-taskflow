import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useShortcutEvent } from "@/hooks/useShortcutEvent";
import { SHORTCUT_EVENTS } from "@/lib/shortcuts";

/**
 * Usage: call showDeleteToast({ label: "Task X was deleted", onUndo: fn })
 * `duration` (ms, default 3000) keeps a longer sentence up long enough to read.
 * This component renders itself in the bottom-left, pointer-events:none when hidden.
 * Pressing `z` (or Mod+Z) while the toast is visible triggers Undo.
 */

let _setToast = null;

export function showDeleteToast({ label, onUndo, hideUndo = false, duration = 3000 }) {
  if (_setToast) _setToast({ label, onUndo, hideUndo: hideUndo || !onUndo, duration, id: Date.now() });
}

export default function DeleteToast() {
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);
  toastRef.current = toast;

  useEffect(() => {
    _setToast = setToast;
    return () => { _setToast = null; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.duration ?? 3000);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  // Keyboard: z / Mod+Z fires Undo while the toast is on screen.
  useShortcutEvent(SHORTCUT_EVENTS.undoDelete, () => {
    const current = toastRef.current;
    if (!current || current.hideUndo) return;
    current.onUndo?.();
    setToast(null);
  });

  return (
    <div className="fixed bottom-20 left-4 z-50 pointer-events-none" data-testid="delete-toast-region">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 bg-ink-900 dark:bg-night-high dark:border dark:border-night-line-bold px-4 py-2.5 rounded-xl shadow-pop sm:max-w-md"
            data-testid="delete-toast"
          >
            <span className="text-[13px] font-medium text-white dark:text-ink-100">{toast.label}</span>
            {!toast.hideUndo && (
              <button
                onClick={() => { toast.onUndo?.(); setToast(null); }}
                className="text-[13px] font-semibold text-sun-400 hover:text-sun-300 transition-colors shrink-0"
                data-testid="delete-toast-undo"
              >
                Undo
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
