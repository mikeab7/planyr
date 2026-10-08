/* NEW-4 — the Building panel's LOADING wall picker, as pure functions.
 *
 * The picker is a small plan of the building, turned by its rotation so it matches the canvas, with
 * four clickable walls. This module owns every decision the picker makes so the panel is only a
 * drawing of the answers:
 *   - where each wall, its compass label and the north arrow sit on the little plan
 *     (`wallPickerLayout`) — labels stay UPRIGHT (their positions rotate, the text never does);
 *   - what the loading looks like in words (`loadingTypeLabel` / `loadedWallsLabel`);
 *   - what clicking a wall does (`wallClickPatch`) — loading is always ONE wall or an OPPOSITE PAIR,
 *     never an L and never an end wall pair on top of the dock pair.
 *
 * Compass labels come from `dockSideCompassLabel` (dockZones.js), the single derivation the panel,
 * the selection header and the canvas already share, so the picker cannot disagree with them.
 * No React, no DOM, no host state.
 */
import { dockSidesFor, dockSideCompassLabel, dockSideBearing, compassLabelForBearing } from "./dockZones.js";

export const WALLS = ["top", "right", "bottom", "left"];
export const OPPOSITE_WALL = { top: "bottom", bottom: "top", left: "right", right: "left" };
const AXIS_OF_WALL = { top: "x", bottom: "x", left: "y", right: "y" };
// Outward unit normal of each wall in the building's OWN (unrotated) frame, +y = south/down.
const LOCAL_NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

export const wallAxis = (side) => AXIS_OF_WALL[side];

/* ------------------------------------------------------------------ words */

/** "Cross-dock" | "Single-load" | "No docks" — from what is actually loaded, not the raw field. */
export function loadingTypeLabel(b) {
  const n = dockSidesFor(b || {}).dockSides.length;
  return n >= 2 ? "Cross-dock" : n === 1 ? "Single-load" : "No docks";
}

/** The compass labels of the loaded walls, in wall order (top, bottom / left, right), e.g. ["NE","SW"]. */
export function loadedWallCompass(b) {
  const rot = (b && b.rot) || 0;
  return dockSidesFor(b || {}).dockSides.map((s) => dockSideCompassLabel(s, rot));
}

/** "NE & SW walls" · "SE wall" · "" (nothing loaded). */
export function loadedWallsLabel(b) {
  const labels = loadedWallCompass(b);
  if (!labels.length) return "";
  return `${labels.join(" & ")} ${labels.length > 1 ? "walls" : "wall"}`;
}

/** The header summary's loading fragment: "Cross-dock N/S" · "Single-load SE" · "No docks". */
export function loadingSummary(b) {
  const labels = loadedWallCompass(b);
  const type = loadingTypeLabel(b);
  return labels.length ? `${type} ${labels.join("/")}` : type;
}

/* ------------------------------------------------------------------ clicks */

/**
 * What clicking `side` does to a building's loading. Returns the PATCH to apply to the building
 * (`dock`, `dockAxis`, and `dockSide` for a single-load), or `null` for a nonsense side.
 *
 *   none          click W            → single on W
 *   single on S   click S            → none            (unload)
 *   single on S   click opposite(S)  → cross           (load the other wall too)
 *   single on S   click a wall on the OTHER axis → single on that wall (the whole loading moves)
 *   cross         click a loaded wall → single on the OTHER wall (unload the clicked one)
 *   cross         click a wall on the OTHER axis → cross on the new pair (the whole loading moves)
 *
 * The last two are exactly what `rotateDockAxisPatch` does (turn the dock face a quarter turn), and
 * the result is never an L: a click can never leave two adjacent walls loaded.
 */
export function wallClickPatch(b, side) {
  if (!AXIS_OF_WALL[side]) return null;
  const { dockSides } = dockSidesFor(b || {});
  const axis = AXIS_OF_WALL[side];
  const loaded = dockSides.includes(side);
  if (dockSides.length === 0) return { dock: "single", dockAxis: axis, dockSide: side };
  const curAxis = AXIS_OF_WALL[dockSides[0]];
  if (dockSides.length === 1) {
    const cur = dockSides[0];
    if (loaded) return { dock: "none" };
    if (side === OPPOSITE_WALL[cur]) return { dock: "cross", dockAxis: curAxis };
    return { dock: "single", dockAxis: axis, dockSide: side };
  }
  // cross-dock
  if (loaded) return { dock: "single", dockAxis: curAxis, dockSide: OPPOSITE_WALL[side] };
  return { dock: "cross", dockAxis: axis };
}

/** The building with a wall-click patch applied (pure; for computing the walls a click will leave). */
export const withLoadingPatch = (b, patch) => (patch ? { ...b, ...patch } : b);

