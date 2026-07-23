/* PR-L — the developer-readable pond SECTION model (pure). Turns a pond's plain facts (all
 * elevations in feet NAVD88, volumes in ac-ft / cubic yards, `null` where unknown) into a
 * fully-placed schematic side-section: existing grade, the berm as fill above grade, the
 * excavation below grade to the floor, water/storage bands at their true elevations, the flood
 * line, groundwater line, the outlet + receiving-water level (so a gravity problem is visible),
 * a depth dimension, side slopes, and earthwork call-outs.
 *
 * The hard rule (L2): NO label may overlap another label. Every label lives in a reserved slot —
 * a LEFT elevation column, a RIGHT facts column, or a small set of in-pit dimension call-outs —
 * and each column is de-collided vertically (sorted by its true anchor, pushed apart to a minimum
 * gap, with a leader line back to the anchor when it had to move). The output is plain marks; the
 * PondSection component maps them to SVG with theme tokens, so nothing here touches the DOM and it
 * all unit-tests without a browser. Numbers render at 1dp to match the panel values exactly. */

const AC_FT = 43560;
export const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

// ── label geometry (pure bbox estimate; no DOM/canvas) ──
const CHAR_PX = 5.4;   // ~0.58em per glyph at the ~10px label size
const LINE_PX = 12;    // label line box height for the collision screen
const GAP_PX = 3;      // minimum clear space between two stacked labels

