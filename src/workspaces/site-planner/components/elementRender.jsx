/* The plan element renderer — `ElNode` / `renderElPx` and the per-element helpers beside it — extracted from SitePlanner.jsx
 * (B1064 step 1). A pure text move: nothing here reads the planner component's state, and nothing imports back from
 * SitePlanner.jsx. SVG output is byte-identical (ui-audit/capture-plan-html.mjs). @planner-extract */
import { memo } from "react";
import { rot2, elCorners, carStalls, trailerStalls, CURB, curbEdgesOf, isCenterlineRoad, roadCurbWidth, roadDenseCenterline, roadStripRing, roadCurbLines } from "../lib/siteGeometry.js";
import { dimCalloutVisible, detailLabelVisible, pondParamLabelVisible, pondParamFontPx, dimFontScale, stallStripesExplicit, segmentsPath } from "../lib/labelLayout.js";
import { pondContours, contourLabelPoint } from "../lib/pondGeom.js";
import { ringsArea } from "../lib/pondOffset.js";
import { commaInt as f0, commaDec1 as f1 } from "../../../shared/units/numberFormat.js";
import { frameBBox, dockSegExtent, clipSegmentToRing } from "../lib/footprintEdit.js";
import { computeBuildingGrid, resolveGridSettings, placeDockDoors, gridLinesVisible } from "../lib/buildingGrid.js";
import { dogEarSize, isDogEarSide } from "../lib/dogEar.js";
import { rampParts, rampLabel, rampBeltSpans, doorsAfterRamps, dockHeightInOf } from "../lib/driveInRamp.js";
import { dimSlideRange, clampDimOffset, DIM_POS_F_DEFAULT, DIM_POS_F_ROAD } from "../lib/dimSlide.js";
import { dockSidesFor, footprintDepth, footprintLength, footprintAxes } from "../lib/dockZones.js";
import { elStyle } from "../lib/planStyle.js";
import { regionPathD, rectOutlineCutSegments, polygonOutlineCutSegments, rectBandOutlineCutPolylines, curbBandPieces } from "../lib/roadNetwork.js";
import { curbStrokePx } from "../lib/roadGeometry.js";
import { bandTypeOf, hasXSection, bandLayout, bandStripeMarksWithWidth, BAND_FILL_TOKEN, BAND_FILL_OPACITY, designatedRowFt, rowMarginFt, XSEC_BAND_FILL_MIN_PX, XSEC_STRIPE_MIN_PX } from "../lib/roadCrossSection.js";
import { offsetPolyline } from "../lib/metesAndBounds.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { keptRuns } from "../lib/parkingApproach.js";
import { roadTravelWidth } from "../lib/siteModel.js";
import { CURB_STROKE_MIN_PX, GRID_FLEX, GRID_LINE, GRID_WALL, INLINE_LABEL_SPACING, POND_ADD_FILL_DEFAULT, centroid, inlineLabelEls, labelPlaceOf, ringMinSpanFt } from "../lib/planRenderHelpers.jsx";

/* Stage-contour overlay for a detention pond (the "topographic" depth rings inside the
   basin). Each level's rings come from a ROBUST inward offset (pondContours → clipper-lib),
   so acute corners round cleanly, a narrowing tail pinches off, and a split basin draws as
   separate rings — the water-surface and floor emphasized, each labelled by real elevation
   (when a top-of-bank elevation is set) or depth below top. When the design depth exceeds
   what the footprint can grade to, draws the real (partial) contours plus a LOUD max-depth
   callout instead of nonsense. Default-on (det.contours !== false); zoom-gated so a site
   overview stays clean; rings whose offset is sub-pixel are skipped (B149 anti-flicker).
   Points are world feet → f2p; the caller counter-rotates this group for a rotated rect
   pond. Returns [] when nothing to draw. */
// NEW-1 (V481(f)) — `lf` is the LABEL frame ({ ppf, k }); see lib/exportLabelScale.js. It is
// null on a screen render (→ the live ppf, k = 1) and the SHEET's own scale on an export pass,
// so a printed pond's contour tier is a function of the plan and the paper, never of the zoom
// the user was at. The sub-pixel ring gate rides it too — an export dropped or grew contour
// paths with the zoom before this (the paths 44 → 96 half of the V481(f) report).
function pondContourEls(el, f2p, ppf, keyPfx = "", lf = null) {
  const lfPpf = lf && lf.ppf > 0 ? lf.ppf : ppf;
  const lfK = lf && lf.k > 0 ? lf.k : 1;
  if (el.type !== "pond") return [];
  const det = el.det || {};
  if (det.contours === false) return []; // owner toggled off (default on)
  const ring = el.points ? el.points : elCorners(el); // world feet, top of bank
  if (!ring || ring.length < 3) return [];
  // Zoom gate (B149): reveal only once the basin reads on screen; reuses the detail LOD floor.
  let minFt;
  if (el.points) minFt = ringMinSpanFt(ring);
  else minFt = Math.min(el.w, el.h);
  if (!detailLabelVisible(minFt, lfPpf)) return [];
  const cont = pondContours(ring, det);
  const slope = cont.meta.slope;
  const toPath = (r) => r.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z";
  const largestRing = (rings) => rings.reduce((best, r) => (ringsArea([r]) > ringsArea([best]) ? r : best), rings[0]);
  const out = [];
  // Rings — outer (down=0) is the drawn edge already; skip sub-pixel offsets (anti-flicker).
  // Each level can hold MULTIPLE rings (a split basin), so draw a path per ring.
  cont.levels.forEach((lv, idx) => {
    if (lv.down <= 0 || slope * lv.down * lfPpf < 2) return;
    lv.rings.forEach((r, ri) => {
      const d = toPath(r);
      if (lv.isWater) {
        out.push(<path key={`${keyPfx}wf${idx}_${ri}`} d={d} fill="#3E7C8C" fillOpacity={0.16} stroke="none" pointerEvents="none" />);
        out.push(<path key={`${keyPfx}w${idx}_${ri}`} d={d} fill="none" stroke="#2C5D6B" strokeWidth={2} opacity={0.95} pointerEvents="none" data-contour="water" />);
      } else if (lv.isBottom) {
        out.push(<path key={`${keyPfx}b${idx}_${ri}`} d={d} fill="none" stroke="#2C5D6B" strokeWidth={1.75} strokeDasharray="4 3" opacity={0.9} pointerEvents="none" data-contour="bottom" />);
      } else {
        out.push(<path key={`${keyPfx}c${idx}_${ri}`} d={d} fill="none" stroke="#2C5D6B" strokeWidth={0.75} opacity={0.5} pointerEvents="none" data-contour="line" />);
      }
    });
  });
  // Labels — only the two callouts that matter: the water surface (anchored to the top of its
  // largest ring) and the basin floor (anchored to the bottom), so they frame the centred pond
  // name instead of stacking on it. Real elevation when a datum is set, else depth below top.
  // NEW-1 — the ELEVATION callouts are pond-design-parameter tier (labelLayout): each reveals
  // only once its own side-slope band (slope × depth below top of bank) reads on screen, and the
  // font + halo ride the shared dimension zoom scale. The rings keep their own sub-pixel gate and
  // still draw at overview zoom — only the numbers wait until you're actually inspecting the basin.
  cont.levels.forEach((lv, idx) => {
    if (lv.down <= 0 || slope * lv.down * lfPpf < 2) return;
    if (!lv.isWater && !lv.isBottom) return;
    if (!pondParamLabelVisible(slope * lv.down, lfPpf)) return;
    const lp = contourLabelPoint(largestRing(lv.rings), lv.isBottom ? "bottom" : "top");
    if (!lp) return;
    const q = f2p(lp);
    const lead = lv.isWater ? "WS " : "Floor ";
    const txt = lv.elev != null ? `${lead}${f1(lv.elev)}` : `${lead}−${f1(lv.down)}′`;
    const fsL = pondParamFontPx(lfPpf, 9), fs = fsL * lfK; // fsL is label space: the halo is authored there
    out.push(
      <text key={`${keyPfx}t${idx}`} x={q.x} y={q.y} textAnchor="middle" dominantBaseline="middle"
        fontSize={fs} fontFamily="Inter, system-ui, sans-serif" fill="#0E2E36"
        stroke="#fff" strokeWidth={fsL * 0.29} paintOrder="stroke" pointerEvents="none"
        data-contour-label={lv.isWater ? "water" : "bottom"}
        style={{ fontWeight: 700 }}>{txt}</text>,
    );
  });
  // Infeasible: the design depth is deeper than this footprint can grade to at this slope.
  // We've already drawn the real contours that DO exist; add a loud, specific max-depth call.
  if (!cont.feasible) {
    const q = f2p(centroid(ring));
    out.push(
      <text key={`${keyPfx}xt`} x={q.x} y={q.y} textAnchor="middle" dominantBaseline="middle"
        fontSize={9.5 * lfK} fontFamily="Inter, system-ui, sans-serif" fill="#B3361B" stroke="#fff"
        strokeWidth={2.9} paintOrder="stroke" pointerEvents="none" data-contour="infeasible"
        style={{ fontWeight: 800 }}>⚠ Too deep — max ≈ {f1(cont.maxDepth)}′ at {f0(slope)}:1</text>,
    );
  }
  return out;
}

// Dock-door run for ONE dock side (B569): the clear wall span between any dog-ear bumps,
// plus the door centres placed to fall BETWEEN columns. Shared by the canvas (renderElPx)
// and the panel door count so the two NEVER disagree — including the dog-ear case, where
// a bump on the dock face shortens the door run. `g` = resolveGridSettings(el, settings).
export function dockDoorRun(el, side, dogEars, lengthLines, g, rampSpans = null) {
  const horiz = side === "top" || side === "bottom";
  const L = horiz ? el.w : el.h; // wall length (ft)
  let startF, endF;
  // NEW-1/B872 — a reshaped building's doors ride the TRUE dock-wall segment (it shortens when a
  // corner is clipped / an end wall angled), so the door count tracks the real wall, not the bbox.
  if (el.footEdit) {
    const seg = dockSegExtent(el, side);
    if (!seg) return { startF: 0, endF: 0, horiz, doors: [] };
    startF = seg.startF; endF = seg.endF;
  } else {
    // Subtract a dog-ear by its ACTUAL span along this wall (B362: a resized bump consumes
    // more/less of the dock face than the nominal 55′).
    const bumpAlong = (sign) => { const d = (dogEars || []).find((x) => x.dogEar && x.dogEar.side === side && x.dogEar.sign === sign); return d ? (horiz ? d.w : d.h) : 0; };
    startF = bumpAlong(-1);
    endF = L - bumpAlong(1);
  }
  const placed = endF - startF < g.doorWidth ? [] : placeDockDoors(startF, endF, lengthLines, { doorOC: g.doorOC, doorWidth: g.doorWidth });
  // Drive-in ramps on this wall take the dock doors under their footprint out of the belt (NEW-1, 2026-10-30) — `rampSpans` is this wall's
  // [{u0,u1}] along the wall from its start (lib/driveInRamp rampBeltSpans), the same axis the door centres are measured on.
  const doors = doorsAfterRamps(placed, g.doorWidth, rampSpans);
  return { startF, endF, horiz, doors, displaced: placed.length - doors.length };
}
/** The ramp spans of one building's wall — the 6th argument of dockDoorRun. `ramps` = the driveInRamp elements attached to the building. */
export function rampSpansOnSide(ramps, side, dockSides, settings) {
  if (!ramps || !ramps.length) return null;
  const by = rampBeltSpans(ramps, dockSides, dockHeightInOf(settings));
  return by[side] || null;
}

