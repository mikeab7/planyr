/* WHERE a selected building's edit buttons sit (NEW-5, owner 2026-10-30: "the grey ramp buttons sit exactly on top of the grading corner tags").
 *
 * THE RULE, by construction rather than by nudging: every edit button — the purple corner "+", the dock "+ / −" pair, the green "+ / −" pair, the grey
 * ramp "+" — sits OUTSIDE the building's footprint, offset perpendicular from its wall into the court, in ONE row along that wall with a fixed gap. The
 * grading corner tags sit INSIDE the footprint (lib/padCornerTag.js), so the two sets lie on opposite sides of every wall line and cannot intersect at any
 * zoom. This file is the one place the buttons' positions are decided: SitePlanner's `sideAddNodes` reads its answer, and the tests read the very same one.
 *
 * ONE ROW PER WALL, in this order along the wall (a button is dropped, never moved, when it would touch one already placed):
 *   1  the "+ / −" pair, centred on the wall's middle (both halves reserved, whichever are drawn)
 *   2  the purple corner "+" at each end of a DOCK wall (the bump-out toggle)
 *   3  ONE grey ramp "+" per dock wall, beside the pair
 *   4  ONE grey ramp "+" per corner "+", beside it, toward the middle
 * A non-dock wall carries only its pair: a drive-in ramp is a dock-wall feature, so there is no ramp button on a short end wall.
 *
 * Pure, screen px, no React. `wall.out` is the unit vector from the building's centre toward the wall; `tan = (−out.y, out.x)` runs along it (the same
 * direction the pair's "+" / "−" have always been laid out in).
 */
import { FEAT_CTRL_R, FEAT_CTRL_STROKE } from "./featureEditZoom.js";

export const RAMP_BTN_R = FEAT_CTRL_R * 0.78;                 // the ramp "+" is a little smaller than the others
export const BTN_OUT_PX = FEAT_CTRL_R + 5.5;                  // a button's centre sits this far OUTSIDE the wall line (its inner edge clears the line)
export const SIDE_PAIR_GAP = FEAT_CTRL_R + 3;                 // the pair's two discs this far either side of the wall's middle
export const CORNER_END_PX = FEAT_CTRL_R + 2;                 // the purple disc's centre this far in from the wall's end, along the wall
export const BTN_GAP_PX = 3;                                  // the air kept between two neighbouring discs (keylines included)
const KEYLINE = FEAT_CTRL_STROKE / 2;
/** With nothing selected the buttons show for the building under the cursor — and they sit OUTSIDE its walls, so a building that is already
 *  hovered stays hovered this far (px) beyond its footprint, or the buttons would vanish the moment the pointer set out toward one. */
export const HOVER_BUTTON_REACH_PX = BTN_OUT_PX + FEAT_CTRL_R + KEYLINE + 8;

const unit = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; };
const R_OF = (r) => r + KEYLINE;                              // a disc's painted radius, keyline included
const RAMP_STEP_PX = R_OF(FEAT_CTRL_R) + BTN_GAP_PX + R_OF(RAMP_BTN_R) + 1;   // centre-to-centre from a standard disc to the ramp disc beside it, with the gap kept
/** The building's rotate grip (a 6 px circle on a stem above the top wall) now has the top wall's button row between it and the wall, so it rides this far
 *  out (centre) — past the row's outer edge, the gap and its own radius — instead of the old 26 px that sat on the pair's middle disc. */
export const ROTATE_GRIP_R_PX = 6.75;                                          // the grip's radius with its keyline
export const ROTATE_GRIP_OFFSET_PX = Math.ceil(BTN_OUT_PX + R_OF(FEAT_CTRL_R) + BTN_GAP_PX + ROTATE_GRIP_R_PX);
const touches = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + BTN_GAP_PX;

/**
 * @param {{name:string, mid:{x,y}, out:{x,y}, dock:boolean, corners?:{sign:number, pt:{x,y}}[]}[]} walls
 *   `corners` (dock walls only): the wall's two ends, `sign` −1 / +1 as `dogEar.sign` reads them, `pt` the corner in screen px.
 * @returns {Map<string, object>} id → placement. ids: `pair:<wall>` { pos, tan, discs:[{x,y,r}×2] } · `corner:<wall>:<sign>` { x, y, r } ·
 *   `ramp:<wall>` { x, y, r } · `ramp:<wall>:<sign>` { x, y, r }. A button that does not fit is simply absent.
 */
