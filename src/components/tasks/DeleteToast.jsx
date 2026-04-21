import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Usage: call showDeleteToast({ label: "Task X was deleted", onUndo: fn })
 * This component renders itself in the bottom-left, pointer-events:none when hidden.
 */

let _setToast = null;

export function showDeleteToast({ label, onUndo, hideUndo = false }) {
  if (_setToast) _setToast({ label, onUndo, hideUndo: hideUndo || !onUndo, id: Date.now() });
}

export default function DeleteToast() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    _setToast = setToast;
    return () => { _setToast = null; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast?.id]);

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
            className="pointer-events-auto flex items-center gap-3 bg-slate-900 px-4 py-2.5 rounded-xl shadow-lg"
            data-testid="delete-toast"
          >
            <span className="text-xs font-medium text-white">{toast.label}</span>
            {!toast.hideUndo && (
              <button
                onClick={() => { toast.onUndo?.(); setToast(null); }}
                className="text-xs font-semibold text-yellow-300 hover:text-yellow-200 transition-colors shrink-0"
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
