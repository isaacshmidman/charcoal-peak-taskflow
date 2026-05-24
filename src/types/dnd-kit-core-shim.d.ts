import type { ReactNode } from "react";

export function useDroppable(options: Record<string, unknown>): {
  setNodeRef: (element: HTMLElement | null) => void;
  isOver: boolean;
};

export function useDraggable(options: Record<string, unknown>): {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  setNodeRef: (element: HTMLElement | null) => void;
  transform: { x: number; y: number; scaleX?: number; scaleY?: number } | null;
  isDragging: boolean;
};

export function useSensor(sensor: unknown, options?: Record<string, unknown>): unknown;
export function useSensors(...sensors: unknown[]): unknown;
export const PointerSensor: unknown;
export const TouchSensor: unknown;
export const pointerWithin: unknown;

export function DndContext(props: Record<string, unknown> & { children?: ReactNode }): JSX.Element;
export function DragOverlay(props: Record<string, unknown> & { children?: ReactNode }): JSX.Element;