/** One sentence naming what a click will do — the wall's tooltip. */
export function wallClickTitle(b, side) {
  const patch = wallClickPatch(b, side);
  if (!patch) return "";
  const rot = (b && b.rot) || 0;
  const name = dockSideCompassLabel(side, rot);
  const before = dockSidesFor(b || {}).dockSides;
  const after = dockSidesFor(withLoadingPatch(b, patch)).dockSides;
  if (before.includes(side) && !after.includes(side)) return `Unload the ${name} wall`;
  if (!before.length) return `Load the ${name} wall`;
  if (after.length > before.length) return `Load the ${name} wall too`;
  return `Move the loading to the ${name} wall${after.length > 1 ? "s" : ""}`;
}

/**
 * The corner bump-outs a loading change leaves STRANDED — those anchored to a wall that is no
 * longer loaded. A building holds at most two bump-outs per loaded wall (one at each end), so
 * dropping a wall drops its bumps; a wall that stays loaded keeps its own untouched.
 * @param bumps  the building's bump-out elements (`{ id, dogEar: { side } }`)
 */
export function strandedBumpIds(bumps, nextSides) {
  const ok = new Set(nextSides || []);
  return (bumps || []).filter((x) => x && x.dogEar && !ok.has(x.dogEar.side)).map((x) => x.id);
}

/** Maximum corner bump-outs a building can carry: two per loaded wall. */
export const bumpOutCap = (b) => dockSidesFor(b || {}).dockSides.length * 2;

/* ------------------------------------------------------------------ the little plan */

const LABEL_W = 14;   // upright compass label box (2-letter, small type)
const LABEL_H = 10;
const LABEL_GAP = 6;  // clear space between a wall and the label's near edge
const ARROW_BOX = (W) => ({ x0: W - 17, y0: 2, x1: W - 2, y1: 21 }); // the fixed north arrow's corner
const MIN_ASPECT = 0.25; // a very long thin building still gets a clickable short wall
const MIN_BUMP_PX = 4;   // a bump-out on a huge building stays a visible, clickable square
const DEFAULT_BUMP = { along: 55, proj: 60 }; // = dogEar.js DOGEAR_W × DOGEAR_D (kept literal: this module stays leaf-light)

const rotPt = (x, y, deg) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [x * c - y * s, x * s + y * c]; // clockwise on screen (y down) — same as SVG rotate()
};

/**
 * Lay out the picker's SVG, in its own `width × height` box. The building is drawn TO SCALE (its
 * Length × Depth aspect, turned by `b.rot`) and every corner bump-out is drawn from the same
 * geometry the canvas uses: at the END of its dock wall, inside the wall's length, projecting OUT past
 * the dock face. Empty corners of each LOADED wall get a dashed footprint (the click target that adds
 * one). Each wall's `clear` segment is the face between its bump-outs — the dock line is drawn on that
 * and nowhere else, so it never runs into a bump-out.
 *
 * @param b  the building ({rot, w, h, …})
 * @param opts.bumps  its existing bump-outs as [{id, side, sign, along, proj}] (feet; absent → 55 × 60)
 * @returns {{
 *   width:number, height:number, cx:number, cy:number, scale:number, k:number,   // k = px per foot
 *   corners:number[][],            // the rotated rectangle, clockwise from its top-left
 *   walls:{side:string, x1:number,y1:number,x2:number,y2:number, lx:number,ly:number,
 *          label:string, bearing:number, clear:{x1:number,y1:number,x2:number,y2:number}}[],
 *   bumps:{key:string, id:string|null, side:string, sign:number, existing:boolean, poly:number[][], cx:number, cy:number}[],
 *   arrow:{x:number,y:number,box:object}
 * }}
 */
