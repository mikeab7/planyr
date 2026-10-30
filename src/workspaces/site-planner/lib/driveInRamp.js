/* Drive-in ramp on a dock wall (NEW-1, owner 2026-10-30: "add drive-in ramps as a feature to these [buildings], not necessarily part of
 * the grading … maybe just add another little plus button close by").
 *
 * A dock-high building's floor (FFE) sits one dock height (48 in typical) above the truck-court apron. A DRIVE-IN door is a grade-level overhead
 * door a forklift or truck drives through, so a concrete ramp has to climb from apron grade to the FFE: rise = dock height, grade 6–10 % (8 %
 * common, 10 % the forklift maximum) → a 4-ft rise at 8 % is 50 ft of ramp. Wing walls hold the fill on both long sides; bollards flank the door.
 *
 * MODEL — one building-attached element, the way a dog-ear bump-out is one:
 *     { id, type: "driveInRamp", attachedTo: <building id>, cx, cy, w, h, rot, ramp: { side, at, width, gradePct, riseIn?, layout, dir, door, wings, bollards } }
 *   · `ramp` holds only what the OWNER chose; the box (cx/cy/w/h/rot) is a DERIVED cache of `rampBox(host, ramp)` so hit-testing, the PDF walker, KMZ and
 *     the grading ring all read an ordinary box — it is re-fitted from the host by `refitRamps` at the planner's one element-write seam, so a host that
 *     moves, rotates or resizes carries its ramps with it (and undo/redo, which restore exact geometry, never re-interpret it).
 *   · `riseIn` ABSENT = follow the plan's dock height (`settings.floodMitigation.dockDropFt`, default 4 ft = 48 in — the building has no dock-height
 *     property of its own; the plan-level dock drop IS the number the grading layer already uses). Present = the owner's override.
 *   · `at` = ft from the wall's START (the left end of a top/bottom wall, the top end of a left/right wall — the same axis `dockDoorRun`'s door centres
 *     use) to the CENTRE of the drive-in door. `dir` (+1 / −1) only matters for the along-the-wall layout: which way the ramp runs from its door.
 *
 * WALL FRAME — everything below is computed in (u along the wall from its start, v outward from the wall face) and mapped to the world once, by
 * `wallFrame(host, side).pt(u, v)`. Pure, no React, no imports.
 */

export const RAMP_DEFAULTS = Object.freeze({ widthFt: 16, gradePct: 8, layout: "straight", dir: 1, door: "12x14", wings: true, bollards: true });
export const RAMP_MAX_GRADE_PCT = 10;          // the practical forklift maximum
export const RAMP_MIN_GRADE_PCT = 2;           // below this the length runs away; the input is clamped, never refused
export const RAMP_MIN_WIDTH_FT = 14;           // one lane
export const RAMP_MAX_WIDTH_FT = 40;
export const DOCK_HEIGHT_IN_DEFAULT = 48;
export const RAMP_LAYOUTS = Object.freeze(["straight", "along"]);
export const DOOR_SIZES = Object.freeze({ "12x14": { w: 12, h: 14 }, "14x16": { w: 14, h: 16 } });
/** A dock door whose leaf overlaps the ramp's span by no more than this is a jamb touch, not a conflict. */
export const DOOR_TOUCH_FT = 1;
/** The along-the-wall ramp lands on a square at its high end; a marker (non-dock wall) is a short stub the width of the door. */
export const MARKER_DEPTH_FT = 1.5;
const BOLLARD_SETOFF_FT = 2;                   // a bollard's distance off the door jamb
const BOLLARD_V_FT = 2.5;                      // …and off the wall face

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;
const rad = (d) => (d * Math.PI) / 180;

const SIDES = Object.freeze({
  top: { n: [0, -1], t: [1, 0] }, bottom: { n: [0, 1], t: [1, 0] },
  left: { n: [-1, 0], t: [0, 1] }, right: { n: [1, 0], t: [0, 1] },
});
export const isRampSide = (s) => Object.prototype.hasOwnProperty.call(SIDES, s);

