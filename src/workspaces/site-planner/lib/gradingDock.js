/* The owner-only Grading item in the left dock (NEW-1, amends B2315856: grading left the Site Analysis panel).
 *
 * Pure and tiny on purpose — SitePlanner imports it statically, the heavy panel (components/GradingPanels.jsx) stays lazy.
 * The gate is NOT decided here: callers pass the answer of `useGradingEnabled()` (lib/gradingGate.js), the one gate.
 * Off => the SAME array comes back, so every other account's dock is the identical object, not a copy.
 */
export const GRADING_TAB = Object.freeze({ id: "grading", label: "Grading" });

/* Grading sits between Drainage and Yield: Analysis screens, Drainage decides, Grading shapes the ground, Yield reports. */
export function withGradingTab(tabs, on) {
  if (!on) return tabs;
  if (tabs.some((t) => t.id === GRADING_TAB.id)) return tabs;
  const at = tabs.findIndex((t) => t.id === "yield");
  const out = tabs.slice();
  out.splice(at < 0 ? out.length : at, 0, { ...GRADING_TAB });
  return out;
}

/* A panel id that the gate refuses must never stay open (docked or floating): sign-out / account switch / a refused answer. */
export const panelIdAllowed = (id, on) => id !== GRADING_TAB.id || !!on;
