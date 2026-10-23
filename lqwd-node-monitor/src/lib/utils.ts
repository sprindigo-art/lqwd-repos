import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names safely (shadcn workspace convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Shared keyboard focus affordance. Navy is the reserved focus color for this NOC
 * (audit B9/A11) — every interactive control (nav links, toggles, buttons, rows)
 * should spread this so keyboard operators get a consistent, visible ring instead
 * of the invisible UA default. Usage: `className={cn(FOCUS_RING, …)}`.
 */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-df-brand focus-visible:ring-offset-1 focus-visible:ring-offset-df-bg";
