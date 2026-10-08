/* NEW-1/NEW-2 (easement label pull-out) — the pure rules behind an easement label that has been
 * pulled off its strip, and behind the "Show area" toggle.
 *
 * STORED ON THE EASEMENT MARKUP, nothing else, so it saves / syncs / duplicates / undoes with it:
 *   labelPull: { dx, dy, angle }   feet offset of the label centre FROM THE INLINE ANCHOR + screen
 *                                  angle in degrees. Absent = the label is inline on the strip.
 *   showArea:  true                the area line is drawn under the name. Absent / false = name only.
 *
 * WHY AN OFFSET FROM THE ANCHOR, NOT AN ABSOLUTE POINT: the owner's rule is that moving or reshaping
 * the easement carries a pulled-out label with it. The inline anchor is already a function of the
 * easement's geometry (easementLabelPlacement.js), so an offset from it follows every move / reshape
 * for free and nothing has to be re-written when the strip changes.
 *
 * Everything here is decided in feet or LABEL SPACE px (the space easementLabelPlacement decides in)
 * and the caller multiplies by `labelK`, so the PDF clone prints exactly what the screen shows.
 */
import { featureNameLabelVisible, featureNameFontPx, labelTextWidthPx } from "./labelLayout.js";
import { easementLabelFrame, placeEasementLabel, AREA_FONT_PX, AREA_DY_PX } from "./easementLabelPlacement.js";

const ASC = 0.75, DESC = 0.25;
export const LABEL_BOX_PAD_PX = 3;
export const SNAP_TOL_DEG = 4;           // soft snap radius to level / plumb / the strip's own angle
export const LEADER_MIN_PX = 4;          // a leader shorter than this (label space) is not worth drawing

const round2 = (v) => Math.round(v * 100) / 100;

/* Fold any angle into [-180, 180). Upside down (180) is a legitimate stored value — it is NOT folded
 * upright, that is the whole point of a pulled-out label (owner: "do not force it upright"). */
export const normDeg = (a) => (((a + 180) % 360) + 360) % 360 - 180;

/* The pulled-out state of an easement, or null when it is inline (or the stored value is unusable —
 * unusable reads as inline, so a hand-damaged record can never hide its own label). */
export function pullOf(m) {
  const p = m && m.labelPull;
  if (!p || !Number.isFinite(p.dx) || !Number.isFinite(p.dy)) return null;
  return { dx: p.dx, dy: p.dy, angle: Number.isFinite(p.angle) ? normDeg(p.angle) : 0 };
}

export const showAreaOn = (m) => !!(m && m.showArea === true);

export const withPull = (m, { dx, dy, angle }) => ({ ...m, labelPull: { dx: round2(dx), dy: round2(dy), angle: round2(normDeg(angle)) } });
export const withoutPull = (m) => { if (!m || !("labelPull" in m)) return m; const { labelPull: _gone, ...rest } = m; return rest; };

/* Soft snap: near level (0/180), plumb (±90) or the strip's own angle (either direction). Returns
 * { angle, to } — `to` names what it caught ("level" | "plumb" | "strip") or null. */
export function snapLabelAngle(raw, stripDeg, tol = SNAP_TOL_DEG) {
  const a = normDeg(raw);
  const cands = [[0, "level"], [180, "level"], [90, "plumb"], [-90, "plumb"]];
  if (Number.isFinite(stripDeg)) cands.push([normDeg(stripDeg), "strip"], [normDeg(stripDeg + 180), "strip"]);
  let best = null;
  for (const [c, to] of cands) {
    const d = Math.abs(normDeg(a - c));
    if (d <= tol && (!best || d < best.d)) best = { d, angle: c, to };
  }
  return best ? { angle: normDeg(best.angle), to: best.to } : { angle: a, to: null };
}

/* Closest point on a polyline (or closed ring) to p, in feet. */
export function nearestOnPath(pts, p, closed = false) {
  if (!Array.isArray(pts) || !pts.length) return null;
  let best = null;
  const n = closed ? pts.length : pts.length - 1;
  if (n < 1) return { x: pts[0].x, y: pts[0].y, d: Math.hypot(p.x - pts[0].x, p.y - pts[0].y) };
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2)) : 0;
    const q = { x: a.x + t * vx, y: a.y + t * vy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { ...q, d };
  }
  return best;
}

/* Where the leader lands: the nearest point on the easement's centerline (a strip) or its outline
 * (a drawn boundary). */