export function labelWidth(s, charPx = CHAR_PX) {
  return (s ? String(s).length : 0) * charPx;
}
// Estimated bounding box of a placed label, honoring its anchor. SVG text sits on its baseline y.
export function labelBBox({ x, y, s, anchor = "start", charPx = CHAR_PX, linePx = LINE_PX }) {
  const w = labelWidth(s, charPx);
  const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  return { x0, x1: x0 + w, y0: y - linePx * 0.78, y1: y + linePx * 0.22 };
}
export function boxesIntersect(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/* De-collide a single vertical column of labels: sort by the true anchor Y, place each at its
 * anchor but no closer than (LINE_PX + GAP) to the one above, then if the stack overflowed the
 * bottom, shift the whole run up so it fits. Each label keeps `anchorY` so the renderer can draw a
 * leader when y != anchorY. Pure. */
export function placeColumn(items, { top, bottom, gap = LINE_PX + GAP_PX } = {}) {
  const sorted = items.map((it, i) => ({ ...it, _i: i })).sort((a, b) => a.anchorY - b.anchorY);
  let prev = -Infinity;
  for (const it of sorted) {
    let y = Math.max(it.anchorY, prev + gap);
    it.y = y;
    prev = y;
  }
  // If the stack ran past the bottom, slide everything up by the overflow (bounded by `top`).
  const last = sorted[sorted.length - 1];
  if (last && last.y > bottom) {
    const shift = Math.min(last.y - bottom, (sorted[0]?.y ?? top) - top);
    for (const it of sorted) it.y -= shift;
  }
  // Restore input order.
  return sorted.sort((a, b) => a._i - b._i).map(({ _i, ...rest }) => rest);
}

const lerp = (a, b, t) => a + (b - a) * t;
const finite = (n) => n != null && Number.isFinite(n);

/* Build the section. `facts` (all feet/ac-ft/CY, null where unknown):
 *   gradeFt, rimFt, floorFt, freeboardFt (height, ft), slopeRatio,
 *   wseFt, wseEst, outletInvertFt, tailwaterFt, tailwaterEst, groundwaterFt, groundwaterEst,
 *   deadAcFt, usableAcFt, bermFillCy, cutCy, purpose ("detention"|"mitigation").
 * Returns { ok, w, h, ground, berms[], bands[], faces[], floor, lines[], outlet, receiving,
 *           depthDim, slopeMarks[], labels[], note }.  ok=false when there isn't enough to draw. */
export function pondSectionModel(facts = {}, { w = 520, h = 260 } = {}) {
  const {
    gradeFt = null, rimFt = null, floorFt = null, freeboardFt = 0, slopeRatio = null,
    wseFt = null, wseEst = false, outletInvertFt = null,
    tailwaterFt = null, tailwaterEst = false, groundwaterFt = null, groundwaterEst = false,
    deadAcFt = null, usableAcFt = null, bermFillCy = null, cutCy = null, purpose = "detention",
  } = facts;

  if (!finite(rimFt) || !finite(floorFt) || rimFt <= floorFt) return { ok: false, w, h };
  const grade = finite(gradeFt) ? gradeFt : floorFt; // fall back so the datum still draws
  const berm = Math.max(0, rimFt - grade);
  const depthFt = rimFt - floorFt;

  // ── vertical scale ──
  const elevs = [rimFt, floorFt, grade, wseFt, outletInvertFt, tailwaterFt, groundwaterFt].filter(finite);
  let lo = Math.min(...elevs), hi = Math.max(...elevs);
  const span = Math.max(hi - lo, 1);
  const pad = span * 0.12;
  lo -= pad; hi += pad;
  const TOP = 20, BOT = 30;               // reserve top headroom + a bottom strip for the note
  const drawH = h - TOP - BOT;
  const yOf = (e) => TOP + ((hi - e) / (hi - lo)) * drawH;

  // ── horizontal geometry (schematic; vertical exaggeration is fine) ──
  // PR-M — CORRECT outside-in berm geometry (fixed-outer-toe model). On each bank, from the outside:
  //   grade runs to the OUTER TOE (the footprint edge) → the berm OUTER FACE rises from the toe up to
  //   the CREST at rim → a small flat crest top (nominal maintenance width) → the INNER FACE descends
  //   in ONE CONTINUOUS STRAIGHT LINE from the crest THROUGH the grade plane to the pond FLOOR.
  //   The inner face above grade and the pond side slope below grade are the SAME colinear line (no
  //   kink at grade, no dark slope line crossing the fill). Both faces use one design slope so the
  //   berm reads symmetric. When berm = 0 the crest/outer-face vanish and the slope runs grade→floor.
  const MARGIN_L = 86, MARGIN_R = 96;
  const sxL = MARGIN_L, sxR = w - MARGIN_R;
  const cx = (sxL + sxR) / 2;
  const sw = sxR - sxL;
  const floorHalf = sw * 0.14;
  const crestW = berm > 0.05 ? sw * 0.035 : 0;   // flat crest maintenance top (never a knife point)
  const outerGap = sw * 0.05;                     // native ground shown outside the toe

  const yGrade = yOf(grade), yRim = yOf(rimFt), yFloor = yOf(floorFt);
  const hRimGrade = Math.max(0, yGrade - yRim);   // berm height, design px (0 when no berm)
  const hRimFloor = yFloor - yRim;                // full rim→floor depth, design px

  // ONE design slope s (horizontal px per vertical px) for BOTH faces, chosen so the outer toe lands
  // just inside the native-ground margin. Both faces then read as matching (mirror) side slopes.
  const availHalf = (cx - sxL) - outerGap;
  const denom = hRimFloor + hRimGrade;
  const s = denom > 0 ? Math.max(0, (availHalf - floorHalf - crestW) / denom) : 0;

  const xFloorL = cx - floorHalf, xFloorR = cx + floorHalf;
  const xCrestInL = xFloorL - s * hRimFloor;      // crest inner edge (top of the inner face)
  const xCrestOutL = xCrestInL - crestW;          // crest outer edge (top of the outer face)
  const xToeL = xCrestOutL - s * hRimGrade;       // outer toe at grade (footprint edge)
  const xInGradeL = xCrestInL + s * hRimGrade;    // where the inner face crosses the grade plane
  const xCrestInR = xFloorR + s * hRimFloor;
  const xCrestOutR = xCrestInR + crestW;
  const xToeR = xCrestOutR + s * hRimGrade;
  const xInGradeR = xCrestInR - s * hRimGrade;

  // inner faces are ONE straight line each (crest inner → floor); interpolate x at any elevation.
  const leftX = (e) => lerp(xFloorL, xCrestInL, (e - floorFt) / (rimFt - floorFt));
  const rightX = (e) => lerp(xFloorR, xCrestInR, (e - floorFt) / (rimFt - floorFt));

  // native ground below grade, across the section, with the pond void carved out (toe→crest is
  // native flat grade; the berm fill sits ABOVE it, drawn separately).
  const ground = [
    { x: sxL, y: yGrade }, { x: xInGradeL, y: yGrade }, { x: xFloorL, y: yFloor },
    { x: xFloorR, y: yFloor }, { x: xInGradeR, y: yGrade }, { x: sxR, y: yGrade },
    { x: sxR, y: h - BOT }, { x: sxL, y: h - BOT },
  ];
  // berm fill (hatched): exactly the area bounded by the OUTER FACE, the flat CREST, the INNER FACE,
  // and the grade line — one quad per bank. Point order: outer toe · crest outer · crest inner ·
  // inner-face-at-grade. The crest-inner and inner-at-grade points lie ON the inner-face line, so the
  // dark inner face runs along the fill's inner edge (it never crosses through the hatch).
  const berms = berm > 0.05 ? [
    [{ x: xToeL, y: yGrade }, { x: xCrestOutL, y: yRim }, { x: xCrestInL, y: yRim }, { x: xInGradeL, y: yGrade }],
    [{ x: xToeR, y: yGrade }, { x: xCrestOutR, y: yRim }, { x: xCrestInR, y: yRim }, { x: xInGradeR, y: yGrade }],
  ] : [];

  // ── water / storage bands (trapezoids following the inner faces) ──
  const usableTopFt = rimFt - Math.max(0, freeboardFt || 0);
  const deadTopFt = finite(wseFt) ? Math.min(wseFt, usableTopFt) : floorFt;
  const bands = [];
  const bandTrap = (e1, e2) => [
    { x: leftX(e2), y: yOf(e2) }, { x: rightX(e2), y: yOf(e2) },
    { x: rightX(e1), y: yOf(e1) }, { x: leftX(e1), y: yOf(e1) },
  ];
  if (deadTopFt > floorFt + 0.05) bands.push({ kind: "dead", pts: bandTrap(floorFt, deadTopFt), midFt: (floorFt + deadTopFt) / 2 });
  const usableLoFt = Math.max(deadTopFt, floorFt);
  if (usableTopFt > usableLoFt + 0.05) bands.push({ kind: "usable", pts: bandTrap(usableLoFt, usableTopFt), midFt: (usableLoFt + usableTopFt) / 2 });
  if (rimFt > usableTopFt + 0.05) bands.push({ kind: "freeboard", pts: bandTrap(usableTopFt, rimFt), midFt: (usableTopFt + rimFt) / 2 });

  // inner faces (the dark pond side slope) — ONE colinear line crest→floor on each bank.
  const faces = [
    [{ x: xCrestInL, y: yRim }, { x: xFloorL, y: yFloor }],
    [{ x: xCrestInR, y: yRim }, { x: xFloorR, y: yFloor }],
  ];
  // berm outer faces + crest tops (the visible outside of the berm), drawn as light outline.
  const bermOutlines = berm > 0.05 ? [
    [{ x: xToeL, y: yGrade }, { x: xCrestOutL, y: yRim }, { x: xCrestInL, y: yRim }],
    [{ x: xToeR, y: yGrade }, { x: xCrestOutR, y: yRim }, { x: xCrestInR, y: yRim }],
  ] : [];
  const floor = { x1: xFloorL, x2: xFloorR, y: yFloor };

  // ── horizontal reference lines ──
  const lines = [];
  // grade runs to the OUTER TOE on each side (under the berm it is hidden by fill); none across the void.
  lines.push({ role: "grade", x1: sxL, x2: xToeL, y: yGrade });
  lines.push({ role: "grade", x1: xToeR, x2: sxR, y: yGrade });
  if (finite(wseFt) && wseFt > floorFt) lines.push({ role: "flood", x1: sxL, x2: xToeR, y: yOf(wseFt) });
  if (finite(groundwaterFt) && groundwaterFt > floorFt && groundwaterFt < rimFt) lines.push({ role: "groundwater", x1: leftX(groundwaterFt), x2: rightX(groundwaterFt), y: yOf(groundwaterFt) });

  // ── outlet (right bank at the invert) + receiving water beyond the berm ──
  const outlet = finite(outletInvertFt) ? { x: xFloorR, y: yOf(outletInvertFt) } : null;
  const receiving = finite(tailwaterFt) ? { x1: xToeR + 6, x2: sxR, y: yOf(tailwaterFt) } : null;

  // ── PR-M depth dimension: a vertical dimension line with end ticks at RIM and FLOOR, a small tick
  //    where it crosses GRADE, extension lines touching each measured level, and two stacked segment
  //    labels (+berm above grade, cut below grade). Placed just inside the left floor edge. ──
  const xDim = xFloorL + 12;
  const cutFt = finite(gradeFt) ? Math.max(0, grade - floorFt) : depthFt;
  const twoSeg = berm > 0.05 && finite(gradeFt);
  const depthDim = {
    x: xDim, yRim, yGrade: finite(gradeFt) ? yGrade : null, yFloor,
    extRim: { x1: xCrestInL, x2: xDim, y: yRim },     // touches the rim (crest inner)
    extFloor: { x1: xFloorL, x2: xDim, y: yFloor },   // touches the floor
    extGrade: finite(gradeFt) ? { x1: xInGradeL, x2: xDim, y: yGrade } : null, // touches the grade plane
    twoSeg,
  };
  const slopeMarks = finite(slopeRatio) ? [{ x: (xFloorR + xCrestInR) / 2 + 6, y: (yFloor + yRim) / 2 }] : [];

  // ── labels: LEFT elevation column · RIGHT facts column · in-pit dimensions ──
  const est = (b) => (b ? " EST" : "");
  const left = [];
  left.push({ key: "rim", anchorY: yRim, s: berm > 0.05 ? `rim ${f1(rimFt)}' (+${f1(berm)} ft)` : `rim ${f1(rimFt)}'`, role: "rim", leaderX: sxL });
  if (finite(gradeFt)) left.push({ key: "grade", anchorY: yGrade, s: `grade ${f1(gradeFt)}'`, role: "grade", leaderX: sxL });
  if (finite(wseFt) && wseFt > floorFt) left.push({ key: "flood", anchorY: yOf(wseFt), s: `flood ${f1(wseFt)}'${est(wseEst)}`, role: "flood", leaderX: sxL });
  if (finite(groundwaterFt) && groundwaterFt > floorFt && groundwaterFt < rimFt) left.push({ key: "gw", anchorY: yOf(groundwaterFt), s: `groundwater ${f1(groundwaterFt)}'${est(groundwaterEst)}`, role: "groundwater", leaderX: sxL });
  left.push({ key: "floor", anchorY: yFloor, s: `floor ${f1(floorFt)}'`, role: "floor", leaderX: sxL });

  const usableName = purpose === "mitigation" ? "mitigation" : "usable";
  const right = [];
  for (const b of bands) {
    if (b.kind === "usable" && finite(usableAcFt)) right.push({ key: "usable", anchorY: yOf(b.midFt), s: `${usableName} ${f1(usableAcFt)} ac-ft`, role: "usable", leaderX: rightX(b.midFt) });
    if (b.kind === "dead" && finite(deadAcFt)) right.push({ key: "dead", anchorY: yOf(b.midFt), s: `dead ${f1(deadAcFt)} ac-ft`, role: "dead", leaderX: rightX(b.midFt) });
    if (b.kind === "freeboard") right.push({ key: "fb", anchorY: yOf(b.midFt), s: `freeboard ${f1(Math.max(0, freeboardFt || 0))} ft`, role: "freeboard", leaderX: rightX(b.midFt) });
  }
  if (outlet) right.push({ key: "outlet", anchorY: outlet.y, s: `outlet ${f1(outletInvertFt)}'`, role: "outlet", leaderX: xFloorR });
  if (receiving) right.push({ key: "recv", anchorY: receiving.y, s: `receiving ${f1(tailwaterFt)}'${est(tailwaterEst)}`, role: "receiving", leaderX: sxR });

  const placedLeft = placeColumn(left, { top: TOP, bottom: h - BOT }).map((it) => ({ ...it, x: 6, anchor: "start" }));
  const placedRight = placeColumn(right, { top: TOP, bottom: h - BOT }).map((it) => ({ ...it, x: w - 6, anchor: "end" }));

  // in-pit call-outs: the depth-dimension segment labels + the slope. NO earthwork numbers (PR-M M3 —
  // CY quantities live in the panel rows + the what-changed card text, never on the drawing).
  const inpit = [];
  if (twoSeg) {
    inpit.push({ key: "dimBerm", x: xDim + 6, y: (yRim + yGrade) / 2, anchor: "start", s: `+${f1(berm)} ft berm`, role: "dim" });
    inpit.push({ key: "dimCut", x: xDim + 6, y: (yGrade + yFloor) / 2, anchor: "start", s: `${f1(cutFt)} ft cut`, role: "dim" });
  } else {
    inpit.push({ key: "dim", x: xDim + 6, y: (yRim + yFloor) / 2, anchor: "start", s: `${f1(depthFt)} ft rim to floor`, role: "dim" });
  }
  if (finite(slopeRatio)) inpit.push({ key: "slope", x: slopeMarks[0].x, y: slopeMarks[0].y, anchor: "start", s: `${f1(slopeRatio).replace(/\.0$/, "")}:1`, role: "dim" });

  // Final safety pass: nudge any in-pit label that still collides with a column label or another
  // in-pit label downward until clear (the columns are authoritative; in-pit labels are few).
  const columnBoxes = [...placedLeft, ...placedRight].map(labelBBox);
  const placedInpit = [];
  for (const it of inpit) {
    let guard = 0;
    while (guard++ < 40) {
      const box = labelBBox(it);
      const hit = [...columnBoxes, ...placedInpit.map(labelBBox)].some((b) => boxesIntersect(box, b));
      if (!hit) break;
      it.y += LINE_PX + GAP_PX;
    }
    placedInpit.push(it);
  }

  const labels = [...placedLeft, ...placedRight, ...placedInpit];
  const note = { x: 6, y: h - 8, s: "schematic, not to scale" };

  return { ok: true, w, h, ground, berms, bermOutlines, bands, faces, floor, lines, outlet, receiving, depthDim, slopeMarks, labels, note };
}
