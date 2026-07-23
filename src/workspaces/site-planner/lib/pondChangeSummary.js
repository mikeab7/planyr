/* B909 round 4 — the "what changed" card after ⚡ Design pond runs. Owner spec (chat,
 * upgrading the transient toast + Undo to a PERSISTENT card with a visual): list every
 * elevation delta in plain before -> after terms, and draw a simple schematic cross-
 * section so "raise the rim" reads instantly to a non-engineer. Pure — no React, no DOM,
 * so both pieces unit-test without a browser; SitePlanner.jsx supplies the plain
 * before/after snapshots (it owns pondSplitFor/fmElev/etc.) and renders the output.
 *
 * A snapshot is `{ depthFt, tobElevFt, gradeFt, usableCf, mitCandidateCf, landTakeSf,
 * excavationCf, bermFillCf }` — all plain numbers (feet / cubic feet / square feet),
 * `null` where unknown. Nothing here mutates or reaches into app state. */

const AC_FT = 43560;
const EPS_FT = 0.05;
const EPS_CF = 1; // a cubic foot of "change" is noise
const EPS_SF = 1;

const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const f0 = (n) => Math.round(n).toLocaleString();

const changed = (a, b, eps) => a != null && b != null && Math.abs(a - b) > eps;

/* v3 A5 — the gap proposal after Optimize applies the rim/berm it could. Names the ways to close
 * the REMAINING gap. `bermFt` is the applied berm raise in feet (null when the cap was a floor,
 * not a berm — e.g. the mitigation case — so the berm clause drops); `extraAcres` is a screening
 * estimate of the extra footprint (null/0 drops the acreage rather than fabricating one).
 * (v3 D5: the user-set "Max berm" ceiling is gone — the berm cap is COMPUTED — so this note no
 * longer mentions a Max-berm setting; a cap-bound solve routes to bermCapProposalNote instead.) */
export function gapProposalNote({ bermFt = null, extraAcres = null } = {}) {
  const hasBerm = bermFt != null && Number.isFinite(bermFt) && bermFt > 0;
  const berm = hasBerm ? `keep the ${f1(bermFt)}-ft berm and ` : "";
  const acres = extraAcres > 0 ? ` by about ${f2(extraAcres)} ac` : "";
  return `To close the gap: ${berm}enlarge the pond${acres}, or add a second basin.`;
}

/* v3 D5 — when the berm solve is capped, the toast names the BINDING constraint in plain English.
 * `binding` is "drainage" (runoff can no longer reach the pond by gravity) or "geometry" (the
 * inward berm faces pinch the footprint closed). `bermFt` is the capped berm height; for the
 * drainage case `controllingGradeFt` + `designWaterFt` explain WHY; for the geometry case
 * `geometricMaxFt` is the footprint's ceiling. `extraAcres` names the enlargement if estimable. */
export function bermCapProposalNote({ binding = "geometry", bermFt = null, controllingGradeFt = null, designWaterFt = null, geometricMaxFt = null, extraAcres = null } = {}) {
  const enlarge = extraAcres != null && extraAcres > 0 ? `enlarge the pond by about ${f2(extraAcres)} ac` : "enlarge the pond";
  if (binding === "drainage") {
    const g = controllingGradeFt != null ? f1(controllingGradeFt) : "?";
    const w = designWaterFt != null ? f1(designWaterFt) : "?";
    const h = bermFt != null ? f1(bermFt) : "?";
    return `Berm capped at ${h} ft: above that, the site can no longer drain into the pond by gravity (controlling grade ${g} ft, design water ${w} ft). More storage needs regrading, pumped inflow, ${enlarge}, or a second basin.`;
  }
  const hmax = geometricMaxFt != null ? f1(geometricMaxFt) : (bermFt != null ? f1(bermFt) : "?");
  return `This footprint tops out at ${hmax} ft of berm before the pond closes in on itself; to hold more, ${enlarge} or add a second basin.`;
}

/* Plain-English delta rows for the change-summary card. Only rows that actually moved
 * are included — a no-op operation (already covered, nothing to change) returns []. The
 * `siteDetReqAcFt`/`siteMitReqAcFt` + "OtherAcFt" (what the REST of the site's ponds
 * already provide) let the detention/mitigation rows say whether the SITE-WIDE
 * requirement is met, not just whether THIS pond's own number went up. */