/* ---- the wall frame ------------------------------------------------------------------------------------------------------------------ */
export function wallFrame(host, side) {
  const S = SIDES[side];
  const hw = host.w / 2, hh = host.h / 2;
  const start = side === "top" ? [-hw, -hh] : side === "bottom" ? [-hw, hh] : side === "left" ? [-hw, -hh] : [hw, -hh];
  const L = S.t[0] !== 0 ? host.w : host.h;
  const rotDeg = ((((host.rot || 0) % 360) + 360) % 360);
  const c = Math.cos(rad(rotDeg)), s = Math.sin(rad(rotDeg));
  const pt = (u, v) => {
    const lx = start[0] + S.t[0] * u + S.n[0] * v, ly = start[1] + S.t[1] * u + S.n[1] * v;
    return { x: host.cx + lx * c - ly * s, y: host.cy + lx * s + ly * c };
  };
  // world unit vectors (along the wall, and outward from it)
  const dirOf = (a) => ({ x: a[0] * c - a[1] * s, y: a[0] * s + a[1] * c });
  return { side, L, rotDeg, pt, t: dirOf(S.t), n: dirOf(S.n), horiz: S.t[0] !== 0 };
}

/* ---- the numbers --------------------------------------------------------------------------------------------------------------------- */
/** The plan's dock height in inches: `settings.floodMitigation.dockDropFt` (the one dock-drop number the grading layer reads) × 12, else 48 in. */
export function dockHeightInOf(settings) {
  const ft = settings && settings.floodMitigation ? settings.floodMitigation.dockDropFt : null;
  return Number.isFinite(ft) && ft > 0 ? ft * 12 : DOCK_HEIGHT_IN_DEFAULT;
}
/** The rise in feet: the ramp's own override, else the plan's dock height (in), else 48 in. */
export function rampRiseFt(ramp, dockHeightIn = DOCK_HEIGHT_IN_DEFAULT) {
  const own = num(ramp && ramp.riseIn);
  const inch = own != null && own > 0 ? own : (num(dockHeightIn) != null && dockHeightIn > 0 ? dockHeightIn : DOCK_HEIGHT_IN_DEFAULT);
  return inch / 12;
}
export const rampGradePct = (ramp) => { const g = num(ramp && ramp.gradePct); return g == null || g <= 0 ? RAMP_DEFAULTS.gradePct : g; };
/** length = rise / grade (a 4-ft rise at 8 % = 50 ft). */
export function rampLengthFt(ramp, dockHeightIn) {
  const g = Math.max(RAMP_MIN_GRADE_PCT, rampGradePct(ramp));
  return r2(rampRiseFt(ramp, dockHeightIn) / (g / 100));
}
export const rampWidthFt = (ramp) => clamp(num(ramp && ramp.width) ?? num(ramp && ramp.widthFt) ?? RAMP_DEFAULTS.widthFt, 4, RAMP_MAX_WIDTH_FT);
export const doorSizeOf = (ramp) => DOOR_SIZES[ramp && ramp.door] || DOOR_SIZES[RAMP_DEFAULTS.door];
export const rampLayout = (ramp) => (ramp && ramp.layout === "along" ? "along" : "straight");
export const rampDir = (ramp) => (ramp && ramp.dir === -1 ? -1 : 1);

/** A fresh record's defaults, merged under what the caller chose. */
export function newRampRecord(side, at, over = {}) {
  return { side, at: r2(at), width: RAMP_DEFAULTS.widthFt, gradePct: RAMP_DEFAULTS.gradePct, layout: RAMP_DEFAULTS.layout, dir: RAMP_DEFAULTS.dir,
    door: RAMP_DEFAULTS.door, wings: RAMP_DEFAULTS.wings, bollards: RAMP_DEFAULTS.bollards, ...over };
}

