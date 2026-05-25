// @ts-nocheck
/**
 * @file Re-export shim. Implementation split into focused modules under
 * `./calendar/`. This path stays valid so App.jsx's existing
 * `import Calendar from "@/pages/Calendar.jsx"` keeps resolving.
 */
export { default } from "./calendar/index.jsx";
