// @ts-check
/**
 * @file The ONE global keydown listener (mounted in Layout). Parses
 * every binding and either navigates directly or emits a semantic
 * event for the active page to handle. See lib/shortcuts.js for the
 * architecture notes and guard rules.
 *
 * Bindings (all single keys are typing- and modal-guarded):
 *   1–5            → nav items in sidebar order
 *   g then t/a/g/c/d/s → Today / All Tasks / Groupings / Calendar /
 *                        Completed / Settings
 *   n              → new task (page handles)
 *   /              → open + focus search (page handles)
 *   ?              → shortcuts cheat-sheet overlay
 *   z or Mod+Z     → undo the visible delete toast (DeleteToast handles)
 *   Calendar page only: d/w/m/y views, t today, ←/→ step, r sync
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SHORTCUT_EVENTS,
  G_SEQUENCES,
  SEQUENCE_TIMEOUT_MS,
  isTypingTarget,
  isModalOpen,
  navPathForDigit,
  emitShortcut,
} from "@/lib/shortcuts";

const CALENDAR_VIEW_KEYS = { d: "day", w: "week", m: "month", y: "year" };

export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  // Pending `g` prefix: { until: epochMs } or null.
  const pendingGRef = useRef(null);
  // Track the route without re-binding the listener on every navigation.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      // No Alt combos (OS/browser menus, AltGr typing on EU layouts).
      if (e.altKey) return;

      const mod = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);
      const modal = isModalOpen();

      // Mod+Z → toast undo. Only when NOT typing (text fields own their
      // undo) and no modal (dialogs own their keys).
      if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (typing || modal) return;
        emitShortcut(SHORTCUT_EVENTS.undoDelete);
        return;
      }
      // All remaining bindings are bare keys — never with Mod held.
      if (mod) return;
      if (typing || modal) {
        pendingGRef.current = null;
        return;
      }

      const key = e.key;

      // ── pending g-sequence resolution ──
      const pending = pendingGRef.current;
      if (pending && Date.now() <= pending.until) {
        pendingGRef.current = null;
        const path = G_SEQUENCES[key.toLowerCase()];
        if (path) {
          e.preventDefault();
          navigate(path);
          return;
        }
        // Unrecognized second key: fall through (the `g` is forgotten).
      } else if (pending) {
        pendingGRef.current = null; // expired
      }

      if (key === "g" || key === "G") {
        pendingGRef.current = { until: Date.now() + SEQUENCE_TIMEOUT_MS };
        return;
      }

      // ── digits → sidebar order ──
      if (key >= "1" && key <= "5") {
        const path = navPathForDigit(key);
        if (path) {
          e.preventDefault();
          navigate(path);
        }
        return;
      }

      // ── help overlay ──
      if (key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // ── search (preventDefault stops Firefox quick-find) ──
      if (key === "/") {
        e.preventDefault();
        emitShortcut(SHORTCUT_EVENTS.search);
        return;
      }

      // ── new task ──
      if (key === "n" || key === "N") {
        emitShortcut(SHORTCUT_EVENTS.newTask);
        return;
      }

      // ── plain z → toast undo ──
      if (key === "z" || key === "Z") {
        emitShortcut(SHORTCUT_EVENTS.undoDelete);
        return;
      }

      // ── calendar-page-only keys ──
      if (pathRef.current === "/Calendar") {
        const view = CALENDAR_VIEW_KEYS[key.toLowerCase?.() ?? key];
        if (view) {
          emitShortcut(SHORTCUT_EVENTS.calendarView, view);
          return;
        }
        if (key === "t" || key === "T") {
          emitShortcut(SHORTCUT_EVENTS.calendarToday);
          return;
        }
        if (key === "r" || key === "R") {
          emitShortcut(SHORTCUT_EVENTS.calendarSync);
          return;
        }
        if (key === "ArrowLeft" || key === "ArrowRight") {
          e.preventDefault(); // avoid horizontal page scroll
          emitShortcut(SHORTCUT_EVENTS.calendarStep, key === "ArrowLeft" ? -1 : 1);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return { helpOpen, setHelpOpen };
}