// Corner bump-outs of a host building as [{sign, along}] measured along its length axis — the
// spans a depth dimension callout must not slide onto, since the building's depth differs there
// (B592). Pure; shared by the dimension drag handler + the renderer so they never disagree.
function bumpsAlongLength(host, allEls) {
  if (!host || host.points || host.type !== "building") return [];
  return (allEls || [])
    .filter((x) => x.attachedTo === host.id && x.dogEar && isDogEarSide(x.dogEar.side))
    .map((x) => ({ sign: x.dogEar.sign, along: dogEarSize(x.dogEar, x.w, x.h).along }));
}

// The slide constraint for an element's red dimension callout (B592): it rides the long (length)
// axis only, clamped to stay ON the footprint and — for a building — off its corner bump-outs.
// posF matches renderElPx's default position (road = centred, building/paving = 18% in).
export function dimSlideFor(el, allEls) {
  const posF = el?.type === "road" ? DIM_POS_F_ROAD : DIM_POS_F_DEFAULT;
  return dimSlideRange(el, bumpsAlongLength(el, allEls), posF);
}

/* ---- The RESOLVED NEIGHBOUR SET, per element (B1352) ----------------------------------------
 *
 * An element's drawing is not a function of that element alone. Four things it renders read the
 * WHOLE model: the curb band (`curbEdgesOf`, whose `edgeAbutsPaving` walks every other element),
 * the dog-ear bumps along a building's dock face, the dimension callout's slide range
 * (`bumpsAlongLength`), and — for a bump-out — the HOST building whose style it inherits.
 *
 * That neighbour dependency is why `renderElPx` took the whole `allEls` array, and it is exactly
 * what makes a naive `React.memo(el)` WRONG rather than merely ineffective: move a building next
 * to a paved pad and the pad's curb changes, with nothing about the pad itself having changed. A
 * memo keyed on `el` alone would keep drawing the old curb. A stale curb is a wrong drawing, and
 * a wrong drawing is worse than a slow one.
 *
 * So the dependency is MODELLED rather than assumed away: resolve every element's neighbour
 * answers ONCE per `els` change, hand each element its own resolved record, and let the record's
 * identity be the memo's evidence that its neighbourhood is unchanged. Same inputs, same outputs
 * — this is a pure re-association of work already done, not an approximation of it.
 *
 * It is also, on its own, the single largest item in the CPU profile of a zoom frame that we can
 * legitimately delete: `edgeAbutsPaving` + `curbEdgesOf` measured 8.6% of all script self-time
 * across a 40-event wheel gesture at 4x throttle (ui-audit/diagnose-zoom-cost.mjs --profile), and
 * none of it depends on the view. It was being recomputed, per element, on every frame of a
 * gesture that cannot change its answer.
 */
export function resolveElNeighbors(allEls, settings) {
  const out = new Map();
  const list = allEls || [];
  const wantDock = !!(settings && (settings.showDocks || settings.showGrid));
  for (const el of list) {
    const dogEars = list.filter((x) => x.attachedTo === el.id && x.dogEar);
    const ramps = el.type === "building" ? list.filter((x) => x.attachedTo === el.id && x.type === "driveInRamp") : [];
    const rampHost = el.type === "driveInRamp" ? (list.find((h) => h.id === el.attachedTo && h.type === "building" && !h.points) || null) : null;
    out.set(el.id, {
      ramps,
      rampHost,
      rampHostDockSides: rampHost ? dockSidesFor(rampHost).dockSides : null,
      // A bump-out (dog-ear) renders with its HOST building's resolved style — see the styleEl note below.
      styleEl: el.dogEar ? (list.find((h) => h.id === el.attachedTo && h.type === "building" && !h.points) || el) : el,
      curbEdges: curbEdgesOf(el, list),
      dogEars,
      dimSlide: dimSlideFor(el, list),
      dockPlan: wantDock ? resolveDockPlan(el, settings, dogEars, ramps) : null,
    });
  }
  return out;
}

/* ---- The per-building DOCK PLAN (NEW-3) -----------------------------------------------------
 *
 * THE SAME MISTAKE B1352 FIXED FOR CURBS, IN THE PLACE B1352 DID NOT REACH.
 *
 * `renderElPx` recomputed ALL of this inside itself, per building, on every frame of every pan and
 * zoom: the validated dock sides, the resolved grid settings, `computeBuildingGrid` (a bay-count
 * SEARCH over the footprint), the footprint axes, and `dockDoorRun` per dock side (which runs the
 * door-placement solver). Not one of them takes the view. `settings.showDocks` and
 * `settings.showGrid` both DEFAULT TO TRUE, so on a default plan every building paid for the whole
 * lot on every frame — and the count of buildings is exactly one of the axes that rises through a
 * work session, which is what makes this an AMPLIFICATION cost rather than a fixed one.
 *
 * MEASURED (ui-audit/session-axes.mjs, the layers axis): turning the drawn layers on takes an
 * identical pan-and-zoom gesture from 1,613 ms of main-thread work to 2,065 ms on the 62-element
 * reference plan — the first rung of that ladder IS this code path.
 *
 * ⛔ BYTE-IDENTICAL BY CONSTRUCTION, which is the only reason this can ship against the B1345
 * pixel bar without a pixel diff to argue about: same pure functions, same arguments, same
 * outputs — moved from "once per frame per building" to "once per model-or-settings change per
 * building". There is no approximation, no threshold and no new geometry here.
 *
 * ⚠ WHAT IS DELIBERATELY *NOT* CACHED: the `buildingChrome` path for a footprint under live
 * reshape (`el.footEdit`) recomputes its grid from the LIVE `frameBBox` every frame ON PURPOSE, so
 * the grid tracks the drag frame-by-frame. Do not "unify" that into this record.
 */
function resolveDockPlan(el, settings, dogEars, ramps = null) {
  if (!el || el.type !== "building") return null;
  const dock = el.dock || "cross";
  const { dside, dockSides } = dockSidesFor(el);
  const g = resolveGridSettings(el, settings);
  const grid = computeBuildingGrid({ length: footprintLength(el), depth: footprintDepth(el), dock, grid: g });
  const axes = footprintAxes(el);
  const lenOffsets = grid.lengthLines.map((l) => l.at);
  const runs = {};
  for (const s of dockSides) runs[s] = dockDoorRun(el, s, dogEars, lenOffsets, g, rampSpansOnSide(ramps, s, dockSides, settings));
  return { dock, dside, dockSides, g, grid, axes, runs };
}
/* ---- Drive-in ramp (NEW-1/NEW-3, 2026-10-30) -------------------------------------------------------------------------------------------
 * ONE `el:` group, so the editable PDF lifts it as ONE Bluebeam annotation (footprint first — the walker takes the first filled path as the body
 * and the largest closed filled path as the outline — then the wing walls, the doubled door line, the bollards, the slope arrow and the label).
 * Every number comes from `rampParts(host, ramp)` (lib/driveInRamp.js), the same call the tests and the grading plane make. A ramp whose host is
 * gone (a lone paste) draws its stored box as a plain footprint. Drawn in pixel space off world feet, so there is no group rotation to undo. */
function renderRampPx(el, st, f2p, isSel, tool, settings, startMoveEl, onElDouble, nb, onElContext, lfK, editingCorners) {
  const host = nb ? nb.rampHost : null;
  const marker = !!host && !!el.ramp && !(nb.rampHostDockSides || []).includes(el.ramp.side);
  const ppf = Math.hypot(f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x, f2p({ x: 1, y: 0 }).y - f2p({ x: 0, y: 0 }).y);
  const P = (q) => f2p(q);
  const pts = (ring) => ring.map((q) => { const z = P(q); return `${z.x},${z.y}`; }).join(" ");
  const line = (k, a, b, stroke, sw, extra = {}) => { const A = P(a), B = P(b); return <line key={k} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={stroke} strokeWidth={sw} strokeLinecap="butt" {...extra} />; };
  const out = [];
  let parts = null;
  if (host && el.ramp) {
    try { parts = rampParts(host, el.ramp, { marker, dockHeightIn: dockHeightInOf(settings) }); } catch (_) { parts = null; }
  }
  const ring = parts ? parts.ring : [{ x: el.cx - el.w / 2, y: el.cy - el.h / 2 }, { x: el.cx + el.w / 2, y: el.cy - el.h / 2 }, { x: el.cx + el.w / 2, y: el.cy + el.h / 2 }, { x: el.cx - el.w / 2, y: el.cy + el.h / 2 }]
    .map((q) => { const r = rot2(q.x - el.cx, q.y - el.cy, el.rot || 0); return { x: el.cx + r.x, y: el.cy + r.y }; });
  const ink = st.stroke, wallInk = "#2f3338";
  out.push(<polygon key="fp" points={pts(ring)} fill={marker ? "none" : st.fill} fillOpacity={st.fillOpacity ?? 1} stroke={ink} strokeWidth={(isSel ? 2 : 1) * lfK} strokeDasharray={marker ? `${3 * lfK} ${2 * lfK}` : undefined} />);
  if (parts) {
    parts.wings.forEach((w, i) => out.push(line(`wg${i}`, w[0], w[1], wallInk, 2.4 * lfK, { pointerEvents: "none" })));
    parts.door.forEach((d, i) => out.push(line(`dr${i}`, d[0], d[1], wallInk, 1.4 * lfK, { pointerEvents: "none" })));
    parts.bollards.forEach((b, i) => { const z = P(b); out.push(<circle key={`bl${i}`} cx={z.x} cy={z.y} r={Math.min(4 * lfK, Math.max(1.6 * lfK, 0.9 * ppf))} fill={wallInk} stroke="#fff" strokeWidth={0.6 * lfK} pointerEvents="none" />); });
    if (parts.arrow) {
      const A = P(parts.arrow.from), B = P(parts.arrow.to), dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, hl = Math.min(8 * lfK, L * 0.35);
      out.push(<g key="ar" pointerEvents="none" stroke={wallInk} strokeWidth={1.2 * lfK} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} />
        <polyline points={`${B.x - ux * hl + uy * hl * 0.6},${B.y - uy * hl - ux * hl * 0.6} ${B.x},${B.y} ${B.x - ux * hl - uy * hl * 0.6},${B.y - uy * hl + ux * hl * 0.6}`} />
      </g>);
    }
    // the label rides the footprint's LONG axis, upright (folded into -90..90), long form when it fits, short form when it does not, nothing when neither does
    const r0 = P(ring[0]), r1 = P(ring[1]), r3 = P(ring[3]);
    const e1 = { x: r1.x - r0.x, y: r1.y - r0.y }, e3 = { x: r3.x - r0.x, y: r3.y - r0.y };
    const longV = Math.hypot(e1.x, e1.y) >= Math.hypot(e3.x, e3.y) ? e1 : e3, longPx = Math.hypot(longV.x, longV.y), shortPx = Math.min(Math.hypot(e1.x, e1.y), Math.hypot(e3.x, e3.y));
    let ang = (Math.atan2(longV.y, longV.x) * 180) / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const fs = 9 * lfK, cw = fs * 0.62;
    const full = rampLabel(el.ramp, { marker }), short = rampLabel(el.ramp, { short: true, marker });
    const txt = (full.length * cw + 8 <= longPx && fs + 4 <= shortPx) ? full : (short.length * cw + 8 <= longPx && fs + 4 <= shortPx ? short : null);
    if (txt) {
      const cz = P(parts.centre);
      out.push(<text key="lb" data-ramp-label x={cz.x} y={cz.y} transform={`rotate(${ang} ${cz.x} ${cz.y})`} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fill={wallInk} stroke="#fff" strokeWidth={2.4 * lfK} paintOrder="stroke" pointerEvents="none">{txt}</text>);
    }
  }
  return <g key={el.id} data-el-id={el.id} data-feature={`el:${el.id}`} data-ramp-marker={marker ? "1" : undefined} style={{ cursor: (tool === "select" && !editingCorners) ? "pointer" : "crosshair" }}
    onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
    onContextMenu={(e) => { if (onElContext) onElContext(e, el.id); }}>{out}</g>;
}

