/* Per-jurisdiction pond DESIGN-CRITERIA rules (B709) — the geometry a criteria
 * manual forces around a detention basin: an interior side-slope cap, a minimum
 * freeboard, and a maintenance-berm ring (the flat access shelf around the basin
 * that the drawn water footprint understates). EDITABLE, seeded with commonly-cited
 * HCFCD-style values, and ALL `verified:false` — placeholder magnitudes, NOT
 * authoritative transcriptions. VERIFY against the HCFCD PCPM / H&H manual and each
 * county's DCM before flipping a flag (easementRules.js pattern; localStorage).
 *
 * Schema: { label, maxSideSlope (n in n:1 H:V — SMALLER n is STEEPER),
 *           minFreeboardFt, maintBermWidthFt, verified, source, sourceDate, note }.
 * Jurisdiction keys match floodplainRules.js so one picker drives both. */
const LS = "planarfit:pondCriteriaRules:v1";

const seed = (label, source) => ({
  label,
  maxSideSlope: 3,       // 3:1 H:V interior — commonly cited; steeper needs approval
  minFreeboardFt: 1,     // 1 ft above the design water surface
  maintBermWidthFt: 30,  // maintenance shelf around the basin
  verified: false,
  source,
  sourceDate: null,
  note: "Commonly-cited HCFCD-style placeholder values — VERIFY against the PCPM / H&H manual and the county DCM before relying on them.",
});

export const DEFAULT_POND_CRITERIA = {
  coh: seed("City of Houston", "COH IDM / HCFCD criteria (not yet transcribed)"),
  harris: seed("Harris County (unincorporated)", "HCFCD PCPM (not yet transcribed)"),
  fortbend: seed("Fort Bend County", "FBCDD criteria (not yet transcribed)"),
  montgomery: seed("Montgomery County", "Montgomery DCM (not yet transcribed)"),
  chambers: seed("Chambers County", "County criteria (not yet transcribed)"),
  waller: seed("Waller County", "County criteria (not yet transcribed)"),
  generic: seed("Generic / unknown", "No jurisdiction matched"),
};

const clone = () => JSON.parse(JSON.stringify(DEFAULT_POND_CRITERIA));

export function loadPondCriteria(store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    const v = s ? JSON.parse(s.getItem(LS)) : null;
    return v ? { ...clone(), ...v } : clone();
  } catch (_) { return clone(); }
}
export function savePondCriteria(rules, store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    if (s) s.setItem(LS, JSON.stringify(rules));
  } catch (_) {}
}

/* Conformance of a pond's drawn inputs against the criteria. A SMALLER slope number
 * is a STEEPER bank (2:1 is steeper than 3:1), so slope < maxSideSlope violates.
 * Returns { slope, freeboard } — each null (conforms) or a violation payload.
 * An unverified rule's violations still render, stamped by the caller. Pure. */
export function checkPondCriteria(det = {}, rule) {
  if (!rule) return { slope: null, freeboard: null };
  const slope = det.slope != null ? det.slope : 3;
  const freeboard = det.freeboard != null ? det.freeboard : 1;
  return {
    slope: rule.maxSideSlope != null && slope < rule.maxSideSlope - 1e-9
      ? { slope, maxSideSlope: rule.maxSideSlope }
      : null,
    freeboard: rule.minFreeboardFt != null && freeboard < rule.minFreeboardFt - 1e-9
      ? { freeboard, minFreeboardFt: rule.minFreeboardFt }
      : null,
  };
}
