// @ts-nocheck
/**
 * @file Re-export shim. Implementation split into focused sub-files
 * under `./TaskCard/`. This path stays valid so every caller's existing
 * `import TaskCard from "@/components/tasks/TaskCard"` keeps resolving
 * unchanged.
 */
export { default } from "./TaskCard/index.jsx";
