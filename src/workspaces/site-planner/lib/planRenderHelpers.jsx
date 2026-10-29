/* Render helpers shared by the planner component (SitePlanner.jsx) and the element renderer extracted from it
 * (components/elementRender.jsx) — B1064 step 1. Moved verbatim; the SAME function objects serve both callers. @planner-extract */

export const POND_ADD_FILL_DEFAULT = "#A7D3DD"; // B157: default "added area" fill — a lighter tint of the cartographic teal pond, distinct from the existing basin
// Structural column-grid drawing (B568/B569). Subtle gray for the column lines (drafting
// grid, explicitly allowed a subtle gray by the theme rule) — proven legible on both the
// light paper and the dark canvas, like the existing dock-apron literals. The speed-bay
// line renders the same subtle gray as the other interior column lines (owner: no orange
// emphasis) — so it reads as one uniform structural grid, not a highlighted bay.
export const GRID_LINE = "#6b7480";       // interior column line (solid 0.5px) — also the speed-bay line
export const GRID_FLEX = "#6b7480";       // end/rear/centre flex boundary (dashed)
export const GRID_WALL = "#4a525e";       // dock wall — the heaviest edge
// B719 — a road's curb/edge line represents a real 6" curb, drawn TO SCALE (curbFt × ppf),
// not a fixed pixel stroke. This floor keeps the line visible when 6" goes sub-pixel at
// overview zoom; there is deliberately NO ceiling (a 6" curb reads thicker as you zoom in).
export const CURB_STROKE_MIN_PX = 0.75;
export const centroid = (pts) => {
  let x = 0, y = 0;
  pts.forEach((p) => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
};
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// B620 — inline labels that ride ALONG a line/polyline/road/easement (e.g. "18\" SANITARY SEWER"
// sitting on the line). The label REPEATS along the path at a per-feature spacing (feet): a utility
// line is small and wants MANY references, a road is big and wants FAR FEWER, an easement is in
// between (owner rule, 2026-07-02). Spacing is tunable.
export const INLINE_LABEL_SPACING = { line: 150, polyline: 150, easement: 350, road: 700 };
// Repeat placements along a feet-space OPEN path every `spacingFt` (always ≥1, centered, when the
// path is shorter than the spacing). Returns SCREEN anchors with an auto-flipped rotation (never
// upside-down) + a perpendicular offset to the visual "up" side + the segment's on-screen px length
// (for the fit/LOD gate). Mirrors the centerline dir/nrm walk + the strip-label flip math.
// B935 — when `interiorScreen` (a projected point) is given, the perpendicular offset aims TOWARD it
// (into a closed easement ring's body) instead of the screen-"up" side, so an "Inside" label tucks
// within the boundary rather than riding on top of it.
function inlineLabelPlaces(ptsFeet, spacingFt, offsetPx, f2p, interiorScreen) {
  if (!ptsFeet || ptsFeet.length < 2) return [];
  const segs = []; let total = 0;
  for (let i = 1; i < ptsFeet.length; i++) {
    const L = dist(ptsFeet[i - 1], ptsFeet[i]);
    if (L > 0) { segs.push({ a: ptsFeet[i - 1], b: ptsFeet[i], L, s0: total }); total += L; }
  }
  if (total < 1e-3 || !segs.length) return [];
  const sp = Math.max(1, spacingFt), positions = [];
  if (total <= sp) positions.push(total / 2);
  else for (let d = sp / 2; d < total; d += sp) positions.push(d);
  const out = [];
  for (const d of positions) {
    let seg = segs[segs.length - 1];
    for (const s of segs) { if (d <= s.s0 + s.L) { seg = s; break; } }
    const t = seg.L > 0 ? (d - seg.s0) / seg.L : 0;
    const pf = { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
    const A = f2p(seg.a), B = f2p(seg.b), P = f2p(pf);
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / len, y: dy / len };
    let ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
    ang = ((ang % 180) + 180) % 180; if (ang > 90) ang -= 180;      // never upside-down → [-90,90]
    let nrm = { x: -dir.y, y: dir.x };                              // perpendicular
    if (interiorScreen) {                                          // B935 — aim into the feature's body (closed ring → centroid)
      const tx = interiorScreen.x - P.x, ty = interiorScreen.y - P.y;
      if (nrm.x * tx + nrm.y * ty < 0) nrm = { x: -nrm.x, y: -nrm.y };
    } else if (nrm.y > 0) nrm = { x: -nrm.x, y: -nrm.y };           // force screen-"up" (y grows down)
    else if (nrm.y === 0 && nrm.x < 0) nrm = { x: 1, y: 0 };        // vertical → one consistent side
    out.push({ x: P.x + nrm.x * offsetPx, y: P.y + nrm.y * offsetPx, angle: ang, segLenPx: len });
  }
  return out;
}
// Render the repeating inline-label <text> nodes for a feature. Pure + module-level so BOTH the
// component markup render AND renderElPx (a module fn) share it. Own color + white halo, gentle
// zoom-clamped font, LOD-gated per instance, and NO data-export="skip" (so it lands in PNG/PDF).
// B678 — `opts` carries the per-feature label style overrides: { size } (base font px, default 11),
// { halo } (white background/outline on|off, default on). Spacing is the caller's `spacingFt`, which
// is the per-feature `labelSpacing` when set, else the per-type default. A screen-space minimum gap
// keeps restamps from crushing together when zoomed out (self-thins BEFORE the user touches a knob),
// mirroring the dimCalloutVisible / label-collision level-of-detail patterns.
export function inlineLabelEls(ptsFeet, text, color, spacingFt, ppf, f2p, keyPrefix, opts) {
  const label = (text || "").trim();
  if (!label || !ptsFeet || ptsFeet.length < 2) return [];
  const baseSize = (opts && Number.isFinite(opts.size) && opts.size > 0) ? opts.size : 11; // default matches the pre-B678 look
  const halo = !(opts && opts.halo === false);                     // background on by default (existing lines unchanged)
  // NEW-1 (V481(f)) — the LABEL frame: `lf.ppf` is the zoom this label tier reasons at (the
  // view on screen, the SHEET on an export pass) and `lf.k` converts a label px back into a
  // canvas px. Everything else here stays on the real `ppf` because it is world geometry
  // (the feet inset, the spacing→feet conversion) — and because minSegPx / minGapPx are both
  // proportional to `fs`, they self-scale and the thinning becomes view-independent too.
  const lfPpf = (opts && opts.lf && opts.lf.ppf > 0) ? opts.lf.ppf : ppf;
  const lfK = (opts && opts.lf && opts.lf.k > 0) ? opts.lf.k : 1;
  const k = Math.max(0.34, Math.min(1, lfPpf / 0.45));             // gentle, capped at 1 (matches the road-dim clamp)
  // The halo is authored in LABEL space (no lfK): the export's physical stroke retarget
  // rewrites it from the AUTHORED number, so scaling it here would make that retarget's
  // clamp land differently per zoom. The FONT does carry lfK — it isn't retargeted.
  const fsL = baseSize * k, fs = fsL * lfK, haloW = Math.max(2, fsL * 0.3);
  // B935 — "Inside" placement: push the label perpendicular into the body of the road/easement by a
  // per-feature FEET inset (so it scales with zoom and stays within the band), on top of the base
  // font clearance. `interiorFeet` (a closed easement ring's centroid) aims that push toward the
  // interior; without it (roads / strip easements) it rides the consistent screen-"up" side. Zero
  // inset = the classic on-the-line ride, byte-for-byte unchanged.
  const insetFt = (opts && Number.isFinite(opts.insetFt) && opts.insetFt > 0) ? opts.insetFt : 0;
  // NEW-9 — placement is a THREE-way choice, not a toggle (owner, 2026-07-25: "I'd like an option to
  // put it on the center line… that's what I thought this would do, but it's not putting it there").
  // The old pair was "just off the stroke" and "inside the body"; NEITHER rides the line itself, which
  // is the classic street-name look and the one he expected.
  //   center — offset ZERO: the text sits ON the alignment, its halo carrying it over the stroke.
  //   off    — a ~1-font perpendicular clearance so it sits just beside the stroke (the old default).
  //   inside — the feet inset ALONE (a midway-into-the-body distance that scales with zoom); it
  //            already clears the line, and stacking the font clearance on top could shove a narrow
  //            feature's label past its own edge.
  const place = (opts && opts.place) || (insetFt > 0 ? "inside" : "off");
  const offsetPx = place === "center" ? 0 : (place === "inside" && insetFt > 0 ? insetFt * Math.max(ppf, 0) : fs * 1.05);
  const interiorScreen = (opts && opts.interiorFeet) ? f2p(opts.interiorFeet) : null;
  const minSegPx = label.length * fs * 0.6;                        // LOD: the on-screen segment must fit the text (CW_RATIO 0.6)
  // B678 — screen-space self-thinning is an ANTI-OVERLAP floor, nothing more: keep restamps at least
  // the label's own on-screen width + ~50% breathing room apart (`len·fs·0.9` ≈ width·1.5), converted
  // back to feet at the live zoom, and take the LOOSER of it and the requested feet-spacing. So a SHORT
  // label (whose width is < the feet-spacing on screen) keeps its exact per-type/typed spacing — only a
  // label that would physically OVERLAP is thinned, and it self-thins further on zoom-out. Deliberately
  // NOT a large fixed floor: a flat floor would dominate every normal zoom and make the spacing control
  // inert. (minSegPx already hides an instance whose own segment can't fit the text.)
  const minGapPx = label.length * fs * 0.85;  // B682 — just above the label's real rendered width (all-caps Inter ≈ 0.78/char), so it ONLY prevents literal overlap and the spacing control stays responsive across the rest of its range (the live slider is the main responsiveness fix)
  const effSpacingFt = Math.max(Math.max(1, spacingFt || 0), minGapPx / Math.max(ppf, 1e-4));
  const out = [];
  inlineLabelPlaces(ptsFeet, effSpacingFt, offsetPx, f2p, interiorScreen).forEach((pl, i) => {
    if (pl.segLenPx < minSegPx) return;
    out.push(
      <text key={`${keyPrefix}${i}`} x={pl.x} y={pl.y} textAnchor="middle" dominantBaseline="middle"
        transform={`rotate(${pl.angle} ${pl.x} ${pl.y})`}
        fontFamily="Inter, system-ui, sans-serif" fontSize={fs} fill={color} pointerEvents="none"
        style={{ fontWeight: 600, ...(halo ? { paintOrder: "stroke", stroke: "#fff", strokeWidth: haloW } : null) }}>{label}</text>,
    );
  });
  return out;
}
/* NEW-9 — where a feature's repeating inline label rides, resolved once for every caller.
 * "center" | "off" | "inside". Back-compatible by construction: a record saved before this existed
 * carries only the old `labelInside` boolean, which maps to "inside"/"off" exactly as it rendered. */
export function labelPlaceOf(feat) {
  const p = feat && feat.labelPlace;
  if (p === "center" || p === "off" || p === "inside") return p;
  return feat && feat.labelInside ? "inside" : "off";
}
// The plan-view span of a drawn ring, in feet. Five label/LOD call sites had grown their own
// copy of this loop (three as inline IIFEs); one derivation is both smaller and one thing to fix.
export const ringSpanFt = (pts) => {
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (const p of pts) { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; if (p.y < lo2) lo2 = p.y; if (p.y > hi2) hi2 = p.y; }
  return { w: hi - lo, h: hi2 - lo2 };
};
// …and its SHORT plan dimension, which is what every zoom/LOD gate keys off.
export const ringMinSpanFt = (pts) => { const s = ringSpanFt(pts); return Math.min(s.w, s.h); };
