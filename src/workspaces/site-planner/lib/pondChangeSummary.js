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

/* v3 A5 — the atomic infeasibility proposal, in the owner's exact concise form: when the
 * elevation-only solve can't meet a target on the EXISTING footprint, the whole click is
 * atomic (nothing applied) and this names the two ways to close the gap — keep the berm the
 * solve reached and enlarge, or add a second basin. `bermFt` is that berm raise in feet
 * (null when the cap was a floor, not a berm — e.g. the mitigation case — so the berm clause
 * drops); `extraAcres` is the caller's own screening estimate of the extra footprint needed
 * — null/0 drops the acreage rather than fabricating one. Pure. */
export function gapProposalNote({ bermFt = null, extraAcres = null } = {}) {
  const berm = bermFt != null && Number.isFinite(bermFt) && bermFt > 0 ? `keep the ${f1(bermFt)}-ft berm and ` : "";
  const acres = extraAcres > 0 ? ` by about ${f2(extraAcres)} ac` : "";
  return `To close the gap: ${berm}enlarge the pond${acres}, or add a second basin.`;
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
        : `site still short by ${f2(Math.max(0, siteDetReqAcFt - providedNow))} ac-ft`;
    }
    rows.push({ key: "usable", label: "Usable detention", from: `${f2(beforeAcFt)} ac-ft`, to: `${f2(afterAcFt)} ac-ft`, note });
  }

  if (changed(before.mitCandidateCf, after.mitCandidateCf, EPS_CF)) {
    const beforeAcFt = before.mitCandidateCf / AC_FT, afterAcFt = after.mitCandidateCf / AC_FT;
    let note = null;
    if (siteMitReqAcFt != null) {
      const providedNow = siteMitProvidedOtherAcFt + afterAcFt;
      note = providedNow >= siteMitReqAcFt - 0.005
        ? "requirement met"
        : `site still short by ${f2(Math.max(0, siteMitReqAcFt - providedNow))} ac-ft`;
    }
    rows.push({ key: "mit", label: "Mitigation credit", from: `${f2(beforeAcFt)} ac-ft`, to: `${f2(afterAcFt)} ac-ft`, note });
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

/* FINAL UI SPEC A5 — the schematic cross-section's two elevation labels ("flood level",
 * "pond rim") used to sit at the same left edge and could overlap when the flood WSE and
 * the rim landed at nearly the same height. The fix: anchor "flood level" at the RIGHT end
 * of its dashed line and "pond rim" at the LEFT rim edge (opposite ends), so they no longer
 * collide; as a belt-and-suspenders safety, if their estimated bounding boxes still
 * intersect, "pond rim" is nudged down. The width estimate is a pure heuristic (no DOM /
 * canvas), so the collision math unit-tests without a browser. */
const LABEL_FONT_PX = 9.5;      // wseLabel / rimLabel render at this size in PondCrossSection
const LABEL_CHAR_PX = 5.2;      // ~0.55em per glyph at 9.5px — a screening width estimate
const LABEL_COLLISION_SHIFT = 12;

// Estimated bounding box of a text mark, honoring its anchor. SVG text sits ON its baseline
// (y), with glyphs ascending above it and a small descender below — enough for a collision
// screen. Exported so the A5 unit test can assert the two labels never overlap.
export function pondLabelBBox({ x, y, s, anchor = "start", fontPx = LABEL_FONT_PX }) {
  const w = (s ? String(s).length : 0) * LABEL_CHAR_PX;
  const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  return { x0, x1: x0 + w, y0: y - fontPx, y1: y + fontPx * 0.25 };
}

export function boxesIntersect(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/* A schematic (explicitly not-to-scale) side-view cross-section: grade line, the flood
 * WSE line, the OLD profile (dashed) and NEW profile (solid), the usable-detention band
 * shaded between the WSE (or grade, when no flood) and the new rim, and the berm ring at
 * the edges when the new rim sits above grade. Returns plain marks (rects/lines/text, w/h
 * in an abstract 0..W/0..H box) — the caller maps them to SVG; nothing here touches SVG
 * markup or a theme so it renders identically on screen and (later) in a print export. */
export function pondCrossSectionMarks({
  gradeFt = null,
  wseFt = null,
  before,
  after,
  w = 320,
  h = 160,
} = {}) {
  if (!after) return { marks: [], w, h };
  const vals = [gradeFt, wseFt, before?.tobElevFt, before && before.tobElevFt != null && before.depthFt != null ? before.tobElevFt - before.depthFt : null,
    after.tobElevFt, after.tobElevFt != null && after.depthFt != null ? after.tobElevFt - after.depthFt : null].filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return { marks: [], w, h };
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1);
  const pad = span * 0.15;
  const yOf = (elevFt) => h - ((elevFt - (lo - pad)) / (span + 2 * pad)) * h; // higher elev -> smaller y (near top)
  const marks = [];
  const midX = w * 0.5, halfBasin = w * 0.22, halfBerm = w * 0.38;

  marks.push({ t: "rect", role: "sky", x: 0, y: 0, w, h });
  if (gradeFt != null) marks.push({ t: "line", role: "grade", x1: 0, y1: yOf(gradeFt), x2: w, y2: yOf(gradeFt) });
  // A5 — "flood level" anchors at the RIGHT end of its dashed line (text-anchor:end), so it
  // no longer shares the left edge with "pond rim". Kept as a variable for the collision screen.
  let wseLabelMark = null;
  if (wseFt != null) {
    marks.push({ t: "line", role: "wse", x1: 0, y1: yOf(wseFt), x2: w, y2: yOf(wseFt) });
    wseLabelMark = { t: "text", role: "wseLabel", x: w - 4, y: yOf(wseFt) - 4, s: "flood level", anchor: "end" };
    marks.push(wseLabelMark);
  }

  const profile = (rimFt, floorFt, dashed) => {
    if (rimFt == null || floorFt == null) return null;
    const yRim = yOf(rimFt), yFloor = yOf(floorFt);
    const halfRim = rimFt > (gradeFt ?? rimFt) + EPS_FT ? halfBerm : halfBasin;
    return {
      t: "profile", dashed,
      points: [
        { x: midX - halfRim, y: yRim }, { x: midX - halfBasin, y: yFloor },
        { x: midX + halfBasin, y: yFloor }, { x: midX + halfRim, y: yRim },
      ],
      yRim, yFloor,
    };
  };

  const beforeFloorFt = before && before.tobElevFt != null && before.depthFt != null ? before.tobElevFt - before.depthFt : null;
  const afterFloorFt = after.tobElevFt != null && after.depthFt != null ? after.tobElevFt - after.depthFt : null;
  const oldP = before ? profile(before.tobElevFt, beforeFloorFt, true) : null;
  const newP = profile(after.tobElevFt, afterFloorFt, false);

  // Usable-detention band: between the governing water line (flood WSE, or grade when
  // there's no flood) and the NEW rim — shaded so "this much is now usable" reads as one
  // glance, not a caption to decode.
  const bandLoFt = wseFt != null ? wseFt : gradeFt;
  if (newP && bandLoFt != null && after.tobElevFt != null && after.tobElevFt > bandLoFt + EPS_FT) {
    const yTop = yOf(after.tobElevFt), yBottom = yOf(bandLoFt);
    marks.push({ t: "band", role: "usable", x: midX - halfBasin, x2: midX + halfBasin, yTop, yBottom });
    marks.push({ t: "text", role: "usableLabel", x: midX + halfBasin + 4, y: (yTop + yBottom) / 2, s: "usable storage" });
  }

  if (oldP) marks.push(oldP);
  marks.push(newP);
  if (newP) {
    // A5 — "pond rim" anchors at the LEFT rim edge of the new profile (opposite end from
    // "flood level"). If the two labels' estimated boxes still intersect, nudge this one down.
    const rimLabelMark = { t: "text", role: "rimLabel", x: newP.points[0].x, y: newP.yRim - 4, s: "pond rim", anchor: "start" };
    if (wseLabelMark && boxesIntersect(pondLabelBBox(wseLabelMark), pondLabelBBox(rimLabelMark))) {
      rimLabelMark.y += LABEL_COLLISION_SHIFT;
    }
    marks.push(rimLabelMark);
  }
  marks.push({ t: "text", role: "label", x: 4, y: 12, s: "schematic — not to scale" });
  return { marks: marks.filter(Boolean), w, h };
}
