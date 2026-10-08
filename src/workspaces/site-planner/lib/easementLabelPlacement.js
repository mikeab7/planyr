/* NEW-1 (easement labels) — WHERE an easement's name label sits, and how it is turned.
 *
 * Owner report (live planyr.io screenshot): a long, narrow vertical easement "100' Storm/Drainage
 * Esmt" with its "510,172 SF · 11.71 AC" line under it was labelled HORIZONTALLY at the centroid,
 * so the text spilled across the neighbouring parcel line and building. The label now rides the
 * easement's long axis, rotated to match, and is kept upright.
 *
 * Pure and dependency-light so it is unit-tested (test/easementLabelPlacement.test.js) and the SVG
 * render only consumes the answer. Everything is decided in LABEL SPACE (px at `labelPpf`), the same
 * space the existing gate (`featureNameLabelVisible`) decides in; the caller multiplies by `labelK`.
 *
 * WHICH AXIS: a strip easement (mode centerline / parceledge) is oriented along the LONGEST STRAIGHT
 * RUN of its centerline — a bent or L-shaped easement is labelled on its longest leg, not along-path.
 * A drawn boundary easement is oriented along its ring's longest edge. A shape that is not elongated
 * (long/short < ELONGATED_RATIO) keeps the old behaviour exactly: horizontal, at the centroid.
 *
 * UPRIGHT: the angle is folded into [-90, 90) so text is never upside down (a 120° strip reads at -60°).
 *
 * FIT, in order: the name must fit the run's length (the existing rule, now asked of the run along the
 * axis instead of the bbox); the label block must fit the strip WIDTH — shrink the font toward the
 * existing label-size floor (base × DIM_FONT_MIN_SCALE), then drop the area line; only when even the
 * name alone cannot fit at the floor does it keep the floor size and overhang (a label on a ribbon
 * thinner than a line of type has nowhere else to go).
 */
import { featureNameFontPx, featureNameLabelVisible, featureExtentFt, DIM_FONT_MIN_SCALE } from "./labelLayout.js";
import { pointInRing } from "./ringMath.js";

export const ELONGATED_RATIO = 1.5;
export const AREA_FONT_PX = 9;     // the selected-state "SF · AC" line, label-space px (unchanged styling)
export const AREA_DY_PX = 12;      // its baseline offset below the name's baseline (unchanged)
const ASC = 0.75, DESC = 0.25;     // name ascent/descent as a share of its font size
const HALO_PAD_PX = 2;             // the white halo strokes ~1.5px beyond the glyphs

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/* Fold a screen-space bearing (degrees) into [-90, 90). Modulo, not "+180 if > 90": a due-west
 * run is exactly 180° and a plain flip would hand back 360°, still upside down. */
export const uprightDeg = (raw) => (((raw + 90) % 180) + 180) % 180 - 90;

function longestRun(pts) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = dist(pts[i], pts[i + 1]);
    if (!best || len > best.len) best = { i, len, a: pts[i], b: pts[i + 1] };
  }
  return best;
}