/* ---- the footprint, in the wall frame -------------------------------------------------------------------------------------------------- */
/** `marker` = the wall is not a dock wall (floor at grade there): no ramp, just a door marker. */
export function rampSpan(ramp, { marker = false, dockHeightIn } = {}) {
  const at = num(ramp.at) ?? 0, dw = doorSizeOf(ramp).w;
  if (marker) return { u0: at - dw / 2, u1: at + dw / 2, v0: 0, v1: MARKER_DEPTH_FT, lengthFt: 0, high: "wall" };
  const W = rampWidthFt(ramp), len = rampLengthFt(ramp, dockHeightIn);
  if (rampLayout(ramp) === "along") {
    const dir = rampDir(ramp), highU = at - dir * W / 2;
    return dir > 0 ? { u0: highU, u1: highU + len, v0: 0, v1: W, lengthFt: len, high: "u0" } : { u0: highU - len, u1: highU, v0: 0, v1: W, lengthFt: len, high: "u1" };
  }
  return { u0: at - W / 2, u1: at + W / 2, v0: 0, v1: len, lengthFt: len, high: "v0" };
}

/** The world box (cx, cy, w, h, rot) of the footprint — in the HOST's own axes, so an ordinary rect element. */
export function rampBox(host, ramp, opt = {}) {
  const f = wallFrame(host, ramp.side), sp = rampSpan(ramp, opt);
  const uc = (sp.u0 + sp.u1) / 2, vc = (sp.v0 + sp.v1) / 2, a = sp.u1 - sp.u0, d = sp.v1 - sp.v0;
  const c = f.pt(uc, vc);
  return { cx: c.x, cy: c.y, w: f.horiz ? a : d, h: f.horiz ? d : a, rot: f.rotDeg };
}
export const rampRing = (host, ramp, opt = {}) => {
  const f = wallFrame(host, ramp.side), sp = rampSpan(ramp, opt);
  return [f.pt(sp.u0, sp.v0), f.pt(sp.u1, sp.v0), f.pt(sp.u1, sp.v1), f.pt(sp.u0, sp.v1)];
};

/** Everything the renderer draws, in WORLD feet. One call, so the canvas, the PDF clone and the tests cannot disagree. */
export function rampParts(host, ramp, opt = {}) {
  const { marker = false } = opt;
  const f = wallFrame(host, ramp.side), sp = rampSpan(ramp, opt), at = num(ramp.at) ?? 0, dw = doorSizeOf(ramp).w;
  const ring = [f.pt(sp.u0, sp.v0), f.pt(sp.u1, sp.v0), f.pt(sp.u1, sp.v1), f.pt(sp.u0, sp.v1)];
  // the door: a DOUBLED line on the wall (distinct from a dock door's leaf)
  const door = [[f.pt(at - dw / 2, 0), f.pt(at + dw / 2, 0)], [f.pt(at - dw / 2, 0.9), f.pt(at + dw / 2, 0.9)]];
  const wingsOn = !marker && ramp.wings !== false;
  const wings = wingsOn
    ? (rampLayout(ramp) === "along"
      ? [[f.pt(sp.u0, sp.v1), f.pt(sp.u1, sp.v1)], [f.pt(sp.u0, 0), f.pt(sp.u1, 0)]]
      : [[f.pt(sp.u0, 0), f.pt(sp.u0, sp.v1)], [f.pt(sp.u1, 0), f.pt(sp.u1, sp.v1)]])
    : [];
  const bollards = !marker && ramp.bollards !== false
    ? [f.pt(at - dw / 2 - BOLLARD_SETOFF_FT, BOLLARD_V_FT), f.pt(at + dw / 2 + BOLLARD_SETOFF_FT, BOLLARD_V_FT)] : [];
  // the slope arrow points UP toward the door
  let arrow = null;
  if (!marker) {
    if (rampLayout(ramp) === "along") {
      const hi = sp.high === "u0" ? sp.u0 : sp.u1, lo = sp.high === "u0" ? sp.u1 : sp.u0, vm = (sp.v0 + sp.v1) / 2;
      arrow = { from: f.pt(hi + (lo - hi) * 0.8, vm), to: f.pt(hi + (lo - hi) * 0.2, vm) };
    } else {
      const um = (sp.u0 + sp.u1) / 2;
      arrow = { from: f.pt(um, sp.v1 * 0.8), to: f.pt(um, sp.v1 * 0.2) };
    }
  }
  const centre = f.pt((sp.u0 + sp.u1) / 2, (sp.v0 + sp.v1) / 2);
  const long = rampLayout(ramp) === "along" ? sp.u1 - sp.u0 : sp.v1;
  return { ring, door, wings, bollards, arrow, centre, labelAxisDeg: ((f.horiz ? 0 : 90) + f.rotDeg) % 180, longFt: marker ? sp.u1 - sp.u0 : long,
    labelAlongWall: rampLayout(ramp) === "along" || marker, lengthFt: sp.lengthFt, frame: f, span: sp };
}

