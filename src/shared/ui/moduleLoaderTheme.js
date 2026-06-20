/* moduleLoaderTheme — pure theming for the assembling loader (B224).
 *
 * One animation engine, a per-module skin + accent. Kept React-free so the skin
 * resolution is unit-testable and shared cleanly: ModuleLoader.jsx renders the
 * visuals, this decides which grammar + accent + label each module gets.
 */
import { MODULE_ACCENT } from "./moduleAccent.js";

// Only reveal once a load crosses a perceptible delay — fast loads don't flash.
export const SHOW_DELAY_MS = 250;

// Per-module skin: which grammar to draw + the caption.
export const LOADER_SKINS = {
  "site-planner": { kind: "site",  label: "Drawing site plan…" },
  "scheduler":    { kind: "gantt", label: "Assembling schedule…" },
  "doc-review":   { kind: "gantt", label: "Loading markup…" },
};

const FALLBACK = "#e8590c";

/** Resolve a module id to { accent, kind, label }. Unknown ids fall back to the
 *  generic gantt skin + default accent — never throws, never blank. */
export function resolveLoaderTheme(module) {
  const skin = LOADER_SKINS[module] || { kind: "gantt", label: "Loading…" };
  return { accent: MODULE_ACCENT[module] || FALLBACK, kind: skin.kind, label: skin.label };
}
