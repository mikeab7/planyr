/* Planner-wide constants and one lazy component shared by SitePlanner.jsx and the panels extracted from it (B1064 step 1).
 * Pure data (plus the one `lazy` PondSection). Never imports from SitePlanner.jsx — that edge would be circular. @planner-extract */
import { lazy } from "react";

/* PR-L pond cross-section. LAZY (bundle budget, 2026-07-29 — the B1092 precedent): it renders
 * ONLY inside the pond inspector and the Optimize card, both reached by an explicit user action,
 * so a plain Site load has no use for it. Both call sites wrap it in one shared Suspense. */
export const PondSection = lazy(() => import("../components/PondSection.jsx"));

/* NEW-1 — the one spelling of the panel-surface token. A minifier does NOT dedupe string
 * literals, so a CSS custom property written out inline once per style object ships one full
 * copy per site: this file spelled `var(--surface-raised)` forty-one separate times. Hoisting
 * it is byte-identical at runtime (same string, same value, resolved by the same stylesheet)
 * and is this change's matching optimization for the bundle budget — the site chunk had 0.3 KB
 * of headroom band left when the setback-chip fix landed on it. Spell new uses `SURF_RAISED`. */
export const SURF_RAISED = "var(--surface-raised)";
export const BORDER_1 = "1px solid var(--border-default)"; // …and this hairline 15× (4 quoted, 11 templated)
/* Shared inline-style atoms (NEW-2 perf pass, the B1093 pattern) — see the note where the rest of them live in SitePlanner.jsx. */
export const ROWB6 = { display: "flex", alignItems: "baseline", gap: 6 };
export const ROWSB = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "2px 0" };
// B882 — plain-language labels for the estimate-sensitivity band's flipped outputs.
export const EST_FLIP_LABEL = {
  ffeVerdict: "the buildability verdict",
  requiredFfeFt: "the required finished-floor",
  mitigationCf: "the mitigation volume",
  detUsableCf: "usable detention",
  detDeadCf: "dead storage",
};