/** "DRIVE-IN RAMP · 8% · 16' W" — or the short form when the footprint is too short for the long one at this zoom. */
export const gradeText = (g) => (Math.round(g * 10) / 10).toString();
export function rampLabel(ramp, { short = false, marker = false } = {}) {
  if (marker) return short ? "DRIVE-IN" : "DRIVE-IN DOOR";
  return short ? `RAMP ${gradeText(rampGradePct(ramp))}%` : `DRIVE-IN RAMP · ${gradeText(rampGradePct(ramp))}% · ${Math.round(rampWidthFt(ramp))}' W`;
}

/* ---- door modules + dock-door displacement ----------------------------------------------------------------------------------------------- */
/** The positions a door centre can snap to: every dock-door centre and the midpoint between each pair (a 16-ft ramp centred on a midpoint takes two doors). */
export function moduleStops(doorCenters) {
  const d = (doorCenters || []).filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const out = [];
  d.forEach((v, i) => { out.push(v); if (i + 1 < d.length) out.push((v + d[i + 1]) / 2); });
  return out;
}
/** Snap `want` (ft along the wall) to the nearest module stop; with no doors on the wall it is kept (clamped to the wall by the caller). */
export function snapToModule(doorCenters, want) {
  const stops = moduleStops(doorCenters);
  if (!stops.length) return want;
  let best = stops[0];
  for (const s of stops) if (Math.abs(s - want) < Math.abs(best - want)) best = s;
  return best;
}
/** Which dock doors (by centre offset) the ramp's span takes out of the belt. Pure over the span. */
export function displacedDoors(doorCenters, doorLeafFt, span) {
  if (!span) return [];
  const half = (doorLeafFt || 9) / 2;
  return (doorCenters || []).filter((c) => Math.min(c + half, span.u1) - Math.max(c - half, span.u0) > DOOR_TOUCH_FT);
}
/** The belt spans (u0..u1 along each wall) every ramp of one host takes, keyed by side. A marker (non-dock wall) takes nothing: there is no belt there. */
export function rampBeltSpans(ramps, dockSides, dockHeightIn) {
  const out = {};
  for (const r of ramps || []) {
    const rec = r && (r.ramp || r);
    if (!rec || !isRampSide(rec.side) || !(dockSides || []).includes(rec.side)) continue;
    (out[rec.side] = out[rec.side] || []).push(rampSpan(rec, { dockHeightIn }));
  }
  return out;
}
/** The doors left on one wall after every ramp's span is removed. Identity-stable when no ramp touches the wall. */
export function doorsAfterRamps(doors, doorLeafFt, spans) {
  if (!spans || !spans.length || !doors || !doors.length) return doors;
  const gone = new Set();
  for (const sp of spans) for (const c of displacedDoors(doors, doorLeafFt, sp)) gone.add(c);
  return gone.size ? doors.filter((c) => !gone.has(c)) : doors;
}

/** Turning a ramp ALONG the wall (or flipping which way it runs): keep the footprint ON the wall. Picks the direction toward the NEARER wall end (so the ramp
 *  lies between its door and the corner — the way a side ramp is built) unless the caller names one, then slides the door position into the range that keeps the
 *  whole footprint within the wall, snapped to a door module. Returns the patch { dir, at }; when the wall is too short for the ramp the position is only clamped. */
