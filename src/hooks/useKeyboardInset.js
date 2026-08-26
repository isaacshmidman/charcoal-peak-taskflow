// @ts-nocheck
/**
 * @file How much of the viewport the on-screen keyboard is covering.
 *
 * `window.visualViewport` is the only reliable signal for this on iOS —
 * the layout viewport does not shrink when the keyboard opens, so a
 * fixed-position bar happily sits underneath it. The difference between
 * the layout height and the visual viewport's height (minus how far the
 * page has been scrolled within it) is the covered strip.
 *
 * Returns 0 wherever visualViewport isn't available, so callers can add
 * it to a padding unconditionally and get today's behaviour on desktop.
 */
import { useEffect, useState } from "react";

export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return undefined;

    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Small deltas are browser chrome (an address bar collapsing), not a
      // keyboard; treating those as a keyboard would jitter the layout.
      setInset(covered > 120 ? Math.round(covered) : 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