export function layoutBuildingButtons(walls) {
  const out = new Map(), placed = [];
  const free = (d) => !placed.some((p) => touches(p, d));
  const put = (id, entry, discs) => { out.set(id, entry); placed.push(...discs); };
  const geo = walls.map((w) => {
    const tan = { x: -w.out.y, y: w.out.x };
    const base = { x: w.mid.x + w.out.x * BTN_OUT_PX, y: w.mid.y + w.out.y * BTN_OUT_PX };   // the row's origin: the wall's middle, pushed outward
    const at = (t, r) => ({ x: base.x + tan.x * t, y: base.y + tan.y * t, r: R_OF(r) });
    return { w, tan, base, at };
  });
  // 1 — the pair (always: it is the existing control)
  for (const g of geo) {
    const a = g.at(-SIDE_PAIR_GAP, FEAT_CTRL_R), b = g.at(SIDE_PAIR_GAP, FEAT_CTRL_R);
    put(`pair:${g.w.name}`, { pos: { x: g.base.x, y: g.base.y }, tan: g.tan, discs: [a, b] }, [a, b]);
  }
  // 2 — the purple corner "+" at each end of a dock wall
  const cornerT = (g, c) => {
    const t = (c.pt.x - g.w.mid.x) * g.tan.x + (c.pt.y - g.w.mid.y) * g.tan.y;     // signed position of the corner along the row
    return { t, tc: t - Math.sign(t || 1) * CORNER_END_PX };
  };
  for (const g of geo) if (g.w.dock) for (const c of g.w.corners || []) {
    const { tc } = cornerT(g, c), d = g.at(tc, FEAT_CTRL_R);
    if (free(d)) put(`corner:${g.w.name}:${c.sign}`, { x: d.x, y: d.y, r: d.r }, [d]);
  }
  // 3 — one grey ramp "+" per dock wall, beside the pair (on its +tan side)
  for (const g of geo) if (g.w.dock) {
    const d = g.at(SIDE_PAIR_GAP + RAMP_STEP_PX, RAMP_BTN_R);
    if (free(d)) put(`ramp:${g.w.name}`, { x: d.x, y: d.y, r: d.r }, [d]);
  }
  // 4 — one grey ramp "+" per corner "+", beside it, toward the wall's middle
  for (const g of geo) if (g.w.dock) for (const c of g.w.corners || []) {
    if (!out.has(`corner:${g.w.name}:${c.sign}`)) continue;
    const { t, tc } = cornerT(g, c), d = g.at(tc - Math.sign(t || 1) * RAMP_STEP_PX, RAMP_BTN_R);
    if (free(d)) put(`ramp:${g.w.name}:${c.sign}`, { x: d.x, y: d.y, r: d.r }, [d]);
  }
  return out;
}

/** Every painted disc of a layout, flat (the pair's two halves included) — what a test intersects a tag box with. */
export function layoutDiscs(layout) {
  const all = [];
  for (const [id, e] of layout) { if (e.discs) e.discs.forEach((d) => all.push({ ...d, id })); else all.push({ x: e.x, y: e.y, r: e.r, id }); }
  return all;
}

/**
 * The walls of a rectangular building from its four screen corners in ring order [top-left, top-right, bottom-right, bottom-left] (the building's own
 * axes, so a rotated building keeps its names): top = TL→TR, right = TR→BR, bottom = BL→BR, left = TL→BL. `sign` −1 is a wall's start (the left end of
 * top / bottom, the top end of left / right) — the same ends `dogEar.sign` names.
 * @param {{x:number,y:number}[]} quad
 * @param {string[]} dockSides the walls that carry docks
 */
export function wallsFromQuad(quad, dockSides = []) {
  const [tl, tr, br, bl] = quad;
  const c = { x: (tl.x + tr.x + br.x + bl.x) / 4, y: (tl.y + tr.y + br.y + bl.y) / 4 };
  const wall = (name, a, b) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { name, mid, out: unit(mid.x - c.x, mid.y - c.y), dock: dockSides.includes(name), corners: [{ sign: -1, pt: a }, { sign: 1, pt: b }] };
  };
  return [wall("top", tl, tr), wall("bottom", bl, br), wall("left", tl, bl), wall("right", tr, br)];
}

/** Does a disc come within `pad` of the footprint (a convex quad)? A button must NOT — it lives outside the walls. */
export function discTouchesQuad(d, quad, pad = 0) {
  const c = { x: quad.reduce((s, p) => s + p.x, 0) / quad.length, y: quad.reduce((s, p) => s + p.y, 0) / quad.length };
  let inside = true, minD = Infinity;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length], ex = b.x - a.x, ey = b.y - a.y, L = Math.hypot(ex, ey) || 1;
    let nx = -ey / L, ny = ex / L;
    if (nx * (c.x - a.x) + ny * (c.y - a.y) < 0) { nx = -nx; ny = -ny; }          // inward normal
    const sd = nx * (d.x - a.x) + ny * (d.y - a.y);                              // signed distance inside the wall line (negative = outside)
    if (sd < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((d.x - a.x) * ex + (d.y - a.y) * ey) / (L * L)));
    minD = Math.min(minD, Math.hypot(d.x - (a.x + ex * t), d.y - (a.y + ey * t)));
  }
  return inside || minD < d.r + pad;
}