export function fitAlongTheWall(ramp, { L, stops = [], dockHeightIn, keepDir = null } = {}) {
  const len = rampLengthFt(ramp, dockHeightIn), W = rampWidthFt(ramp), at = num(ramp.at) ?? L / 2;
  const dir = keepDir === 1 || keepDir === -1 ? keepDir : (at <= L / 2 ? -1 : 1);
  const lo = dir > 0 ? W / 2 : len - W / 2, hi = dir > 0 ? L + W / 2 - len : L - W / 2;
  if (!(lo <= hi)) return { dir, at: r2(clamp(at, Math.min(lo, hi), Math.max(lo, hi))) };
  const inRange = (stops || []).filter((v) => v >= lo - 1e-6 && v <= hi + 1e-6);
  const want = clamp(at, lo, hi);
  const snapped = inRange.length ? inRange.reduce((b, v) => (Math.abs(v - want) < Math.abs(b - want) ? v : b), inRange[0]) : want;
  return { dir, at: r2(snapped) };
}

/* ---- flags (the amber style used elsewhere) ------------------------------------------------------------------------------------------------ */
const pointInRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const segsCross = (p, p2, q, q2) => {
  const o = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p, p2, q), d2 = o(p, p2, q2), d3 = o(q, q2, p), d4 = o(q, q2, p2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};
/** Do two rings overlap (more than touch)? `A` is shrunk about its centre by `inset` ft first so a shared edge is not an overlap. */
export function ringsOverlapInset(A, B, inset = 0.5) {
  if (!A || !B || A.length < 3 || B.length < 3) return false;
  const cx = A.reduce((s, p) => s + p.x, 0) / A.length, cy = A.reduce((s, p) => s + p.y, 0) / A.length;
  const a = A.map((p) => { const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1; return { x: p.x - (dx / d) * inset, y: p.y - (dy / d) * inset }; });
  if (a.some((p) => pointInRing(p, B)) || B.some((p) => pointInRing(p, a))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < B.length; j++) if (segsCross(a[i], a[(i + 1) % a.length], B[j], B[(j + 1) % B.length])) return true;
  return false;
}
export const RAMP_FLAG = Object.freeze({ GRADE: "grade", COURT: "court-depth", CROSSES: "crosses", SETBACK: "setback", NON_DOCK: "non-dock", OFF_WALL: "off-wall" });

/** Every validation flag for one ramp. `ctx`: { dockSides, dockHeightIn, courtDepthFt (the truck-court depth in front of the ramp, or null),
 *  others: [{ id, name, ring }] (elements the footprint may not cross — the caller leaves out the host's own dock stack and itself),
 *  allowedRings: [ring] (the area inside the setback; empty = unknown, no check) }. Returns [{ code, text }]. */
export function rampFlags(host, ramp, ctx = {}) {
  const flags = [];
  const dockSides = ctx.dockSides || [];
  const marker = !dockSides.includes(ramp.side);
  if (marker) {
    flags.push({ code: RAMP_FLAG.NON_DOCK, text: "This wall is not a dock wall (the floor is at grade here), so it is only a drive-in door marker — no ramp." });
    return flags;
  }
  const g = rampGradePct(ramp);
  if (g > RAMP_MAX_GRADE_PCT) flags.push({ code: RAMP_FLAG.GRADE, text: `Grade ${gradeText(g)}% is over the ${RAMP_MAX_GRADE_PCT}% forklift maximum.` });
  const sp = rampSpan(ramp, { dockHeightIn: ctx.dockHeightIn });
  if (rampLayout(ramp) === "straight" && num(ctx.courtDepthFt) != null && sp.lengthFt > ctx.courtDepthFt + 0.01)
    flags.push({ code: RAMP_FLAG.COURT, text: `The ramp is ${Math.round(sp.lengthFt)} ft long but the truck court in front of it is ${Math.round(ctx.courtDepthFt)} ft deep.` });
  const f = wallFrame(host, ramp.side);
  if (sp.u0 < -0.01 || sp.u1 > f.L + 0.01) flags.push({ code: RAMP_FLAG.OFF_WALL, text: "The ramp runs past the end of the wall." });
  const ring = rampRing(host, ramp, { dockHeightIn: ctx.dockHeightIn });
  const hit = (ctx.others || []).filter((o) => o && o.ring && ringsOverlapInset(ring, o.ring));
  if (hit.length) flags.push({ code: RAMP_FLAG.CROSSES, text: `The ramp crosses ${hit.slice(0, 2).map((o) => o.name || "another element").join(" and ")}${hit.length > 2 ? ` and ${hit.length - 2} more` : ""}.` });
  const allowed = ctx.allowedRings || [];
  if (allowed.length && ring.some((p) => !allowed.some((r) => pointInRing(p, r)))) flags.push({ code: RAMP_FLAG.SETBACK, text: "The ramp crosses the setback." });
  return flags;
}

