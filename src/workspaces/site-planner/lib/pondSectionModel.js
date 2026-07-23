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
const f0 = (n) => Math.round(n).toLocaleString();

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
  const MARGIN_L = 86, MARGIN_R = 96;
  const sxL = MARGIN_L, sxR = w - MARGIN_R;
  const cx = (sxL + sxR) / 2;
  const sw = sxR - sxL;
  const floorHalf = sw * 0.15, openHalf = sw * 0.27;
  const bw = berm > 0.05 ? sw * 0.11 : 0;   // berm face run (schematic)
  const xFloorL = cx - floorHalf, xFloorR = cx + floorHalf;
  const xEdgeL = cx - openHalf, xEdgeR = cx + openHalf;       // pond lip at grade
  const xCrestL = xEdgeL - bw, xCrestR = xEdgeR + bw;         // berm crest (=lip when no berm)
  const xBermOutL = xCrestL - bw, xBermOutR = xCrestR + bw;   // outer toe of the berm at grade

  const yGrade = yOf(grade), yRim = yOf(rimFt), yFloor = yOf(floorFt);

  // inner faces run straight from the floor edge up to the crest; interpolate x at any elevation.
  const leftX = (e) => lerp(xFloorL, xCrestL, (e - floorFt) / (rimFt - floorFt));
  const rightX = (e) => lerp(xFloorR, xCrestR, (e - floorFt) / (rimFt - floorFt));

  // ground mass (earth below grade, across the whole section, minus the pit void)
  const ground = [
    { x: sxL, y: yGrade }, { x: xBermOutL, y: yGrade }, { x: xCrestL, y: yRim },
    { x: xFloorL, y: yFloor }, { x: xFloorR, y: yFloor }, { x: xCrestR, y: yRim },
    { x: xBermOutR, y: yGrade }, { x: sxR, y: yGrade }, { x: sxR, y: h - BOT }, { x: sxL, y: h - BOT },
  ];
  // berm fill above grade (distinct hatch) — one triangle per bank
  const berms = berm > 0.05 ? [
    [{ x: xBermOutL, y: yGrade }, { x: xCrestL, y: yRim }, { x: xEdgeL, y: yGrade }],
    [{ x: xBermOutR, y: yGrade }, { x: xCrestR, y: yRim }, { x: xEdgeR, y: yGrade }],
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

  // inner faces (drawn as the pond outline)
  const faces = [
    [{ x: xCrestL, y: yRim }, { x: xFloorL, y: yFloor }],
    [{ x: xFloorR, y: yFloor }, { x: xCrestR, y: yRim }],
  ];
  const floor = { x1: xFloorL, x2: xFloorR, y: yFloor };

  // ── horizontal reference lines ──
  const lines = [];
  lines.push({ role: "grade", x1: sxL, x2: sxR, y: yGrade });
  if (finite(wseFt) && wseFt > floorFt) lines.push({ role: "flood", x1: sxL, x2: xBermOutR, y: yOf(wseFt) });
  if (finite(groundwaterFt) && groundwaterFt > floorFt && groundwaterFt < rimFt) lines.push({ role: "groundwater", x1: leftX(groundwaterFt), x2: rightX(groundwaterFt), y: yOf(groundwaterFt) });

  // ── outlet (right bank at the invert) + receiving water beyond the berm ──
  const outlet = finite(outletInvertFt) ? { x: xFloorR, y: yOf(outletInvertFt) } : null;
  const receiving = finite(tailwaterFt) ? { x1: xBermOutR + 6, x2: sxR, y: yOf(tailwaterFt) } : null;

  // ── depth dimension (rim → floor) just inside the left floor edge ──
  const depthDim = { x: xFloorL + 10, y1: yRim, y2: yFloor };
  const slopeMarks = finite(slopeRatio) ? [{ x: (xFloorR + xCrestR) / 2 + 6, y: (yFloor + yRim) / 2 }] : [];

  // ── labels: LEFT elevation column · RIGHT facts column · in-pit dimensions ──
  const est = (b) => (b ? " EST" : "");
  const left = [];
  left.push({ key: "rim", anchorY: yRim, s: berm > 0.05 ? `rim ${f1(rimFt)}' (+${f1(berm)} ft)` : `rim ${f1(rimFt)}'`, role: "rim" });
  if (finite(gradeFt)) left.push({ key: "grade", anchorY: yGrade, s: `grade ${f1(gradeFt)}'`, role: "grade" });
  if (finite(wseFt) && wseFt > floorFt) left.push({ key: "flood", anchorY: yOf(wseFt), s: `flood ${f1(wseFt)}'${est(wseEst)}`, role: "flood" });
  if (finite(groundwaterFt) && groundwaterFt > floorFt && groundwaterFt < rimFt) left.push({ key: "gw", anchorY: yOf(groundwaterFt), s: `groundwater ${f1(groundwaterFt)}'${est(groundwaterEst)}`, role: "groundwater" });
  left.push({ key: "floor", anchorY: yFloor, s: `floor ${f1(floorFt)}'`, role: "floor" });

  const usableName = purpose === "mitigation" ? "mitigation" : "usable";
  const right = [];
  for (const b of bands) {
    if (b.kind === "usable" && finite(usableAcFt)) right.push({ key: "usable", anchorY: yOf(b.midFt), s: `${usableName} ${f1(usableAcFt)} ac-ft`, role: "usable" });
    if (b.kind === "dead" && finite(deadAcFt)) right.push({ key: "dead", anchorY: yOf(b.midFt), s: `dead ${f1(deadAcFt)} ac-ft`, role: "dead" });
    if (b.kind === "freeboard") right.push({ key: "fb", anchorY: yOf(b.midFt), s: `freeboard ${f1(Math.max(0, freeboardFt || 0))} ft`, role: "freeboard" });
  }
  if (outlet) right.push({ key: "outlet", anchorY: outlet.y, s: `outlet ${f1(outletInvertFt)}'`, role: "outlet" });
  if (receiving) right.push({ key: "recv", anchorY: receiving.y, s: `receiving ${f1(tailwaterFt)}'${est(tailwaterEst)}`, role: "receiving" });

  const placedLeft = placeColumn(left, { top: TOP, bottom: h - BOT }).map((it) => ({ ...it, x: 6, anchor: "start", leaderX: sxL }));
  const placedRight = placeColumn(right, { top: TOP, bottom: h - BOT }).map((it) => ({ ...it, x: w - 6, anchor: "end", leaderX: it.role === "receiving" ? sxR : it.role === "outlet" ? xFloorR : xEdgeR }));

  // in-pit call-outs (few + spatially separated): depth · slope · earthwork
  const inpit = [];
  inpit.push({ key: "depth", x: depthDim.x + 5, y: (yRim + yFloor) / 2, anchor: "start", s: `${f1(depthFt)} ft`, role: "dim" });
  if (finite(slopeRatio)) inpit.push({ key: "slope", x: slopeMarks[0].x, y: slopeMarks[0].y, anchor: "start", s: `${f1(slopeRatio).replace(/\.0$/, "")}:1`, role: "dim" });
  if (finite(cutCy) && cutCy > 0.5) inpit.push({ key: "cut", x: cx, y: yFloor - 6, anchor: "middle", s: `${f0(cutCy)} CY cut`, role: "earthwork" });
  if (finite(bermFillCy) && bermFillCy > 0.5 && berm > 0.05) inpit.push({ key: "bermcy", x: xCrestL, y: yRim - 4, anchor: "middle", s: `${f0(bermFillCy)} CY fill`, role: "earthwork" });

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

  return { ok: true, w, h, ground, berms, bands, faces, floor, lines, outlet, receiving, depthDim, slopeMarks, labels, note };
}