/* element renderer working in PIXEL space (points pre-transformed by f2p).
   We draw the rect via the rotated group around the element's pixel center.
   ⚠ B1352 — `nb` is this element's RESOLVED NEIGHBOUR RECORD (resolveElNeighbors above), NOT the
   element array. Do not reintroduce an `allEls` parameter: the whole point is that this function
   can no longer reach across the model, so its output is a function of its arguments alone and
   `ElNode`'s memo is sound. `isSel`/`dimHidden` are likewise pre-resolved booleans rather than the
   whole `sel` object and the whole suppressed-id Set, so a selection change re-renders the two
   elements it concerns instead of all of them. */
function renderElPx(el, f2p, isSel, tool, settings, startMoveEl, onElDouble, nb, startDimMove, onDimNumberDown, onElContext, dimHidden, roadNet, lf = null, editingCorners = false, roadPass = null) {
  // NEW-2 — the junction vertices whose corners render SHARP, read off the road-network data this
  // renderer already receives (renderElPx is module-level, so it cannot close over the memo).
  const sharpFor = (e) => (roadNet && roadNet.junctionVerts && e && e.id != null ? roadNet.junctionVerts.get(e.id) : undefined);
  // NEW-1 (V481(f)) — the LABEL frame (lib/exportLabelScale.js). Null on screen. On an export
  // pass it carries the SHEET's px-per-foot, so this element's dimension/width callouts make
  // the same show/hide + size decisions no matter where the canvas happened to be zoomed.
  const lfPpf = lf && lf.ppf > 0 ? lf.ppf : null;
  const lfK = lf && lf.k > 0 ? lf.k : 1;
  // B617 — zoom multiplier (px/ft ÷ the default 0.35) so a road's curb/edge stroke holds constant
  // relative to the drawing across zoom, exactly like the in-component markup/utility strokes.
  const zk = lf && lf.strokeZk > 0 ? lf.strokeZk : (f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x) / 0.35;
  // Per-element striping config. renderElPx is a MODULE-level fn, so it can't close
  // over the component-scoped cfgOf — referencing that one here threw "cfgOf is not
  // defined" inside the els.map during render and blanked the whole page on any
  // project with a parking element. Resolve it locally from the settings param.
  const cfgOf = (e) => (e.cfg ? { ...settings, ...e.cfg } : settings);
  // A bump-out (dog-ear) is part of its building, so it renders with the HOST building's resolved
  // fill / stroke / opacity — a recoloured or faded building carries its bump-outs with it (owner
  // request). Falls back to the bump's own style if the host isn't in the list.
  const styleEl = (el.dogEar && nb && nb.styleEl) || el;
  const st = elStyle(styleEl, settings);
  const fillOp = st.fillOpacity ?? 1;
  const texFill = st.pattern ? `url(#pat-${st.pattern})` : st.hatch ? "url(#pat-landscape)" : null;
  // B231 — cartographic water body (detention pond): a radial steel-teal gradient fill at
  // ~80% opacity + a constant-screen-pixel teal outline. NEVER orange (the Markup accent), so
  // a pond never reads as redline — selection is shown by a thicker teal stroke + the vertex
  // handles, not a colour change.
  const waterFill = st.cartoWater ? "url(#grad-water)" : st.fill;
  if (el.type === "driveInRamp") return renderRampPx(el, st, f2p, isSel, tool, settings, startMoveEl, onElDouble, nb, onElContext, lfK, editingCorners);
  const waterOp = st.cartoWater ? 0.8 : fillOp;
  // NEW-8 — a pond's cartographic outline is a fixed 2 px (3 selected) UNTIL the element, or its type
  // default, carries an explicit outline width; then that width wins (+1 while selected).
  const cartoStrokeW = st.strokeWidthSet != null ? (isSel ? st.strokeWidthSet + 1 : st.strokeWidthSet) : (isSel ? 3 : 2);
  const elStroke = st.stroke; // B619: no accent recolor on select — the element keeps its own outline color (blue chrome cues the selection)
  // Detention "expand vs. existing" ghost: the locked baseline footprint, in world
  // feet, drawn dashed so the user sees what the pond grew from. Same path for the
  // polygon and rect branches (the rect branch counter-rotates it back to world).
  const ghostRing = el.type === "pond" && el.det?.baseline?.ring?.length >= 3 ? el.det.baseline.ring : null;
  const ghostPath = ghostRing ? ghostRing.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z" : null;
  const ghostEl = (k) => <path key={k} d={ghostPath} fill="none" stroke="#2C5D6B" strokeWidth={1.25} strokeDasharray="7 5" opacity={0.8} pointerEvents="none" />;
  if (el.points) { // polygon element (irregular area drawn by clicking points)
    const dPath = el.points.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z";
    // B1613152 — a drive tees into a POLYGON pad the same way it tees into a rect one (NEW-4 above,
    // renderElPx's rect branch): the pad's own outline is interrupted where the drive's dissolved
    // pavement crosses it, so the junction reads as one continuous curb rather than the pad's raw
    // straight edge cutting a bevel across the curb-return wedge. See polygonOutlineCutSegments's
    // own header (roadNetwork.js) for why an un-cut polygon edge reads as a truncated arc.
    const outlineCut = roadNet && roadNet.outlineCuts ? roadNet.outlineCuts.get(el.id) : null;
    const outlineCutSegs = outlineCut ? polygonOutlineCutSegments(el, outlineCut, roadNet.mouths && roadNet.mouths.get(el.id)) : null;
    // B157: in expansion mode paint the two zones with distinct fills — the whole (expanded)
    // shape in the "added" tint, then the existing basin painted on top. The existing basin
    // keeps the cartographic water gradient by default (a normal pond looks unchanged); the
    // added ring reads as a lighter solid tint. Either zone is user-overridable.
    const existF = el.det?.existFill ?? waterFill;
    const addF = el.det?.addFill ?? POND_ADD_FILL_DEFAULT;
    // NEW-1/B872 — a RESHAPED building keeps its column grid + dock doors. The rect renderer draws
    // these in the rect branch this early-return skips, so redraw them here off the dock-frame box
    // (cx/cy/w/h/rot), CLIP every grid line to the true (irregular) outline, and repoint the doors to
    // the real dock-wall segment (which shortens when a corner is clipped / an end wall is angled).
    // Gate on `footEdit` (a rect reshaped via NEW-1) — those carry the dock frame (dockLines) needed to
    // clip the grid + repoint doors. A hand-CLICK-DRAWN irregular building has no dock frame, so it keeps
    // its prior fill-only render (no regression — parity requirement).
    const buildingChrome = (el.type === "building" && el.footEdit && !el.dogEar && (settings.showDocks || settings.showGrid)) ? (() => {
      const ppf = f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x;
      const rot = el.rot || 0;
      // Recompute the dock-frame box LIVE from the current outline (el.w/h/cx/cy only re-sync on drop),
      // so the grid + doors track the reshape frame-by-frame. The dock AXIS is read off the (stable)
      // element so it can't flip mid-drag.
      const fax = footprintAxes(el), lenIsW = fax.length === "w";
      const bb = frameBBox(el.points, rot);
      const L = lenIsW ? bb.w : bb.h, D = lenIsW ? bb.h : bb.w;
      if (!(L > 0) || !(D > 0)) return null;
      const dock = el.dock || "cross";
      const { dside, dockSides } = dockSidesFor(el);
      const faceAtZero = dock === "cross" || dock === "none" ? true : (dside === "top" || dside === "left");
      const depthFt = (d) => (faceAtZero ? d : D - d);
      // Frame-local (length 0..L, depth 0..D) → world feet, via the dock-frame box + rotation.
      const fw = (lenOff, depOff) => {
        const lc = lenOff - L / 2, dc = depOff - D / 2;
        const fx = lenIsW ? lc : dc, fy = lenIsW ? dc : lc;
        const r = rot2(fx, fy, rot);
        return { x: bb.cx + r.x, y: bb.cy + r.y };
      };
      const gridLine = (aOff, bOff, style, key) => clipSegmentToRing(fw(aOff[0], aOff[1]), fw(bOff[0], bOff[1]), el.points).map((s, i) => {
        const p = f2p(s.a), q = f2p(s.b);
        return <line key={`${key}_${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} {...style} pointerEvents="none" />;
      });
      const out = [];
      const g = resolveGridSettings(el, settings);
      const grid = computeBuildingGrid({ length: L, depth: D, dock, grid: g });
      // NEW-1 (B1614544) — reveal gate is VIEW SCALE ONLY (buildingGrid.gridLinesVisible), never
      // this building's own on-screen footprint size; see that module's header for why.
      if (settings.showGrid && grid.summary && gridLinesVisible(lfPpf || ppf)) {
        const lineStyle = (role) => role === "flex"
          ? { stroke: GRID_FLEX, strokeWidth: 0.6, strokeDasharray: "5 4", opacity: 0.85 }
          : { stroke: GRID_LINE, strokeWidth: 0.5, opacity: 0.8 };
        grid.lengthLines.forEach((ln, i) => { out.push(...gridLine([ln.at, 0], [ln.at, D], lineStyle(ln.role), `pgl${i}`)); });
        grid.depthLines.forEach((ln, i) => { const d = depthFt(ln.at); out.push(...gridLine([0, d], [L, d], lineStyle(ln.role), `pgd${i}`)); });
        dockSides.forEach((s) => { // heavy dock wall(s) — the TRUE (possibly shortened) loaded segment
          const ex = dockSegExtent(el, s); if (!ex) return;
          const edge = (s === "top" || s === "left") ? 0 : D;
          const p = f2p(fw(ex.startF, edge)), q = f2p(fw(ex.endF, edge));
          out.push(<line key={`pgw${s}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={GRID_WALL} strokeWidth={1.6} pointerEvents="none" />);
        });
      }
      if (settings.showDocks && dockSides.length) {
        const apF = Math.min(8, Math.min(Math.abs(bb.w), Math.abs(bb.h)) * 0.25);
        const lenOffsets = grid.lengthLines.map((l) => l.at);
        const leaf = g.doorWidth;
        const poly = (corners, fill, stroke, sw, key) => <polygon key={key} points={corners.map((pp) => { const q = f2p(fw(pp[0], pp[1])); return `${q.x},${q.y}`; }).join(" ")} fill={fill} fillOpacity={0.92} stroke={stroke} strokeWidth={sw} pointerEvents="none" />;
        dockSides.forEach((s) => {
          const { startF, endF, doors } = dockDoorRun(el, s, [], lenOffsets, g);
          if (!doors.length) return;
          const e0 = (s === "top" || s === "left") ? 0 : D;
          const e1 = (s === "top" || s === "left") ? apF : D - apF;
          out.push(poly([[startF, e0], [endF, e0], [endF, e1], [startF, e1]], "#9aa3b0", "#5b6470", 1, `pda${s}`));
          doors.forEach((cF, i) => out.push(poly([[cF - leaf / 2, e0], [cF + leaf / 2, e0], [cF + leaf / 2, e1], [cF - leaf / 2, e1]], "#c2c9d2", "#5b6470", 0.6, `pdd${s}${i}`)));
        });
      }
      return out.length ? out : null;
    })() : null;
    return (
      <g key={el.id} data-el-id={el.id} data-feature={`el:${el.id}`} filter={st.shadow ? "url(#bldgShadow)" : undefined} style={{ cursor: (tool === "select" && !editingCorners) ? (el.locked ? "pointer" : "move") : "crosshair" }}
        onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
        onContextMenu={(e) => { if (onElContext) onElContext(e, el.id); }}>
        <path d={dPath} fill={ghostPath ? addF : waterFill} fillOpacity={waterOp} stroke="none" />
        {ghostPath && <path d={ghostPath} fill={existF} fillOpacity={waterOp} stroke="none" pointerEvents="none" />}
        {texFill && <path d={dPath} fill={texFill} stroke="none" pointerEvents="none" />}
        {buildingChrome}
        {/* B617: a polygon element is a filled AREA (irregular pond / building / paving / landscape) —
            its outline is a filled-area edge, so it keeps a FIXED pixel weight (the fill carries the
            shape). Only linear features (roads, markup/utility lines) scale. */}
        <path d={dPath} fill="none" stroke={outlineCutSegs ? "none" : elStroke} strokeOpacity={st.strokeOpacity} strokeWidth={st.cartoWater ? cartoStrokeW : (isSel ? st.weight + 1.25 : st.weight)} />
        {outlineCutSegs && outlineCutSegs.length > 0 && (
          <g data-testid="polygon-outline-cut" data-el-id={el.id}>
            {outlineCutSegs.map((seg, i) => (
              <polyline key={`polol${i}`} points={seg.map((q) => { const sp = f2p(q); return `${sp.x},${sp.y}`; }).join(" ")}
                fill="none" stroke={elStroke} strokeOpacity={st.strokeOpacity} strokeWidth={st.cartoWater ? cartoStrokeW : (isSel ? st.weight + 1.25 : st.weight)}
                strokeLinecap="butt" pointerEvents="none" />
            ))}
          </g>
        )}
        {ghostPath && ghostEl("ghost")}
        {el.type === "pond" && pondContourEls(el, f2p, f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x, "pc", lf)}
      </g>
    );
  }
  if (isCenterlineRoad(el)) { // centerline road (B596–B599): surface + curbs + dimension all from pts
    const ppf = (f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x);
    const ring = roadStripRing(el, settings, sharpFor(el), roadNet && roadNet.trims ? roadNet.trims.get(el.id) : undefined);
    const dPath = ring.length >= 3 ? ring.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z" : null;
    /* NEW-1 (2026-10-15) — WHERE THIS ROAD'S DECORATION MAY PAINT. The strip ring is the right bound for the road's own hit target and (outside the
       network) its own fill, but not for decoration: a tinted band bounded by the strip ends on the strip's straight edge exactly where the untinted curb
       return begins — a line between the road and the curve. `roadNet.decoDomains` (roadDeco.js) is the strip with the junction throats cut out; a road
       with no junction has no entry and keeps its plain strip. An EMPTY list means the whole strip is throat: nothing decorative paints. */
    const decoRings = roadNet && roadNet.decoDomains ? roadNet.decoDomains.get(el.id) : undefined;
    const decoD = decoRings
      ? (decoRings.length ? decoRings.map((rg) => rg.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z").join(" ") : null)
      : dPath;
    const stroke = st.stroke; // B619: no accent recolor on select — blue vertex handles cue the selection
    const rparts = [];
    // NEW-1/NEW-2 — a road that belongs to the dissolved network (every centerline road does, even a
    // lone one — it is simply a one-member cluster) does NOT paint its own strip fill or back-of-curb
    // edge here: the network layer already painted the whole cluster as one region with one continuous
    // outline. Painting the strip again would put the butting cap and the through-curb line straight
    // back on top of the union. What stays per-road is the invisible HIT TARGET (so the road is still
    // clickable/draggable — pointerEvents="all" hits an unpainted path), the texture overlay, and the
    // trimmed inner curb stripes.
    const inNetwork = !!(roadNet && roadNet.memberIds && roadNet.memberIds.has(el.id));
    /* B1788912 REGRESSION FIX — a road's decoration (band fills, lane striping, ROW lines, texture,
       inner curb stripes, width dimension, inline label) is drawn ON its cluster's dissolved pavement,
       so it must paint AFTER that composite. Elements stack in creation order (B1788912) and a cluster
       takes its NEWEST member's z, so a road's own node always paints at-or-before its cluster's fill
       and the fill buried every designed section ("the designed road sections just show as a single
       road"). Two passes now: the ordinary element node paints only the invisible HIT target at the
       road's own z (`roadPass` null); the decoration pass (`roadPass === "deco"`) is rendered by the
       cluster's paint item, immediately after its fill. A road outside the network paints both here. */
    if (inNetwork && roadPass !== "deco") {
      return (
        <g key={el.id} data-el-id={el.id} data-feature={`el:${el.id}`} filter={st.shadow ? "url(#bldgShadow)" : undefined} style={{ cursor: (tool === "select" && !editingCorners) ? (el.locked ? "pointer" : "move") : "crosshair" }}
          onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
          onContextMenu={(e) => { if (onElContext) onElContext(e, el.id); }}>
          {dPath && <path key="hit" d={dPath} fill="none" stroke="none" pointerEvents="all" />}
        </g>
      );
    }
    if (dPath) {
      if (inNetwork) {
        // decoration pass: the hit target is already provided by the element's own node.
      } else {
        // Pavement+curb surface = bufferPolyline of the tessellated centerline at travelW + 2 curbs.
        rparts.push(<path key="surf" d={dPath} fill={st.fill} fillOpacity={fillOp} stroke="none" />);
        // B719: the pavement edge (back-of-curb) is drawn as a TO-SCALE 6" curb line (curbFt × ppf,
        // floored), not a fixed pixel weight — so the road border reads as a thin curb at site zoom
        // and grows proportionally on zoom-in, instead of the old fat ~5–7px band. Selection is cued
        // by the blue vertex handles (B619), so no on-select weight bump here.
        rparts.push(<path key="edge" d={dPath} fill="none" stroke={stroke} strokeWidth={curbStrokePx(roadCurbWidth(el), ppf, CURB_STROKE_MIN_PX * lfK)} />);
      }
      if (texFill && decoD) rparts.push(<path key="tex" d={decoD} fill={texFill} fillRule="evenodd" stroke="none" pointerEvents="none" />);
      // NEW-1/NEW-3 — any road carrying an xsection at all (even the dialog's own single-band
      // wrapper — `xsectionFromRoad`) reaches this block now; a REAL designed section (2+ bands,
      // `hasXSection`) additionally gets band fills + lane markings. Pulling the outer gate back from
      // `hasXSection` to bare `el.xsection` is the NEW-3 fix: a designated ROW used to only draw once
      // a road had a real multi-band design, even though the Properties panel's own ROW field (and
      // `designatedRowFt` itself) never required one — a single-band road with a designated ROW
      // stored a real `rowDesignFt` that the canvas simply never looked at.
      if (el.xsection) {
        // NEW-1/NEW-3 — hoisted out of both gates below: the trimmed dense centerline and the
        // point-string helper are needed by the band fills (real sections only) AND by the designated
        // ROW lines (any section at all — a thin ROW line reads fine at any zoom a section is legible
        // at all, and a single-band road can carry a designated ROW with no bands to gate on).
        const xsDense = roadDenseCenterline(el, settings, sharpFor(el), roadNet && roadNet.trims ? roadNet.trims.get(el.id) : undefined);
        const toPts = (line) => line.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ");

        // NEW-1 — a road carrying a REAL designed cross-section (2+ bands) paints its within-curb
        // bands as distinct fills + lane markings, INSIDE the same pavement ring computed above: the
        // outer pavement outline, curb lines and junction dissolve are UNCHANGED (still driven by
        // el.travelW, which setRoadXSection keeps in sync as the sum of within-curb band widths — see
        // lib/roadCrossSection.js's header). Clipped to THIS road's own strip ring via an SVG clipPath
        // (the same idiom the overlay crop above already uses), so the decoration can never paint past
        // the pavement even at a junction — a lighter-weight substitute for the precise per-neighbor
        // trim the outer curb lines get (roadNet.stripes); stated as a known approximation for interior
        // decoration, not hidden — median-openings-at-junctions is its own filed follow-on (B768163).
        // ⛔ NEW-1 fix — GATED PER BAND / PER SEAM, never on the section's single narrowest band. The
        // pre-fix single `minBandFt * ppf >= 3` gate collapsed the WHOLE section — every fill AND
        // every stripe — the moment ANY one band (usually a 2' curb & gutter) got too small on
        // screen, even while every other band (12' travel lanes, a 20' median) was still perfectly
        // resolvable: a road with a real section reverted to plain undifferentiated asphalt while
        // zooming out, long before it needed to. Each band's own fill now gates on ITS OWN width; each
        // lane-marking seam gates independently, on the narrower of its two adjacent bands, against
        // the much smaller `XSEC_STRIPE_MIN_PX` floor — a hairline stripe stays legible far past the
        // point a solid fill of the same width would just be visual noise.
        if (hasXSection(el)) {
          const xsLayout = bandLayout(el.xsection);
          const clipId = `xsclip-${el.id}`;
          // NEW-2 (owner report, 2026-08-26 — "the 30ft parkway renders on the plan as... nothing at
          // all. Actual: it renders nothing at all") — every typed band paints now, not only the
          // within-curb ones. WITHIN-curb fills stay clipped to the pavement ring (dPath), unchanged —
          // an OUTSIDE-curb band (sidewalk/parkway/ditch) sits entirely past that ring by construction,
          // so clipping it to dPath would clip it away entirely, which is the exact bug this fixes. Its
          // polygon is built the identical way, from the SAME trimmed xsDense, so it is already correctly
          // bounded lengthwise and needs no clip of its own.
          const bandFillFor = (e) => {
            const left = offsetPolyline(xsDense, e.from), right = offsetPolyline(xsDense, e.to);
            if (!left || !right) return null;
            return <polygon key={`xb${e.index}`} points={toPts([...left, ...right.slice().reverse()])} fill={BAND_FILL_TOKEN[e.band.type]} fillOpacity={BAND_FILL_OPACITY[e.band.type]} stroke="none" pointerEvents="none" />;
          };
          const bandVisible = (e) => e.band.w * ppf >= XSEC_BAND_FILL_MIN_PX;
          const bandFillsIn = xsLayout.edges.filter((e) => bandTypeOf(e.band.type).withinCurb && BAND_FILL_TOKEN[e.band.type] && bandVisible(e)).map(bandFillFor).filter(Boolean);
          const bandFillsOut = xsLayout.edges.filter((e) => !bandTypeOf(e.band.type).withinCurb && BAND_FILL_TOKEN[e.band.type] && bandVisible(e)).map(bandFillFor).filter(Boolean);
          const markW = Math.max(0.8, lfK);
          const drawSeam = (offFt, key, style) => {
            const line = offsetPolyline(xsDense, offFt);
            if (!line || line.length < 2) return null;
            return <polyline key={key} points={toPts(line)} fill="none" stroke="#f2f2f2" strokeWidth={markW} strokeDasharray={style === "white-dash" ? `${8 * lfK} ${6 * lfK}` : undefined} pointerEvents="none" />;
          };
          const laneMarks = bandStripeMarksWithWidth(el.xsection)
            .filter((m) => m.minBandFt * ppf >= XSEC_STRIPE_MIN_PX)
            .map((m, i) => drawSeam(m.atOffset, `xm${i}`, m.style)).filter(Boolean);
          if (decoD && (bandFillsIn.length || laneMarks.length)) {
            rparts.push(
              <g key="xsec" clipPath={`url(#${clipId})`}>
                <clipPath id={clipId}><path d={decoD} clipRule="evenodd" /></clipPath>
                {bandFillsIn}
                {laneMarks}
              </g>,
            );
          }
          /* NEW-1 — an OUTSIDE-curb band (sidewalk / parkway / ditch) is not pavement: it must not paint over the dissolved surface it runs into at a junction
             (it ran on to the node, over the through road and the curb returns). Clip it to everything EXCEPT its cluster's region. */
          const outRegion = inNetwork ? roadNet.regions.find((rr) => rr.ids.includes(el.id)) : null;
          const outRegionD = outRegion ? regionPathD(outRegion.region, f2p) : null;
          if (bandFillsOut.length) {
            rparts.push(outRegionD
              ? (
                <g key="xsecOut" clipPath={`url(#xsout-${el.id})`}>
                  <clipPath id={`xsout-${el.id}`}><path d={`M-1000000,-1000000H1000000V1000000H-1000000Z ${outRegionD}`} clipRule="evenodd" /></clipPath>
                  {bandFillsOut}
                </g>
              )
              : <g key="xsecOut">{bandFillsOut}</g>);
          }
        }

        // NEW-1 (owner report, 2026-08-26 — "id like to designate the ROW to like a 100' row should be
        // shown") — a designated right-of-way draws as a thin dashed boundary line each side, offset
        // from the centerline by half the designated width and following the SAME trimmed centerline
        // (xsDense) the pavement ring itself is built from — so it curves, arcs and trims exactly like
        // the ribbon, per the brief's own instruction. Plus an inline "N′ R.O.W." label styled like the
        // existing width-dimension callout (same font/scale/halo idiom, a neutral tone rather than the
        // dimension's red so the two are never mistaken for one control). Gated on the section actually
        // being valid — `rowMarginFt` returns null both when nothing is designated and when either side
        // of the modeled bands runs past the designated ROW (NEW-4 — that invalid state is a loud
        // warning in the dialog, never a silently-clamped line here) — and on the View ▾ "ROW lines"
        // toggle (settings.showRowLines, default on: the same settings.show* shape as showGrid/showDims).
        // NEW-3 — deliberately NOT gated on `hasXSection(el)`: a single-band road with a designated
        // ROW draws this boundary exactly like a real multi-band one.
        const rowFt = designatedRowFt(el.xsection);
        const rowMargin = rowFt != null ? rowMarginFt(el.xsection) : null;
        if (rowMargin != null && settings.showRowLines !== false) {
          const rowHw = rowFt / 2;
          const rowLineL = offsetPolyline(xsDense, rowHw), rowLineR = offsetPolyline(xsDense, -rowHw);
          const rowDash = `${9 * lfK} ${5 * lfK}`;
          [rowLineL, rowLineR].forEach((line, i) => {
            if (!line || line.length < 2) return;
            rparts.push(<polyline key={`rowln${i}`} points={toPts(line)} fill="none" stroke="var(--text-tertiary)" strokeWidth={Math.max(0.75, lfK)} strokeDasharray={rowDash} pointerEvents="none" />);
          });
          if (settings.showDims !== false && xsDense.length >= 2) {
            const mi = Math.max(1, Math.min(xsDense.length - 1, Math.floor(xsDense.length / 2)));
            const p0 = xsDense[mi - 1], p1 = xsDense[mi];
            const ddl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
            const rdir = { x: (p1.x - p0.x) / ddl, y: (p1.y - p0.y) / ddl };
            const rnrm = { x: -rdir.y, y: rdir.x };
            const midPt = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
            const labelPt = f2p({ x: midPt.x + rnrm.x * rowHw, y: midPt.y + rnrm.y * rowHw });
            const rk = dimFontScale(lfPpf || ppf) * lfK, rfz = 10 * rk;
            rparts.push(
              <text key="rowlbl" x={labelPt.x} y={labelPt.y} textAnchor="middle" dominantBaseline="middle" fontSize={rfz} fontFamily={NUM_FONT} fontVariantNumeric={TABULAR_NUMS} fill="var(--text-tertiary)" stroke="#fff" strokeWidth={2.5} paintOrder="stroke" fontWeight="700" pointerEvents="none">
                {f0(rowFt)}′ R.O.W.
              </text>,
            );
          }
        }
      }
    }
    // Curb stripe lines = the centerline offset by ±travelW/2 (the inner face-of-curb edges), TRIMMED
    // against the rest of the cluster's pavement (roadNet.stripes) so a stripe stops at the junction
    // instead of drawing a curb straight through the intersection.
    const stripeLines = inNetwork ? (roadNet.stripes.get(el.id) || []) : roadCurbLines(el, settings, sharpFor(el), roadNet && roadNet.trims ? roadNet.trims.get(el.id) : undefined);
    stripeLines.forEach((cl, i) => {
      if (!cl || cl.length < 2) return;
      rparts.push(<polyline key={`curb${i}`} points={cl.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ")} fill="none" stroke={st.stroke} strokeOpacity={st.strokeOpacity} strokeWidth={st.strokeWidthSet ?? curbStrokePx(roadCurbWidth(el), ppf, CURB_STROKE_MIN_PX * lfK)} pointerEvents="none" />);
    });
    // Travel-width dimension anchored to the CENTERLINE MIDPOINT (excludes the curb — reads the
    // true travel width). B149 detail tier (a road width hides at site-overview zoom); kept while
    // selected so the click-to-edit / drag handle never vanishes mid-edit.
    if (!el.noLabel) {
      const dense = roadDenseCenterline(el, settings, sharpFor(el));
      const segLens = []; let totalLen = 0;
      for (let i = 1; i < dense.length; i++) { const l = Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y); segLens.push(l); totalLen += l; }
      let acc = totalLen / 2, midPt = dense[0] || { x: el.cx, y: el.cy }, dir = { x: 1, y: 0 };
      for (let i = 1; i < dense.length; i++) {
        const sl = segLens[i - 1];
        if (acc <= sl || i === dense.length - 1) {
          const t = sl > 0 ? acc / sl : 0;
          midPt = { x: dense[i - 1].x + (dense[i].x - dense[i - 1].x) * t, y: dense[i - 1].y + (dense[i].y - dense[i - 1].y) * t };
          const dl = sl || 1; dir = { x: (dense[i].x - dense[i - 1].x) / dl, y: (dense[i].y - dense[i - 1].y) / dl };
          break;
        }
        acc -= sl;
      }
      const nrm = { x: -dir.y, y: dir.x }, hw = Math.max(0, (+el.travelW || 0) / 2);
      const off = el.dimOffset || { x: 0, y: 0 };
      const anchorPx = f2p(midPt);
      const A = f2p({ x: midPt.x + nrm.x * hw + off.x, y: midPt.y + nrm.y * hw + off.y });
      const B = f2p({ x: midPt.x - nrm.x * hw + off.x, y: midPt.y - nrm.y * hw + off.y });
      const M = f2p({ x: midPt.x + off.x, y: midPt.y + off.y });
      const RED = "#dc2626", k = dimFontScale(lfPpf || ppf) * lfK, tick = 4 * k, fz = 11 * k, txt = `${f0(+el.travelW || 0)}′`; // B911: shared zoom→font scale — NEW-1: on the LABEL frame, so a sheet's width callout is paper-sized, not zoom-sized
      const dimSel = isSel && tool === "select";
      const dimVisible = detailLabelVisible(+el.travelW || 0, lfPpf || ppf);
      const moved = Math.hypot(off.x, off.y) > 0.5;
      // B912 — the width number is a click target (select on single, edit length on double-tap),
      // active whenever the select tool is up; pointerEvents="all" so it's clickable even before the
      // road is selected (the wrapping dim group is pointer-transparent when unselected).
      const numHandlers = (tool === "select" && onDimNumberDown)
        ? { style: { cursor: el.locked ? "pointer" : "text" }, pointerEvents: "all", onPointerDown: (e) => { if (e.button === 0) { e.stopPropagation(); onDimNumberDown(e, el.id); } } }
        : {};
      if (settings.showDims !== false && (dimVisible || dimSel)) { // B121: "Show dimensions" gates the centerline-road width callout too
        const dim = [];
        if (moved) dim.push(<line key="lead" x1={M.x} y1={M.y} x2={anchorPx.x} y2={anchorPx.y} stroke={RED} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />);
        dim.push(<line key="dl" x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={RED} strokeWidth={1.25} />);
        const tnx = nrm.x * tick, tny = nrm.y * tick; // ticks perpendicular to the dim line (along the road)
        dim.push(<line key="t0" x1={A.x - dir.x * tick} y1={A.y - dir.y * tick} x2={A.x + dir.x * tick} y2={A.y + dir.y * tick} stroke={RED} strokeWidth={1.25} />);
        dim.push(<line key="t1" x1={B.x - dir.x * tick} y1={B.y - dir.y * tick} x2={B.x + dir.x * tick} y2={B.y + dir.y * tick} stroke={RED} strokeWidth={1.25} />);
        if (dimSel) dim.push(<line key="grab" data-testid="el-dim-grab" x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="transparent" strokeWidth={14} />);
        dim.push(<text key="tx" data-testid="el-dim" x={M.x + dir.x * (fz * 0.9) - tnx} y={M.y + dir.y * (fz * 0.9) - tny} textAnchor="middle" dominantBaseline="middle" fontSize={fz} fontFamily={NUM_FONT} fontVariantNumeric={TABULAR_NUMS} fill={RED} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" fontWeight="600" {...numHandlers}>{txt}</text>);
        rparts.push(
          <g key="dim" data-el-dim="1" style={dimSel ? { cursor: "move" } : { pointerEvents: "none" }}
            onPointerDown={dimSel ? ((e) => { if (e.button === 0) { e.stopPropagation(); startDimMove(e, el.id); } }) : undefined}>
            {dim}
          </g>,
        );
      }
    }
    // B620 — inline label riding the road centerline (own color + white halo; sparse spacing).
    // B935 — "Inside" placement tucks it a quarter of the travel-width off the centerline (into clear
    // pavement) so it doesn't sit on the drawn centerline; default rides the centerline as before.
    rparts.push(...inlineLabelEls(roadDenseCenterline(el, settings, sharpFor(el)), el.inlineLabel, st.stroke, el.labelSpacing || INLINE_LABEL_SPACING.road, ppf, f2p, `il${el.id}-`, { size: el.labelSize, halo: el.labelHalo, place: labelPlaceOf(el), lf, insetFt: labelPlaceOf(el) === "inside" ? Math.max(0, (+el.travelW || 0) / 4) : 0 }));
    return (
      <g key={el.id} data-el-id={roadPass === "deco" ? undefined : el.id} data-road-deco={roadPass === "deco" ? el.id : undefined} data-feature={`el:${el.id}`} filter={st.shadow ? "url(#bldgShadow)" : undefined} style={{ cursor: (tool === "select" && !editingCorners) ? (el.locked ? "pointer" : "move") : "crosshair" }}
        onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
        onContextMenu={(e) => { if (onElContext) onElContext(e, el.id); }}>{rparts}</g>
    );
  }
  const tl = f2p({ x: el.cx - el.w / 2, y: el.cy - el.h / 2 });
  const c = f2p({ x: el.cx, y: el.cy });
  const ppf = (f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x); // px per foot
  const w = el.w * ppf, h = el.h * ppf;
  const parts = [];
  const rx = el.type === "pond" ? Math.min(w, h) * 0.12 : 0;
  // B157: in expansion mode, split the rect pond into two fill zones — existing basin keeps
  // the cartographic gradient by default; the added ring gets the lighter solid tint.
  const rectExistF = el.det?.existFill ?? waterFill;
  const rectAddF = el.det?.addFill ?? POND_ADD_FILL_DEFAULT;
  // NEW-4 — a rect a drive tees into paints its FILL here but its OUTLINE as interrupted edges below,
  // so the entrance reads as one continuous curb instead of a line ruled across the opening.
  const outlineCut = roadNet && roadNet.outlineCuts ? roadNet.outlineCuts.get(el.id) : null;
  const rectStrokeW = st.cartoWater ? cartoStrokeW : el.type === "road" ? (st.strokeWidthSet ?? curbStrokePx(roadCurbWidth(el), ppf, CURB_STROKE_MIN_PX * lfK)) /* B719: legacy rect road border to scale; NEW-8 an explicit outline width wins */ : (isSel ? st.weight + 0.75 : st.weight);
  parts.push(<rect key="r" x={tl.x} y={tl.y} width={w} height={h} fill={ghostPath ? rectAddF : waterFill} fillOpacity={waterOp}
    stroke={outlineCut ? "none" : st.stroke /* B619: no accent recolor on select */} strokeOpacity={st.strokeOpacity} strokeWidth={outlineCut ? 0 : rectStrokeW} rx={rx} />);
  if (outlineCut) {
    // NEW-1 — rectOutlineCutSegments returns WORLD feet with el.rot ALREADY BAKED into the corners,
    // but this whole branch renders inside a `rotate(el.rot, c)` group (see the return at the end of
    // renderElPx), so the segments MUST be counter-rotated or the rotation lands twice. At rot 90/270
    // the doubled 540° ≡ 180° redrew a w×h field as h×w about its own centre: stray element-coloured
    // lines projecting out over bare aerial, and — because outlineCut also blanks the plain rect's own
    // stroke above — the field's real edge missing entirely. Same counter-rotate the pond baseline
    // ghost and the stage contours already apply for exactly this reason.
    const segs = rectOutlineCutSegments(el, outlineCut, roadNet.mouths && roadNet.mouths.get(el.id));
    if (segs.length) parts.push(
      <g key="olcut" transform={`rotate(${-(el.rot || 0)} ${c.x} ${c.y})`} data-testid="rect-outline-cut" data-el-id={el.id}>
        {segs.map((seg, i) => (
          <polyline key={`ol${i}`} points={seg.map((q) => { const sp = f2p(q); return `${sp.x},${sp.y}`; }).join(" ")}
            fill="none" stroke={st.stroke} strokeOpacity={st.strokeOpacity} strokeWidth={rectStrokeW} strokeLinecap="butt" pointerEvents="none" />
        ))}
      </g>);
  }
  // Baseline ghost fill (existing basin) sits on top of the added-tint rect; stroke layer added below.
  if (ghostPath) parts.push(<g key="ghostfill" transform={`rotate(${-el.rot} ${c.x} ${c.y})`}><path d={ghostPath} fill={rectExistF} fillOpacity={waterOp} stroke="none" pointerEvents="none" /></g>);
  if (texFill) parts.push(<rect key="tex" x={tl.x} y={tl.y} width={w} height={h} fill={texFill} rx={rx} pointerEvents="none" />);
  // Counter-rotate the baseline ghost: its ring is already in world feet, but this
  // branch's group rotates everything by el.rot — undo that so the ghost lands true.
  if (ghostPath) parts.push(<g key="ghost" transform={`rotate(${-el.rot} ${c.x} ${c.y})`}>{ghostEl("g")}</g>);
  // Stage contours: built from elCorners (world feet, rotation baked in), so counter-rotate
  // this branch's el.rot group — same trick as the ghost — to land them true on the basin.
  if (el.type === "pond") parts.push(<g key="pondc" transform={`rotate(${-(el.rot || 0)} ${c.x} ${c.y})`}>{pondContourEls(el, f2p, ppf, "pc", lf)}</g>);

  /* NEW-2 — GEOMETRY LOD for stall striping. The N per-stall <line>s become the N subpaths of
   * ONE <path>: identical coordinates, identical stroke, same rasteriser, same pass — so the
   * picture is byte-identical and only the node count changes. See the GEOMETRY LEVEL-OF-DETAIL
   * block in lib/labelLayout.js for why this is a change of representation and not decimation,
   * why an SVG <pattern> was tried first and MEASURED as a real (if small) visible shift, and
   * why the gate is on the LABEL frame (px / lfK) so an export decides at the sheet's scale
   * rather than at whatever zoom the canvas happened to be sitting at. */
  /* NEW-1 (B1783376 ×3) — a stall-row band's outline rect starts exactly at the field's FACE, so on a field a drive tees into the row nearest the entrance drew its
   * top edge straight across the drive's mouth. When this field's outline is interrupted (`outlineCut`), each band's outline is interrupted the same way (the pieces
   * are world feet with the rotation baked in, so the group counter-rotates exactly like `rect-outline-cut`); otherwise it is the plain rect, byte for byte. */
  const bandOutline = (key, band, plain) => {
    if (!outlineCut) return plain;
    const chains = rectBandOutlineCutPolylines(el, band, (roadNet.bandCuts && roadNet.bandCuts.get(el.id)) || outlineCut, roadNet.mouths && roadNet.mouths.get(el.id));
    return (
      <g key={`${key}cut`} transform={`rotate(${-(el.rot || 0)} ${c.x} ${c.y})`} data-testid="band-outline-cut" data-el-id={el.id}>
        {chains.map((ch, k) => (
          <polyline key={k} points={ch.map((q) => { const sp = f2p(q); return `${sp.x},${sp.y}`; }).join(" ")} fill="none" stroke={st.stroke} strokeWidth={0.75} strokeLinecap="butt" pointerEvents="none" />
        ))}
      </g>
    );
  };
  if (el.type === "parking") {
    const cs = carStalls(el.w, el.h, cfgOf(el));
    const collapse = !stallStripesExplicit(cs.pitch * ppf, lfK);
    const segs = [];
    /* NEW-1 (road → parking) — the stalls a DRIVE takes (lib/parkingApproach.js: a road crossing a row to reach the aisle, a road crossing the field) are not drawn:
     * each band is drawn as its KEPT runs, every run with its own outline and end walls, dividers only between two kept stalls. With nothing removed this is the
     * whole band as one run — the exact nodes it always drew. */
    const clipSet = roadNet && roadNet.stallClips && roadNet.stallClips.get(el.id) ? roadNet.stallClips.get(el.id).set : null;
    cs.bands.forEach((b, i) => {
      const lean = b.dir * b.slantDx; // angled stalls lean toward their aisle
      const runs = clipSet && clipSet.size ? keptRuns(b.n, clipSet, i) : [{ k0: 0, k1: b.n - 1 }];
      runs.forEach(({ k0, k1 }, ri) => {
        const bandX = k0 * b.pitch, bandW = (k1 - k0 + 1) * b.pitch;
        const key = runs.length === 1 && k0 === 0 ? `b${i}` : `b${i}r${ri}`;
        parts.push(bandOutline(key, { x: bandX, y: b.y, w: bandW, h: b.depth },
          <rect key={key} x={tl.x + bandX * ppf} y={tl.y + b.y * ppf} width={bandW * ppf} height={b.depth * ppf} fill="none" stroke={st.stroke} strokeWidth={0.75} />));
        for (let k = k0 + 1; k <= k1; k++) {
          const x = tl.x + k * b.pitch * ppf;
          const seg = [x, tl.y + b.y * ppf, x + lean * ppf, tl.y + (b.y + b.depth) * ppf];
          if (collapse) segs.push(seg);
          else parts.push(<line key={`b${i}d${k}`} x1={seg[0]} y1={seg[1]} x2={seg[2]} y2={seg[3]} stroke={st.stroke} strokeWidth={0.5} />);
        }
      });
    });
    if (segs.length) parts.push(<path key="bdiv" d={segmentsPath(segs)} fill="none" stroke={st.stroke} strokeWidth={0.5} />);
    cs.aisles.forEach((a, i) =>
      parts.push(<line key={`a${i}`} x1={tl.x} y1={tl.y + (a.y0 + a.y1) / 2 * ppf} x2={tl.x + w} y2={tl.y + (a.y0 + a.y1) / 2 * ppf} stroke={st.stroke} strokeWidth={0.6} strokeDasharray="6 5" />));
  }
  if (el.type === "trailer") {
    const ts = trailerStalls(el.w, el.h, el.cfg ? { ...settings, ...el.cfg } : settings);
    const collapse = !stallStripesExplicit(ts.tw * ppf, lfK);
    const segs = [];
    ts.bands.forEach((b, i) => {
      const bandW = b.n * ts.tw;
      parts.push(bandOutline(`tb${i}`, { x: 0, y: b.y, w: bandW, h: b.depth },
        <rect key={`tb${i}`} x={tl.x} y={tl.y + b.y * ppf} width={bandW * ppf} height={b.depth * ppf} fill="none" stroke={st.stroke} strokeWidth={0.75} />));
      for (let k = 1; k < b.n; k++) {
        const x = tl.x + k * ts.tw * ppf;
        const seg = [x, tl.y + b.y * ppf, x, tl.y + (b.y + b.depth) * ppf];
        if (collapse) segs.push(seg);
        else parts.push(<line key={`tb${i}d${k}`} x1={seg[0]} y1={seg[1]} x2={seg[2]} y2={seg[3]} stroke={st.stroke} strokeWidth={0.55} />);
      }
    });
    if (segs.length) parts.push(<path key="tbdiv" d={segmentsPath(segs)} fill="none" stroke={st.stroke} strokeWidth={0.55} />);
    ts.aisles.forEach((a, i) =>
      parts.push(<line key={`ta${i}`} x1={tl.x} y1={tl.y + (a.y0 + a.y1) / 2 * ppf} x2={tl.x + w} y2={tl.y + (a.y0 + a.y1) / 2 * ppf} stroke={st.stroke} strokeWidth={0.6} strokeDasharray="8 6" />));
  }
  // Derived curbs: thin bands on the terminal / sidewalk-transition edges. Always
  // drawn (their width scales, so a 12" curb visibly doubles a 6" one); the band's
  // stroke keeps it legible when the 0.5′ width is sub-pixel at low zoom.
  (nb ? nb.curbEdges : []).forEach((e, i) => {
    const cpx = e.width * ppf;
    const x = e.axis === "x" ? (e.sign > 0 ? tl.x + w : tl.x - cpx) : tl.x;
    const y = e.axis === "y" ? (e.sign > 0 ? tl.y + h : tl.y - cpx) : tl.y;
    const bw = e.axis === "x" ? cpx : w, bh = e.axis === "y" ? cpx : h;
    // NEW-1 (B1783376 ×3) — a drive's mouth is a CURB CUT: the band is interrupted where the drive meets the field (otherwise its stroke ruled a line across the mouth)
    const mouths = outlineCut && roadNet.mouths ? roadNet.mouths.get(el.id) : null;
    if (!mouths || !mouths.length) {
      parts.push(<rect key={`curb${i}`} x={x} y={y} width={bw} height={bh} fill="#aeb4bd" fillOpacity={0.9} stroke={st.stroke} strokeWidth={0.6} />);
      return;
    }
    curbBandPieces(el, mouths, e.axis, e.sign).forEach(([a, b], k) => {
      const px = e.axis === "y" ? { x: x + a * ppf, width: (b - a) * ppf } : { x, width: bw }, py = e.axis === "x" ? { y: y + a * ppf, height: (b - a) * ppf } : { y, height: bh };
      parts.push(<rect key={`curb${i}p${k}`} data-testid="curb-band-piece" {...px} {...py} fill="#aeb4bd" fillOpacity={0.9} stroke={st.stroke} strokeWidth={0.6} />);
    });
  });
  if (el.type === "building" && (settings.showDocks || settings.showGrid)) {
    // Structural column grid + dock doors (B568/B569). The grid is built in building-LOCAL
    // feet by the pure lib; here we just map its length/depth column-line offsets onto the
    // element's axis-aligned frame (the outer <g> rotation/ppf transform does the rest).
    // Default to "cross" to match dockSidesFor / the Docks <select> / the dock-zone stacks
    // (a dock-less legacy building reads as cross-dock everywhere else). And read the dock
    // side from dockSidesFor — it VALIDATES el.dockSide against the current long axis, so an
    // axis-flipping resize can't desync the grid from footprintAxes below.
    /* NEW-3 — the view-INDEPENDENT half of this block is resolved once per model/settings change
     * (resolveDockPlan, via B1352's neighbour record) instead of once per frame per building. The
     * inline fallback keeps this function total for any caller with no resolved record; it is the
     * identical computation, so the two branches cannot draw different pictures. */
    const dockPlanDogEars = nb ? nb.dogEars : [];
    const plan = (nb && nb.dockPlan) || resolveDockPlan(el, settings, dockPlanDogEars, nb ? nb.ramps : null);
    const { dock, dside: side, dockSides, g, grid, axes: fax } = plan;
    const Dpx = Math.min(8, Math.min(el.w, el.h) * 0.25) * ppf; // dock-apron depth
    const lengthHoriz = fax.length === "w";     // the length axis runs along x
    const depthVert = fax.depth === "h";        // the depth axis runs along y
    const depthMaxFt = depthVert ? el.h : el.w; // = D (ft)
    // Which depth edge is the dock face (offset 0)? cross/none are symmetric → measure from
    // the low edge; a single dock measures inward from its own wall.
    const faceAtZero = dock === "cross" || dock === "none" ? true : (side === "top" || side === "left");
    const depthFt = (d) => (faceAtZero ? d : depthMaxFt - d);

    // ---- Column grid (B568) — drawn for real buildings only (never a dog-ear bump-out),
    // zoom-gated so it reveals when legible and never clutters at site-overview zoom.
    // ⛔ NEW-1 (B1614544) — gated on VIEW SCALE ALONE (buildingGrid.gridLinesVisible(ppf)),
    // NEVER on this building's own on-screen footprint size. The prior gate compared THIS
    // building's rendered `Math.min(w,h)` against a fixed pixel floor (the FEAT_BTN_MIN_PX
    // precedent, B225) — a per-building question, so at one zoom a building whose footprint
    // happened to read large passed while a smaller building right beside it did not ("gridlines
    // show on some buildings but not others at the same zoom" — owner report, reproduced live in
    // ui-audit/verify-grid-view-scale.mjs before this fix). `ppf` is the same number for every
    // building at a given render pass — screen (`ppf`) or sheet (`lfPpf`, so a wide-zoom PDF still
    // draws the same grid a working-zoom PDF of the same plan draws) — so gating on it alone makes
    // the show/hide decision one bit for the WHOLE PLAN, by construction. Do not reintroduce a
    // building-size term here to fix a legibility complaint — pick a different `GRID_MIN_PPF`
    // instead (see that constant's header in buildingGrid.js).
    if (settings.showGrid && !el.dogEar && grid.summary && gridLinesVisible(lfPpf || ppf)) {
      const lineStyle = (role) => role === "flex"
        ? { stroke: GRID_FLEX, strokeWidth: 0.6, strokeDasharray: "5 4", opacity: 0.85 } // end/rear/centre flex boundary
        : { stroke: GRID_LINE, strokeWidth: 0.5, opacity: 0.8 };                     // interior column line (speed bay renders the same — no orange emphasis)
      // Dock wall = the heaviest edge (one per dock face) — the validated dock sides.
      dockSides.forEach((s) => {
        const edge = s === "bottom" ? [tl.x, tl.y + h, tl.x + w, tl.y + h]
          : s === "top" ? [tl.x, tl.y, tl.x + w, tl.y]
          : s === "right" ? [tl.x + w, tl.y, tl.x + w, tl.y + h]
          : [tl.x, tl.y, tl.x, tl.y + h];
        parts.push(<line key={`gw${s}`} x1={edge[0]} y1={edge[1]} x2={edge[2]} y2={edge[3]} stroke={GRID_WALL} strokeWidth={1.6} />);
      });
      grid.lengthLines.forEach((ln, i) => {
        if (lengthHoriz) { const x = tl.x + ln.at * ppf; parts.push(<line key={`gl${i}`} x1={x} y1={tl.y} x2={x} y2={tl.y + h} {...lineStyle(ln.role)} />); }
        else { const y = tl.y + ln.at * ppf; parts.push(<line key={`gl${i}`} x1={tl.x} y1={y} x2={tl.x + w} y2={y} {...lineStyle(ln.role)} />); }
      });
      grid.depthLines.forEach((ln, i) => {
        const d = depthFt(ln.at);
        if (depthVert) { const y = tl.y + d * ppf; parts.push(<line key={`gd${i}`} x1={tl.x} y1={y} x2={tl.x + w} y2={y} {...lineStyle(ln.role)} />); }
        else { const x = tl.x + d * ppf; parts.push(<line key={`gd${i}`} x1={x} y1={tl.y} x2={x} y2={tl.y + h} {...lineStyle(ln.role)} />); }
      });
    }

    // ---- Dock doors (B569) — apron + door leaves placed to sit BETWEEN columns, never
    // straddling a column line. Iterates the VALIDATED dock sides and routes through the
    // shared dockDoorRun helper (the dog-ear skip lives there), so the drawn doors match
    // the panel count exactly. The hardcoded 12′ spacing is now g.doorOC. (The apron rect
    // keeps the data-dock-apron hook added on main for the truck-court / measurement path.)
    if (settings.showDocks && dockSides.length) {
      const leaf = g.doorWidth * ppf;
      dockSides.forEach((s) => {
        // NEW-3 — the door run for this side, resolved with the dock plan above (see resolveDockPlan).
        const { startF, endF, horiz, doors } = plan.runs[s] || dockDoorRun(el, s, dockPlanDogEars, grid.lengthLines.map((l) => l.at), g, rampSpansOnSide(nb ? nb.ramps : null, s, dockSides, settings));
        if (!doors.length) return;
        if (horiz) {
          const by = s === "bottom" ? h - Dpx : 0;
          const ax = tl.x + startF * ppf, aw = (endF - startF) * ppf;
          parts.push(<rect key={`db${s}`} data-dock-apron x={ax} y={tl.y + by} width={aw} height={Dpx} fill="#9aa3b0" fillOpacity={0.9} stroke="#5b6470" strokeWidth={1} />);
        } else {
          const bx = s === "right" ? w - Dpx : 0;
          const ay = tl.y + startF * ppf, ah = (endF - startF) * ppf;
          parts.push(<rect key={`db${s}`} data-dock-apron x={tl.x + bx} y={ay} width={Dpx} height={ah} fill="#9aa3b0" fillOpacity={0.9} stroke="#5b6470" strokeWidth={1} />);
        }
        /* ⛔ NEW-5 — THE DOOR LEAVES STILL DO NOT FOLD, AND THIS IS THE THIRD MEASUREMENT, NOT THE
         * THIRD OPINION. B1350 rejected the fold twice under B1345's byte-identity bar. The owner
         * retired that bar on 2026-08-06 and replaced it with PERCEPTUAL-PARITY (/CLAUDE.md) —
         * "imperceptible at working zoom" — precisely so a difference like this one could be judged
         * on whether he can SEE it rather than on whether the file matches. So the fold was built,
         * armed, and measured again against the NEW bar, on two builds differing only in the gate:
         *
         *   ppf    nodes          perceived ΔE00 (bar 1.0)
         *   0.02   940 → 516      2.188
         *   0.10   976 → 552      1.568
         *   0.35   1213 → 789     1.749      <- working zoom
         *   1.20   1560 → 1332    1.196
         *   3.00   980 → 980      byte-identical (gate off — the control)
         *
         * It recovers exactly the 424 nodes B1350 named, and it FAILS at every armed rung. The
         * reason it fails is the reason PR #921 already established and this run confirms: N
         * 95%-opacity <rect>s each fill-then-stroke, while one <path> fills every subpath and THEN
         * strokes them, and at these zooms a door run is a band of overlapping sub-pixel marks
         * where that ordering is a real change of picture, not an antialiasing seam. Opacity was
         * separately tested and is innocent (both arms opaque: the difference does not move).
         * ⛔ The bar was NOT moved to make this pass. The one modelling parameter the verdict turns
         * on is PERCEIVED_ARCMIN (6 — the half-period at the contrast-sensitivity peak; 12 would
         * roughly halve every number above and this would clear). It was chosen at the strict end
         * BEFORE this was measured and deliberately left alone AFTER. That is an owner call with a
         * price of 424 nodes on it, and it is on B1350 and OWNER-TODO — not a judgement to make
         * here. The mechanism is ready; do not re-derive it, and do not try a fourth time without
         * either that decision or a Chromium that rasterises the two primitives alike. */
        doors.forEach((cF, i) => {
          if (horiz) {
            const by = s === "bottom" ? h - Dpx : 0;
            const x = tl.x + cF * ppf;
            parts.push(<rect key={`dd${s}${i}`} x={x - leaf / 2} y={tl.y + by} width={leaf} height={Dpx} fill="#c2c9d2" fillOpacity={0.95} stroke="#5b6470" strokeWidth={0.6} />);
          } else {
            const bx = s === "right" ? w - Dpx : 0;
            const y = tl.y + cF * ppf;
            parts.push(<rect key={`dd${s}${i}`} x={tl.x + bx} y={y - leaf / 2} width={Dpx} height={leaf} fill="#c2c9d2" fillOpacity={0.95} stroke="#5b6470" strokeWidth={0.6} />);
          }
        });
      });
    }
  }
  if (el.type === "road") { // curb lines inside each long edge; pavement between
    const cp = (el.curb ?? CURB) * ppf, cw = curbStrokePx(el.curb ?? CURB, ppf, CURB_STROKE_MIN_PX * lfK); // B719: curb stripe drawn to scale (true 6")
    if (el.w >= el.h) {
      parts.push(<line key="cu0" x1={tl.x} y1={tl.y + cp} x2={tl.x + w} y2={tl.y + cp} stroke={st.stroke} strokeWidth={cw} />);
      parts.push(<line key="cu1" x1={tl.x} y1={tl.y + h - cp} x2={tl.x + w} y2={tl.y + h - cp} stroke={st.stroke} strokeWidth={cw} />);
    } else {
      parts.push(<line key="cu0" x1={tl.x + cp} y1={tl.y} x2={tl.x + cp} y2={tl.y + h} stroke={st.stroke} strokeWidth={cw} />);
      parts.push(<line key="cu1" x1={tl.x + w - cp} y1={tl.y} x2={tl.x + w - cp} y2={tl.y + h} stroke={st.stroke} strokeWidth={cw} />);
    }
  }
  if ((el.type === "building" || el.type === "paving" || el.type === "road") && !el.points && !el.noLabel) {
    // Dimension line along the short side (depth of a building/truck court, width
    // of a drive/road). A road's callout excludes its 6" curbs (true width − 1′).
    // B121 (round 2): this red dimension layer hides when zoomed out instead of shrinking
    // onto the centred name labels. B149 tiers it: a BUILDING footprint depth is SITE tier
    // (stays on the global dimCalloutVisible zoom gate); a PAVING/ROAD width is DETAIL tier,
    // so it only draws once the measured span projects past DETAIL_LABEL_MIN_PX (~30px) on screen
    // (detailLabelVisible) — a drive-aisle / road width drops at site-overview zoom, reveals on zoom-in.
    const k = dimFontScale(lfPpf || ppf) * lfK; // B911: shared zoom→font scale (building dims + parcel-edge labels); NEW-1: on the LABEL frame so an export sheet sizes it from the paper, not the live zoom
    const fullMin = Math.min(el.w, el.h);
    // B417: a building's depth is read off its dock axis (dockSidesFor → footprintDepth):
    // the footprint span perpendicular to the dock face (dock wall → dock wall / → rear wall),
    // measured on the building ONLY — so a 135′ truck court or any other attached site element
    // can never be reported as the building's depth. (For a rectangle this equals the shorter
    // side, since the dock always rides the long walls; deriving it from the dock axis makes
    // that explicit and robust.) Road = travel width; other strips keep their short-side depth.
    const dimW = el.type === "road" ? roadTravelWidth(el.w, el.h, el.curb ?? (+settings.roadCurb || CURB))
      : el.type === "building" ? footprintDepth(el) : fullMin;
    // B149 tier gate (see comment above): building dims are site-tier; paving/road widths
    // are detail-tier and ride the self-tuning min-on-screen-length rule keyed on the span
    // they actually measure (dimW). Reuses dimCalloutVisible as the shared floor — no new gate.
    const dimVisible = el.type === "building" ? dimCalloutVisible(lfPpf || ppf) : detailLabelVisible(dimW, lfPpf || ppf);
    const RED = "#dc2626", tick = 4 * k, fz = 11 * k, txt = `${f0(dimW)}′`;
    const horizLong = el.w >= el.h;
    // B146/B592: user reposition (local feet → px). Clamp the stored offset to the slide
    // constraint for DISPLAY too — a legacy free-drag offset (off the shape, or carrying a depth
    // component) or one stranded by a later bump-out/resize edit renders back ON the footprint and
    // off the bumps; the next drag then persists the clamped value.
    const dimOff = clampDimOffset(el.dimOffset, nb ? nb.dimSlide : dimSlideFor(el, [el]));
    const ox = dimOff.x * ppf, oy = dimOff.y * ppf;
    const dimSel = isSel && tool === "select"; // interactive (drag/reposition) only when the element is selected
    const isRoad = el.type === "road";
    // B912 — the dimension number is a click target for EVERY building/paving/road (not just roads):
    // single click selects the element (highlighting its measured edge), double-tap opens the inline
    // length editor. Active whenever the select tool is up; pointerEvents="all" so a click on the
    // number selects even before the element is selected (the dim group is pointer-transparent then).
    const numHandlers = (tool === "select" && onDimNumberDown)
      ? { style: { cursor: el.locked ? "pointer" : "text" }, pointerEvents: "all", onPointerDown: (e) => { if (e.button === 0) { e.stopPropagation(); onDimNumberDown(e, el.id); } } }
      : {};
    const dim = [];
    // NEW-1: a road's width dimension anchors to the MIDPOINT of the measured span
    // (centred along the road's length), not 18% in from one end — otherwise the
    // "24′" label drifts toward the left edge instead of sitting on the centreline.
    const posF = el.type === "road" ? DIM_POS_F_ROAD : DIM_POS_F_DEFAULT;
    if (horizLong) { // short side is vertical (h)
      const x = tl.x + w * posF, y0 = tl.y, y1 = tl.y + h, my = (y0 + y1) / 2;
      // B592: no leader line — the dimension slides ALONG the length and stays on the footprint
      // (oy is pinned to 0), so there is never a gap to bridge back to an anchor.
      const X = x + ox, Y0 = y0 + oy, Y1 = y1 + oy, MY = my + oy;
      dim.push(<line key="dl" x1={X} y1={Y0} x2={X} y2={Y1} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t0" x1={X - tick} y1={Y0} x2={X + tick} y2={Y0} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t1" x1={X - tick} y1={Y1} x2={X + tick} y2={Y1} stroke={RED} strokeWidth={1.25} />);
      if (dimSel) dim.push(<line key="grab" data-testid="el-dim-grab" x1={X} y1={Y0} x2={X} y2={Y1} stroke="transparent" strokeWidth={14} />); // fat invisible grab target
      // number OUTBOARD of the line (away from the centred label) so it doesn't clutter by default
      dim.push(<text key="tx" data-testid="el-dim" x={X - 6 * lfK} y={MY} transform={`rotate(${-el.rot} ${X - 6 * lfK} ${MY})`} textAnchor="end" fontSize={fz} fontFamily={NUM_FONT} fontVariantNumeric={TABULAR_NUMS} fill={RED} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" dominantBaseline="middle" fontWeight="600" {...numHandlers}>{txt}</text>);
    } else { // short side is horizontal (w)
      const y = tl.y + h * posF, x0 = tl.x, x1 = tl.x + w, mx = (x0 + x1) / 2;
      // B592: no leader line — the dimension slides ALONG the length and stays on the footprint
      // (ox is pinned to 0 here), so there is never a gap to bridge back to an anchor.
      const Y = y + oy, X0 = x0 + ox, X1 = x1 + ox, MX = mx + ox;
      dim.push(<line key="dl" x1={X0} y1={Y} x2={X1} y2={Y} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t0" x1={X0} y1={Y - tick} x2={X0} y2={Y + tick} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t1" x1={X1} y1={Y - tick} x2={X1} y2={Y + tick} stroke={RED} strokeWidth={1.25} />);
      if (dimSel) dim.push(<line key="grab" data-testid="el-dim-grab" x1={X0} y1={Y} x2={X1} y2={Y} stroke="transparent" strokeWidth={14} />); // fat invisible grab target
      dim.push(<text key="tx" data-testid="el-dim" x={MX} y={Y - 6 * lfK} transform={`rotate(${-el.rot} ${MX} ${Y - 6 * lfK})`} textAnchor="middle" fontSize={fz} fontFamily={NUM_FONT} fontVariantNumeric={TABULAR_NUMS} fill={RED} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" fontWeight="600" {...numHandlers}>{txt}</text>);
    }
    // When the element is selected the dimension is grab-to-move (the red line/ticks are the handle);
    // otherwise it ignores pointers so a click falls through to select/move the element itself.
    // dimVisible (B149) drops a detail-tier paving/road width at site-overview zoom. A SELECTED
    // paving/road keeps its dimension so the click-to-edit / drag-to-reposition handle never
    // vanishes mid-edit; buildings keep their exact prior behaviour (site tier, no select exception).
    // B121 r3: the red dimension draws when its zoom tier is visible AND it isn't collision-suppressed
    // (its number would overprint a higher-priority centred label) — a selected non-building keeps its
    // dimension so the drag/edit handle never vanishes mid-edit. The "Show dimensions" toggle (B121)
    // gates the whole layer. We only HIDE here; B592 keeps the dimension pinned on the footprint.
    if (settings.showDims !== false && ((dimVisible && !dimHidden) || (dimSel && el.type !== "building"))) parts.push(
      <g key="dim" data-el-dim="1" style={dimSel ? { cursor: "move" } : { pointerEvents: "none" }}
        onPointerDown={dimSel ? ((e) => { if (e.button === 0) { e.stopPropagation(); startDimMove(e, el.id); } }) : undefined}>
        {dim}
      </g>,
    );
  }
  // `data-el-id` on the element's own group (NEW-2/NEW-3): a headless harness can measure ONE
  // element's real rendered geometry — the same identifier the junction outline-cut group already
  // carries. Inert markup: no styling, no behaviour, and it rides through the export clone harmlessly.
  return <g key={el.id} data-el-id={el.id} data-feature={`el:${el.id}`} transform={`rotate(${el.rot} ${c.x} ${c.y})`} filter={st.shadow ? "url(#bldgShadow)" : undefined} style={{ cursor: (tool === "select" && !editingCorners) ? (el.locked ? "pointer" : "move") : "crosshair" }}
    onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
    onContextMenu={(e) => { if (onElContext) onElContext(e, el.id); }}>{parts}</g>;
}

/* ---- ElNode — the element pass's RECONCILIATION BOUNDARY (B1352) ----------------------------
 *
 * `renderElPx` was a plain function called from a flat `.map(...)` over the element pass, so React never saw a
 * component type it could bail out on: it received a flat array of host elements with fresh props
 * every render and diffed every one of them. There was no `React.memo` anywhere in `src/`.
 *
 * ⚠ READ THIS BEFORE EXPECTING IT TO SPEED UP A PAN OR A ZOOM — IT DOES NOT, AND THAT IS NOT A BUG.
 * `f2p` is `worldToScreen(view, …)`, so it changes identity whenever `view` changes, and every
 * element's rendered pixel geometry genuinely changes with it. During a pan or a wheel zoom this
 * memo therefore MISSES on every element, by construction — measured, not assumed:
 * ui-audit/diagnose-zoom-cost.mjs reports the same mutation-record count either side of this change
 * for both view gestures. Making those gestures cheap needs the view to stop being baked into every
 * coordinate, which is a representation change to the whole renderer and is filed separately.
 *
 * WHERE IT DOES PAY is every re-render where the VIEW DOES NOT MOVE, which is most of them:
 *   • the cursor readout — `scheduleFrameJob("cursor", …)` fires on EVERY pointermove over the
 *     canvas, so simply sweeping the mouse across a plan re-rendered and re-diffed the whole
 *     element tree at frame rate, with nothing on screen changing but one coordinate chip;
 *   • a selection change (which is why `isSel` is passed instead of the `sel` object — the two
 *     elements that changed re-render, not all of them);
 *   • dragging ONE element (only that element's props change);
 *   • hovers, tool changes, panel toggles, layer toggles, cloud-sync ticks.
 *
 * Two preconditions, both load-bearing and both easy to undo by accident:
 *   1. THE HANDLERS MUST BE IDENTITY-STABLE. They are fresh arrows per render at the call site, so
 *      without `elHandlers` (the latest-ref bundle in the component) this memo never hits at all.
 *   2. THE NEIGHBOUR DEPENDENCY MUST BE MODELLED, NOT DROPPED. `nb` is the resolved record from
 *      `resolveElNeighbors` — see its note. Passing `els` here instead would make the memo compare
 *      an array that changes on every model edit (harmless) OR, worse, tempt someone to key the
 *      memo on `el` alone, which draws stale curbs when a NEIGHBOUR moves.
 */
export const ElNode = memo(function ElNode({ el, f2p, isSel, tool, settings, H, nb, dimHidden, roadNet, lf, editingCorners, roadPass = null }) {
  return renderElPx(el, f2p, isSel, tool, settings, H.startMoveEl, H.onElDouble, nb, H.startDimMove, H.onDimNumberDown, H.onElContext, dimHidden, roadNet, lf, editingCorners, roadPass);
});