function centroidOf(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

/* The oriented frame of an easement: { anchor (feet), a, b (the two feet points whose screen bearing
 * is the angle), lengthFt, widthFt } — or null when it is not elongated / not resolvable, which the
 * caller reads as "label it the old way". */
function orientedFrame(m) {
  const cl = Array.isArray(m.centerline) && m.mode !== "boundary" ? m.centerline : null;
  if (cl && cl.length >= 2 && Number.isFinite(m.width) && m.width > 0) {
    const run = longestRun(cl);
    if (!run || !(run.len > 0)) return null;
    let anchor = { x: (run.a.x + run.b.x) / 2, y: (run.a.y + run.b.y) / 2 };
    let widthFt = m.width;
    if (Number.isFinite(m.leftW) && Number.isFinite(m.rightW)) widthFt = m.leftW + m.rightW;
    if (m.mode === "parceledge") {
      // One-sided strip: ring = [...centerline, ...inner reversed]. The strip's middle at this run
      // is the centre of its four corners; without that pairing, fall back to the old label.
      const ring = m.pts;
      if (!Array.isArray(ring) || ring.length !== cl.length * 2) return null;
      const n = cl.length, i = run.i;
      const i0 = ring[2 * n - 1 - i], i1 = ring[2 * n - 2 - i];
      if (!i0 || !i1) return null;
      anchor = { x: (run.a.x + run.b.x + i0.x + i1.x) / 4, y: (run.a.y + run.b.y + i0.y + i1.y) / 4 };
    } else if (Number.isFinite(m.leftW) && Number.isFinite(m.rightW)) {
      // Asymmetric strip: the middle of the strip is offset from the spine by (left-right)/2; the
      // spine's own side convention is not exposed here, so keep the spine and accept a small bias.
    }
    return { anchor, a: run.a, b: run.b, lengthFt: run.len, widthFt };
  }
  const ring = Array.isArray(m.pts) ? m.pts : null;
  if (!ring || ring.length < 3) return null;
  const edge = longestRun([...ring, ring[0]]);
  if (!edge || !(edge.len > 0)) return null;
  const ux = (edge.b.x - edge.a.x) / edge.len, uy = (edge.b.y - edge.a.y) / edge.len;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of ring) {
    const u = p.x * ux + p.y * uy, v = -p.x * uy + p.y * ux;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  let anchor = { x: uc * ux - vc * uy, y: uc * uy + vc * ux };
  if (!pointInRing(anchor, ring)) {
    anchor = centroidOf(ring);
    if (!pointInRing(anchor, ring)) return null;
  }
  return { anchor, a: edge.a, b: edge.b, lengthFt: u1 - u0, widthFt: v1 - v0 };
}

/**
 * @param m           the easement markup (mode, centerline, pts, width, …)
 * @param text        the name line
 * @param opts.labelPpf  px-per-foot label decisions are made at
 * @param opts.basePx    the label's base size at working zoom (EASE_LABEL_BASE_PX)
 * @param opts.toScreen  feet → screen mapping (so the angle is the on-screen bearing whatever the y-flip)
 * @param opts.withArea  true when the area line will be drawn (selected)
 * @returns null (draw nothing) or
 *   { x, y (feet anchor), angle (deg, upright), fontPx (label-space), nameDy, areaDy, showArea, rotated }
 */
export function placeEasementLabel(m, text, { labelPpf, basePx, toScreen, withArea = false, sheet = false }) {
  const ptsExtent = featureExtentFt(m && m.pts);
  const legacy = () => {
    if (!featureNameLabelVisible(text, ptsExtent, labelPpf, basePx, { sheet })) return null;
    const c = Array.isArray(m.pts) && m.pts.length ? centroidOf(m.pts) : null;
    if (!c) return null;
    return {
      x: c.x, y: c.y, angle: 0, fontPx: featureNameFontPx(labelPpf, basePx),
      nameDy: 0, areaDy: AREA_DY_PX, showArea: withArea, rotated: false,
    };
  };
  const fr = m ? orientedFrame(m) : null;
  if (!fr || !(fr.widthFt > 0) || fr.lengthFt / fr.widthFt < ELONGATED_RATIO) return legacy();

  if (!featureNameLabelVisible(text, fr.lengthFt, labelPpf, basePx, { sheet })) return null;

  const sa = toScreen(fr.a), sb = toScreen(fr.b);
  const angle = uprightDeg((Math.atan2(sb.y - sa.y, sb.x - sa.x) * 180) / Math.PI);

  const stripPx = fr.widthFt * labelPpf - 2 * HALO_PAD_PX;
  const fsRamp = featureNameFontPx(labelPpf, basePx);
  const fsFloor = basePx * DIM_FONT_MIN_SCALE;
  // block height as a function of the name font: name ascent + (optional) area drop + area descent
  const nameOnlyH = (fs) => (ASC + DESC) * fs;
  const withAreaH = (fs) => ASC * fs + AREA_DY_PX + DESC * AREA_FONT_PX;
  const solve = (hOf) => {            // largest font ≤ ramp whose block fits the strip (hOf is linear in fs)
    const h1 = hOf(1), h0 = hOf(0);
    return (stripPx - h0) / (h1 - h0);
  };
  let showArea = false, fs;
  if (withArea) {
    const fit = solve(withAreaH);
    if (fit >= fsFloor) { fs = Math.min(fsRamp, fit); showArea = true; }
  }
  if (!showArea) {
    const fit = solve(nameOnlyH);
    fs = Math.max(fsFloor, Math.min(fsRamp, fit));   // never below the floor; overhang is the last resort
  }
  fs = Math.min(fs, fsRamp);
  // centre the block on the strip's axis (y grows downward in the rotated frame)
  const nameDy = showArea ? (ASC * fs - AREA_DY_PX - DESC * AREA_FONT_PX) / 2 : (ASC - DESC) * fs / 2;
  return { x: fr.anchor.x, y: fr.anchor.y, angle, fontPx: fs, nameDy, areaDy: nameDy + AREA_DY_PX, showArea, rotated: true };
}