export function leaderTargetFt(m, from) {
  const strip = Array.isArray(m.centerline) && m.centerline.length >= 2 && m.mode !== "boundary";
  return strip ? nearestOnPath(m.centerline, from, false) : nearestOnPath(m.pts, from, true);
}

/* The name / area block, vertically centred on the label's own origin. */
export function blockLayout(fs, showArea) {
  const nameDy = showArea ? (ASC * fs - AREA_DY_PX - DESC * AREA_FONT_PX) / 2 : (ASC - DESC) * fs / 2;
  const h = showArea ? ASC * fs + AREA_DY_PX + DESC * AREA_FONT_PX : (ASC + DESC) * fs;
  return { nameDy, areaDy: nameDy + AREA_DY_PX, h };
}

/* Leader line from the label's EDGE to the target, in LABEL space (so it rides the label's own
 * rotated, scaled group). null when the target is inside the label box or the line would be a stub. */
export function leaderGeometry({ centre, angleDeg, labelK, halfW, halfH, target }) {
  const th = (angleDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const dx = target.x - centre.x, dy = target.y - centre.y;
  const u = (dx * c + dy * s) / labelK, v = (-dx * s + dy * c) / labelK;
  if (Math.abs(u) <= halfW && Math.abs(v) <= halfH) return null;
  const tu = Math.abs(u) > 1e-9 ? halfW / Math.abs(u) : Infinity;
  const tv = Math.abs(v) > 1e-9 ? halfH / Math.abs(v) : Infinity;
  const t = Math.min(tu, tv);
  const x1 = t * u, y1 = t * v;
  if (Math.hypot(u - x1, v - y1) < LEADER_MIN_PX) return null;
  return { x1, y1, x2: u, y2: v };
}

/**
 * The ONE answer to "where is this easement's label, how big, and does it have a leader" — inline OR
 * pulled out. Render, hit-test, selection outline, the rotate handle and the drag starts all read it.
 * @returns null (draw nothing) or { x, y (feet centre), angle, fontPx, nameDy, areaDy, showArea,
 *   rotated, pulled, halfW, halfH (label-space px), leader, anchor (feet), stripDeg }
 */
export function resolveEasementLabel(m, text, { labelPpf, basePx, toScreen, labelK = 1, areaText = "", sheet = false }) {
  if (!m) return null;
  const wantArea = showAreaOn(m) && !!areaText && labelPpf > 0.05;
  const frame = easementLabelFrame(m, toScreen);
  const pull = pullOf(m);
  const boxOf = (fs, showArea) => {
    const bl = blockLayout(fs, showArea);
    const w = Math.max(labelTextWidthPx(text, fs), showArea ? labelTextWidthPx(areaText, AREA_FONT_PX) : 0);
    return { ...bl, halfW: w / 2 + LABEL_BOX_PAD_PX, halfH: bl.h / 2 + LABEL_BOX_PAD_PX };
  };
  if (!pull) {
    const pl = placeEasementLabel(m, text, { labelPpf, basePx, toScreen, withArea: wantArea, sheet });
    if (!pl) return null;
    const box = boxOf(pl.fontPx, pl.showArea);
    return { ...pl, pulled: false, halfW: box.halfW, halfH: box.halfH, leader: null,
      anchor: frame ? frame.anchor : { x: pl.x, y: pl.y }, stripDeg: frame ? frame.stripDeg : null };
  }
  if (!frame) return null;
  // A pulled-out label is not limited to fitting inside the strip, so only the shared declutter floor
  // (and the sheet's own scale) decides whether it shows — the same floor every name label obeys.
  if (!featureNameLabelVisible(text, 1e9, labelPpf, basePx, { sheet })) return null;
  const fs = featureNameFontPx(labelPpf, basePx);
  const box = boxOf(fs, wantArea);
  const x = frame.anchor.x + pull.dx, y = frame.anchor.y + pull.dy;
  const tgt = leaderTargetFt(m, { x, y });
  let leader = null;
  if (tgt) {
    leader = leaderGeometry({ centre: toScreen({ x, y }), angleDeg: pull.angle, labelK, halfW: box.halfW, halfH: box.halfH, target: toScreen(tgt) });
  }
  return { x, y, angle: pull.angle, fontPx: fs, nameDy: box.nameDy, areaDy: box.areaDy, showArea: wantArea,
    rotated: true, pulled: true, halfW: box.halfW, halfH: box.halfH, leader, anchor: frame.anchor, stripDeg: frame.stripDeg };
}