export function wallPickerLayout(b, { width = 128, height = 118, bumps = [] } = {}) {
  const rot = ((Number((b && b.rot) || 0) % 360) + 360) % 360;
  const bw = Math.max(1, Number(b && b.w) || 1), bh = Math.max(1, Number(b && b.h) || 1);
  const mx = Math.max(bw, bh);
  const aw = Math.max(MIN_ASPECT, bw / mx), ah = Math.max(MIN_ASPECT, bh / mx);
  const cx = width / 2, cy = height / 2;
  const keep = ARROW_BOX(width);
  const loadedSides = dockSidesFor(b || {}).dockSides;
  const existing = (bumps || []).filter((x) => x && LOCAL_NORMAL[x.side] && (x.sign === 1 || x.sign === -1));

  const build = (R) => {
    const hw = aw * R, hh = ah * R;
    const k = (2 * R) / mx;                                  // px per foot
    const toScreen = (x, y) => { const [rx, ry] = rotPt(x, y, rot); return [cx + rx, cy + ry]; };
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => toScreen(x, y));
    // The bump-out boxes in the building's local frame: along the wall at its end, out past the face.
    const bumpBox = (side, sign, along, proj) => {
      const horiz = side === "top" || side === "bottom";
      const wallPx = horiz ? hw * 2 : hh * 2;
      const a = Math.max(MIN_BUMP_PX, Math.min(wallPx, (Number(along) > 0 ? Number(along) : DEFAULT_BUMP.along) * k));
      const p = Math.max(MIN_BUMP_PX, (Number(proj) > 0 ? Number(proj) : DEFAULT_BUMP.proj) * k);
      const [nx, ny] = LOCAL_NORMAL[side];
      let pts;
      if (horiz) {
        const x0 = sign < 0 ? -hw : hw - a, x1 = sign < 0 ? -hw + a : hw;
        const y0 = ny < 0 ? -hh - p : hh, y1 = ny < 0 ? -hh : hh + p;
        pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      } else {
        const y0 = sign < 0 ? -hh : hh - a, y1 = sign < 0 ? -hh + a : hh;
        const x0 = nx < 0 ? -hw - p : hw, x1 = nx < 0 ? -hw : hw + p;
        pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      }
      return { a, p, local: pts, poly: pts.map(([x, y]) => toScreen(x, y)) };
    };
    const have = new Set(existing.map((x) => `${x.side}${x.sign}`));
    const sizeOnSide = (side) => existing.find((x) => x.side === side) || DEFAULT_BUMP;
    const bumpList = [
      ...existing.map((x) => ({ key: `${x.side}${x.sign}`, id: x.id || null, side: x.side, sign: x.sign, existing: true, ...bumpBox(x.side, x.sign, x.along, x.proj) })),
      ...loadedSides.flatMap((side) => [-1, 1].filter((sign) => !have.has(`${side}${sign}`)).map((sign) => {
        const sz = sizeOnSide(side);
        return { key: `${side}${sign}`, id: null, side, sign, existing: false, ...bumpBox(side, sign, sz.along, sz.proj) };
      })),
    ].map((x) => ({ ...x, cx: x.poly.reduce((s, p) => s + p[0], 0) / 4, cy: x.poly.reduce((s, p) => s + p[1], 0) / 4 }));
    const walls = WALLS.map((side) => {
      const [nx0, ny0] = LOCAL_NORMAL[side];
      const horiz = ny0 !== 0;
      const half = horiz ? hh : hw;                           // half-extent along this wall's normal
      const halfLen = horiz ? hw : hh;                        // half the wall's own length
      // The wall's end points, and the CLEAR face between the bump-outs on it (butt-capped by the caller).
      const edge = (t0, t1) => (horiz ? [[t0, ny0 * hh], [t1, ny0 * hh]] : [[nx0 * hw, t0], [nx0 * hw, t1]]);
      const startBump = bumpList.find((x) => x.existing && x.side === side && x.sign < 0);
      const endBump = bumpList.find((x) => x.existing && x.side === side && x.sign > 0);
      const t0 = -halfLen + (startBump ? startBump.a : 0), t1 = halfLen - (endBump ? endBump.a : 0);
      const [a, bb] = edge(-halfLen, halfLen).map(([x, y]) => toScreen(x, y));
      const [c0, c1] = edge(Math.min(t0, t1), Math.max(t0, t1)).map(([x, y]) => toScreen(x, y));
      const [nx, ny] = rotPt(nx0, ny0, rot);                  // the outward normal on screen
      const extent = Math.abs(nx) * LABEL_W / 2 + Math.abs(ny) * LABEL_H / 2; // box half-size along the normal
      // A bump-out (existing or the dashed one) that leaves less than a label's width of bare wall pushes the label past it.
      const sideBumps = bumpList.filter((x) => x.side === side);
      const crowded = sideBumps.length && (halfLen * 2 - sideBumps.reduce((s, x) => s + x.a, 0)) < LABEL_W + 4;
      const off = half + LABEL_GAP + extent + (crowded ? Math.max(...sideBumps.map((x) => x.p)) : 0); // label CENTRE distance from the building centre
      return {
        side, x1: a[0], y1: a[1], x2: bb[0], y2: bb[1],
        clear: { x1: c0[0], y1: c0[1], x2: c1[0], y2: c1[1] },
        lx: cx + nx * off, ly: cy + ny * off,
        label: dockSideCompassLabel(side, rot), bearing: dockSideBearing(side, rot),
      };
    });
    return { corners, walls, bumps: bumpList, k };
  };
  const fits = ({ corners, walls, bumps: bl }) => {
    const inside = (x, y) => x >= 2 && x <= width - 2 && y >= 2 && y <= height - 2;
    if (!corners.every(([x, y]) => inside(x, y))) return false;
    if (!bl.every((x) => x.poly.every(([px, py]) => inside(px, py)))) return false;
    return walls.every((w) => {
      const x0 = w.lx - LABEL_W / 2, x1 = w.lx + LABEL_W / 2, y0 = w.ly - LABEL_H / 2, y1 = w.ly + LABEL_H / 2;
      if (!inside(x0, y0) || !inside(x1, y1)) return false;
      return x1 < keep.x0 || x0 > keep.x1 || y1 < keep.y0 || y0 > keep.y1; // clear of the north arrow
    });
  };
  let R = 46, laid = build(R);
  while (R > 8 && !fits(laid)) { R -= 1; laid = build(R); }
  return { width, height, cx, cy, scale: R, k: laid.k, corners: laid.corners, walls: laid.walls, bumps: laid.bumps, arrow: { x: (keep.x0 + keep.x1) / 2, y: (keep.y0 + keep.y1) / 2, box: keep } };
}

export { compassLabelForBearing };
