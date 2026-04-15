import { useEffect } from "react";

/**
 * Close a popover/dropdown when the user clicks anywhere outside `ref`
 * or presses Escape. `mousedown` fires before any inner `onClick`, so
 * clicking a menu item still triggers its handler before the close runs.
 *
 * @param {React.RefObject<HTMLElement>} ref
 * @param {() => void} onOutside
 * @param {boolean} [enabled=true]
 */
export function useOutsideClick(ref, onOutside, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleMouseDown = (event) => {
      if (!ref.current) return;
      if (ref.current.contains(event.target)) return;
      onOutside();
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onOutside();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ref, onOutside, enabled]);
}