/* ---- keeping the box in step with the host ------------------------------------------------------------------------------------------------ */
const same = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6);
/** Re-derive every ramp's box from its host. Returns the SAME array when nothing changed (identity-stable: it runs at the element-write seam).
 *  `dockSidesOf(host)` → the host's dock sides; `dockHeightIn` the plan's dock height. A ramp whose host is gone, or is not a plain rectangle, is left as stored. */
export function refitRamps(els, dockSidesOf, dockHeightIn) {
  if (!Array.isArray(els) || !els.some((e) => e && e.type === "driveInRamp")) return els;
  const byId = new Map(els.map((e) => [e.id, e]));
  let changed = false;
  const next = els.map((e) => {
    if (!e || e.type !== "driveInRamp" || !e.ramp || !isRampSide(e.ramp.side)) return e;
    const host = byId.get(e.attachedTo);
    if (!host || host.type !== "building" || host.points || !Number.isFinite(host.w) || !Number.isFinite(host.h)) return e;
    const marker = !((dockSidesOf ? dockSidesOf(host) : []) || []).includes(e.ramp.side);
    const box = rampBox(host, e.ramp, { marker, dockHeightIn });
    if (same(box.cx, e.cx) && same(box.cy, e.cy) && same(box.w, e.w) && same(box.h, e.h) && same(box.rot, e.rot)) return e;
    changed = true;
    return { ...e, ...box };
  });
  return changed ? next : els;
}

/* ---- grading: the plane ---------------------------------------------------------------------------------------------------------------- */
/** The ramp's centreline in the world: where it meets the apron (LOW), where it meets the door (HIGH), its rise and its run. No elevations — the engine
 *  adds the host's FINISH elevation (typed or suggested) itself, so this is all a prepared element needs to carry. Null for a marker. */
export function rampGeometry(host, ramp, { dockHeightIn, marker = false } = {}) {
  if (marker) return null;
  const sp = rampSpan(ramp, { dockHeightIn });
  if (!(sp.lengthFt > 0)) return null;
  const f = wallFrame(host, ramp.side), rise = rampRiseFt(ramp, dockHeightIn);
  let lowPt, highPt;
  if (rampLayout(ramp) === "along") {
    const vm = (sp.v0 + sp.v1) / 2;
    lowPt = f.pt(sp.high === "u0" ? sp.u1 : sp.u0, vm); highPt = f.pt(sp.high === "u0" ? sp.u0 : sp.u1, vm);
  } else {
    const um = (sp.u0 + sp.u1) / 2;
    lowPt = f.pt(um, sp.v1); highPt = f.pt(um, sp.v0);
  }
  const dx = highPt.x - lowPt.x, dy = highPt.y - lowPt.y, L = Math.hypot(dx, dy) || 1;
  return { lowPt, highPt, axis: { x: dx / L, y: dy / L }, lengthFt: L, riseFt: rise };
}
/** The elevation on the ramp at `p`: apron grade (FFE − rise) at the low end rising evenly to FFE at the door. Contours therefore cross it evenly,
 *  interval / grade apart. */
export function rampZAt(g, ffeFt, p) {
  const t = clamp(((p.x - g.lowPt.x) * g.axis.x + (p.y - g.lowPt.y) * g.axis.y) / g.lengthFt, 0, 1);
  return ffeFt - g.riseFt + g.riseFt * t;
}
export function rampPlane(host, ramp, { ffeFt, dockHeightIn, marker = false } = {}) {
  const g = rampGeometry(host, ramp, { dockHeightIn, marker });
  if (!g || !Number.isFinite(ffeFt)) return null;
  return { ...g, lowElevFt: ffeFt - g.riseFt, highElevFt: ffeFt, zAt: (p) => rampZAt(g, ffeFt, p) };
}
