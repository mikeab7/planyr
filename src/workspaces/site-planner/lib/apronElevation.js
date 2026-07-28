/* NEW-9 — DOCK APRON / TRUCK COURT elevation, checked SEPARATELY from the building pad.
 *
 * Buildability only tests the building pad. But a dock-high industrial building's truck court sits
 * roughly 4 ft BELOW finished floor — so Bain's 144.8 FFE puts the apron near 140.8, potentially
 * below BFE, with 70 trailers parked on it.
 *
 * Pavement is not a structure, so an apron under the BFE may well be code-legal — this module never
 * calls it a code violation. It is a real FLOOD-EXPOSURE and LEASING issue (trailers, dock levelers,
 * electrical, and a tenant's goods sit there), and the app should not hide it behind a green pad
 * check. The output is deliberately an EXPOSURE finding with its own wording, not an FFE failure.
 *
 * The second half of the item: truck-court and pavement FILL must be included in the mitigation
 * volume demand, not just building pads. `apronFillFootprints` marks up the paving footprints so the
 * mitigation ledger prices them at their real (lowered) surface — the engine already supports a
 * per-footprint pad elevation, so this is about making sure the courts are IN the set with the right
 * elevation, not about a new volume method.
 *
 * Pure. Feet NAVD88 in, findings out. Node-testable.
 */

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

// Dock-high industrial: the truck court sits this far below finished floor unless told otherwise.
// Same default the mitigation ledger's dock-drop uses, so the two can never disagree.
export const DEFAULT_DOCK_DROP_FT = 4;

/* The apron elevation implied by a finished-floor elevation. Pure. */
export function apronElevFt({ ffeFt = null, dockDropFt = DEFAULT_DOCK_DROP_FT } = {}) {
  const f = num(ffeFt);
  const d = num(dockDropFt) != null ? num(dockDropFt) : DEFAULT_DOCK_DROP_FT;
  if (f == null) return null;
  return f - d;
}

/* Check the apron against the governing flood elevation.
 *
 * Returns:
 *   status   "exposed"  apron sits BELOW the governing flood elevation — trailers park in the flood
 *            "thin"     apron clears it by less than `thinFt` (default 1 ft) — an as-built survey
 *                       or a grading tweak erases the clearance
 *            "clear"    apron clears it
 *            "unknown"  the flood elevation or the FFE is not known — never a pass
 *   belowByFt / clearByFt  how far, so the panel states a magnitude not an adjective
 *
 * Deliberately NOT phrased as pass/fail: the finding is exposure, and the copy says so. Pure. */
export function assessApron({ ffeFt = null, dockDropFt = DEFAULT_DOCK_DROP_FT, floodElevFt = null, floodLabel = null, thinFt = 1, trailerStalls = null } = {}) {
  const apron = apronElevFt({ ffeFt, dockDropFt });
  const flood = num(floodElevFt);
  const drop = num(dockDropFt) != null ? num(dockDropFt) : DEFAULT_DOCK_DROP_FT;
  if (apron == null || flood == null) {
    return {
      status: "unknown", apronElevFt: apron, floodElevFt: flood, dockDropFt: drop,
      belowByFt: null, clearByFt: null, floodLabel,
      note: apron == null
        ? "Truck-court elevation unknown — set the finished-floor elevation to screen the dock apron."
        : `No governing flood elevation known at the truck court — the apron sits ${apron.toFixed(1)}′, ${drop} ft below finished floor, but there is nothing to check it against yet.`,
    };
  }
  const delta = apron - flood;
  const status = delta < 0 ? "exposed" : delta < thinFt ? "thin" : "clear";
  const stalls = num(trailerStalls);
  const stallClause = stalls ? ` with ${Math.round(stalls)} trailer stall${stalls === 1 ? "" : "s"} on it` : "";
  return {
    status,
    apronElevFt: apron,
    floodElevFt: flood,
    floodLabel,
    dockDropFt: drop,
    belowByFt: delta < 0 ? -delta : 0,
    clearByFt: delta >= 0 ? delta : 0,
    trailerStalls: stalls,
    // Exposure language, never code language: pavement is not a structure, so this is a risk the
    // reader has to price, not a violation the reviewer will cite.
    note: status === "exposed"
      ? `The truck court sits ${apron.toFixed(1)}′ — ${(-delta).toFixed(1)} ft BELOW the ${floodLabel || "governing flood elevation"}${stallClause}. Pavement is not a structure, so this may be code-legal, but the apron, dock equipment and parked trailers flood.`
      : status === "thin"
        ? `The truck court sits ${apron.toFixed(1)}′, clearing the ${floodLabel || "governing flood elevation"} by only ${delta.toFixed(1)} ft${stallClause}. An as-built survey or a grading change erases that.`
        : `The truck court sits ${apron.toFixed(1)}′, clearing the ${floodLabel || "governing flood elevation"} by ${delta.toFixed(1)} ft.`,
  };
}

/* The mitigation-demand half: the paving/court element types whose FILL must be priced into the
 * compensating-storage requirement, not just building pads. Returns the set the caller filters its
 * elements by. Kept here (next to the dock-drop constant) so the apron rule and the volume rule
 * cannot drift apart. */
export const APRON_FILL_TYPES = new Set(["dockzone", "truckcourt", "paving", "parking", "trailer", "drive", "road"]);

/* Does the mitigation fill set actually INCLUDE the pavement? A screening self-check the panel can
 * state, so "we only mitigated the buildings" can never be the silent state. Pure. */
export function apronFillIncluded(fillTypes) {
  if (!fillTypes) return { included: false, missing: [...APRON_FILL_TYPES] };
  const has = (t) => (typeof fillTypes.has === "function" ? fillTypes.has(t) : Array.isArray(fillTypes) && fillTypes.includes(t));
  const missing = [...APRON_FILL_TYPES].filter((t) => !has(t));
  return { included: missing.length < APRON_FILL_TYPES.size, missing, complete: missing.length === 0 };
}
