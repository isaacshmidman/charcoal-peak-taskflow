// @ts-nocheck
/**
 * Appearance / theme provider.
 *
 * Stored as `appearance` in localStorage with values:
 *   - "light"  → force light mode
 *   - "dark"   → force dark mode
 *   - "system" → follow `prefers-color-scheme` (live-updates on OS change)
 *
 * Default is "light" (per product decision — users can opt in).
 *
 * The provider applies/removes the `dark` class on `<html>`. Tailwind's
 * `darkMode: "class"` config + the `.dark { --background, ... }` block in
 * index.css then take care of every shadcn-token-based component automatically.
 *
 * To avoid a flash of light theme on initial load (FOUC), there's a tiny
 * blocking script in index.html that reads localStorage and toggles the class
 * BEFORE React mounts. This provider re-applies the same logic on every
 * change (Settings dropdown, system theme flip, etc.).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "appearance";
const DEFAULT_APPEARANCE = "light";
const VALID = new Set(["system", "light", "dark"]);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && VALID.has(v)) return v;
  } catch {}
  return DEFAULT_APPEARANCE;
}

function resolveDark(appearance) {
  if (appearance === "dark") return true;
  if (appearance === "light") return false;
  // system
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDarkClass(isDark) {
  const root = document.documentElement;
  if (isDark) root.classList.add("dark");
  else root.classList.remove("dark");
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute("content", isDark ? "#0b1220" : "#f5f5a0");
}

const ThemeContext = createContext({
  appearance: DEFAULT_APPEARANCE,
  isDark: false,
  setAppearance: (_) => {},
});

export function ThemeProvider({ children }) {
  const [appearance, setAppearanceState] = useState(readStored);
  const [isDark, setIsDark] = useState(() => resolveDark(readStored()));

  // Apply on every change.
  useEffect(() => {
    const dark = resolveDark(appearance);
    setIsDark(dark);
    applyDarkClass(dark);
  }, [appearance]);

  // Live-follow OS theme when in "system" mode.
  useEffect(() => {
    if (appearance !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const dark = mql.matches;
      setIsDark(dark);
      applyDarkClass(dark);
    };
    // Some old Safari versions only support addListener.
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, [appearance]);

  const setAppearance = useCallback((next) => {
    const v = VALID.has(next) ? next : DEFAULT_APPEARANCE;
    setAppearanceState(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch {}
  }, []);

  const value = useMemo(() => ({ appearance, isDark, setAppearance }), [appearance, isDark, setAppearance]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