export function buildChangeSummaryRows({
  before,
  after,
  siteDetReqAcFt = null,
  siteDetProvidedOtherAcFt = 0,
  siteMitReqAcFt = null,
  siteMitProvidedOtherAcFt = 0,
} = {}) {
  if (!before || !after) return [];
  const rows = [];

  if (changed(before.depthFt, after.depthFt, EPS_FT)) {
    const dug = after.depthFt - before.depthFt;
    rows.push({
      key: "floor",
      label: "Floor",
      from: `${f1(-before.depthFt)} ft`,
      to: `${f1(-after.depthFt)} ft`,
      note: dug > 0 ? `dug ${f1(dug)} ft deeper` : `raised ${f1(-dug)} ft`,
    });
  }

  if (changed(before.tobElevFt, after.tobElevFt, EPS_FT) && before.gradeFt != null) {
    const beforeAboveGrade = before.tobElevFt - before.gradeFt;
    const afterAboveGrade = after.tobElevFt - before.gradeFt;
    const fmt = (h) => (h > EPS_FT ? `+${f1(h)} ft berm` : "at grade");
    rows.push({ key: "rim", label: "Rim", from: fmt(beforeAboveGrade), to: fmt(afterAboveGrade), note: null });
  }

  if (changed(before.usableCf, after.usableCf, EPS_CF)) {
    const beforeAcFt = before.usableCf / AC_FT, afterAcFt = after.usableCf / AC_FT;
    let note = null;
    if (siteDetReqAcFt != null) {
      const providedNow = siteDetProvidedOtherAcFt + afterAcFt;
      note = providedNow >= siteDetReqAcFt - 0.005
        ? "requirement met"
        : `site still short by ${f1(Math.max(0, siteDetReqAcFt - providedNow))} ac-ft`;
    }
    // E4 (owner 2026-07-22) — ac-ft render at 1dp everywhere, matching the pond/yield cards;
    // the 2dp form ("16.97") disagreed with the status card's 1dp ("17.0") for the same number.
    rows.push({ key: "usable", label: "Usable detention", from: `${f1(beforeAcFt)} ac-ft`, to: `${f1(afterAcFt)} ac-ft`, note });
  }

  if (changed(before.mitCandidateCf, after.mitCandidateCf, EPS_CF)) {
    const beforeAcFt = before.mitCandidateCf / AC_FT, afterAcFt = after.mitCandidateCf / AC_FT;
    let note = null;
    if (siteMitReqAcFt != null) {
      const providedNow = siteMitProvidedOtherAcFt + afterAcFt;
      note = providedNow >= siteMitReqAcFt - 0.005
        ? "requirement met"
        : `site still short by ${f1(Math.max(0, siteMitReqAcFt - providedNow))} ac-ft`;
    }
    rows.push({ key: "mit", label: "Mitigation credit", from: `${f1(beforeAcFt)} ac-ft`, to: `${f1(afterAcFt)} ac-ft`, note });
  }

  if (changed(before.landTakeSf, after.landTakeSf, EPS_SF)) {
    rows.push({
      key: "land",
      label: "Pond land take",
      from: `${f2(before.landTakeSf / AC_FT)} ac`,
      to: `${f2(after.landTakeSf / AC_FT)} ac`,
      note: after.bermFillCf > 0 ? "berm ring" : null,
    });
  }

  const cutDeltaCy = (after.excavationCf ?? 0) / 27 - (before.excavationCf ?? 0) / 27;
  const bermCy = (after.bermFillCf ?? 0) / 27;
  if (Math.abs(cutDeltaCy) > 0.5 || bermCy > 0.5) {
    const parts = [];
    if (Math.abs(cutDeltaCy) > 0.5) parts.push(`${cutDeltaCy >= 0 ? "+" : "−"}${f0(Math.abs(cutDeltaCy))} CY cut`);
    if (bermCy > 0.5) parts.push(`${f0(bermCy)} CY berm fill`);
    rows.push({ key: "earthwork", label: "Earthwork", from: null, to: parts.join(" / "), note: null });
  }

  return rows;
}
