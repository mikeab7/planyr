/* Where a pad-corner spot tag ("fill 22.1" / "cut 9.1") sits relative to the selected building's own edit buttons — owner
 * 2026-10-30 (NEW-2): at the two south corners the tag sat exactly under the purple "+" bump-out button, so it read "fil⊕22.1".
 * Pure, screen px.
 *
 * TWO THINGS LIVE HERE AND MUST NOT DRIFT APART:
 *   • the button anchors — `bumpButtonAnchor` (the purple corner "+") and `sideButtonAnchor` (the dock / employee "+ / −" pair
 *     on a wall's middle). SitePlanner's `sideAddNodes` places its buttons THROUGH these two, so the tag placer below avoids the
 *     same discs the canvas draws, not a copy of their formulas;
 *   • `placeCornerTag` — the tag. Nothing selected: exactly where it always was (a little way in from the corner, toward the
 *     centre). A building SELECTED: the tag slides along the building's longer wall, away from the corner, until its box clears
 *     every button disc, and a thin leader keeps it tied to the exact corner point. The buttons never move.
 * The tag layer is `pointer-events: none` (GradingCanvas's root), so a tag never takes a press from a button underneath it.
 */
import { FEAT_CTRL_R, FEAT_CTRL_STROKE } from "./featureEditZoom.js";

export const BUMP_BTN_INSET = 20;   // the corner "+" sits this far in from the corner, toward the building's centre
export const SIDE_BTN_INSET = 24;   // the wall "+ / −" pair sits this far in from the wall's middle
export const SIDE_PAIR_GAP = FEAT_CTRL_R + 3; // …its two discs this far either side of that point, along the wall
export const CORNER_TAG_PILL_H = 17;
export const RAMP_BTN_R = FEAT_CTRL_R * 0.78; // the small slate drive-in ramp button (B2566544–B2566547)
const CLEAR_PX = 1;                 // air kept between a tag's box and a button disc (outer edge, keyline included)
const STEP_PX = 2;
const TAG_INSET_PX = 4;             // the tag's centre rides this far inside the wall line
const TAG_OUTSIDE_PX = 3;           // …or, on a wall too short for that, this far clear outside it

/** Pill width for a tag's text — the ONE formula the canvas pill (`Pill2`) draws with. */
export const pillWidth = (text, size = 11) => Math.max(22, String(text).length * (size * 0.6) + 10);

const unit = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; };

/** The purple corner "+": just inside the corner, along the line to the building's centre. */
export function bumpButtonAnchor(corner, centre) {
  const u = unit(corner.x - centre.x, corner.y - centre.y);
  return { x: corner.x - u.x * BUMP_BTN_INSET, y: corner.y - u.y * BUMP_BTN_INSET };
}

/** The wall's middle "+ / −" pair: `pos` is the pair's centre (just inside the wall), `tan` runs along the wall. */
export function sideButtonAnchor(mid, centre) {
  const u = unit(mid.x - centre.x, mid.y - centre.y);
  return { pos: { x: mid.x - u.x * SIDE_BTN_INSET, y: mid.y - u.y * SIDE_BTN_INSET }, tan: { x: -u.y, y: u.x } };
}

/** The ramp "+" beside the wall pair: along the wall, clear of the pair's outer edge. `pos`/`tan` are `sideButtonAnchor`'s. */
export function rampWallAnchor(pos, tan) {
  const off = FEAT_CTRL_R * 2 + 3 + 4 + RAMP_BTN_R;
  return { x: pos.x + tan.x * off, y: pos.y + tan.y * off };
}

/** The ramp "+" beside a corner's purple "+": a little toward the middle of the dock wall the corner belongs to. */
export function rampCornerAnchor(bumpPos, wallMid) {
  const u = unit(wallMid.x - bumpPos.x, wallMid.y - bumpPos.y), off = FEAT_CTRL_R + 4 + RAMP_BTN_R;
  return { x: bumpPos.x + u.x * off, y: bumpPos.y + u.y * off };
}

/** Every disc a selected building's buttons can occupy (the worst case: both halves of every pair, all four corners). */
export function buttonDiscs(quad) {
  const c = { x: quad.reduce((s, p) => s + p.x, 0) / quad.length, y: quad.reduce((s, p) => s + p.y, 0) / quad.length };
  const r = FEAT_CTRL_R + FEAT_CTRL_STROKE / 2;
  const out = [];
  quad.forEach((p, i) => {
    out.push({ ...bumpButtonAnchor(p, c), r, kind: "bump", corner: i });
    const q = quad[(i + 1) % quad.length];
    const { pos, tan } = sideButtonAnchor({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, c);
    out.push({ x: pos.x - tan.x * SIDE_PAIR_GAP, y: pos.y - tan.y * SIDE_PAIR_GAP, r, kind: "side", wall: i });
    out.push({ x: pos.x + tan.x * SIDE_PAIR_GAP, y: pos.y + tan.y * SIDE_PAIR_GAP, r, kind: "side", wall: i });
    // the ramp buttons (worst case: every wall carries one; each corner one toward EACH of its two walls' middles)
    out.push({ ...rampWallAnchor(pos, tan), r: RAMP_BTN_R + FEAT_CTRL_STROKE / 2, kind: "ramp-wall", wall: i });
    const bump = bumpButtonAnchor(p, c);
    for (const [a, b] of [[quad[(i + quad.length - 1) % quad.length], p], [p, q]]) {
      out.push({ ...rampCornerAnchor(bump, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), r: RAMP_BTN_R + FEAT_CTRL_STROKE / 2, kind: "ramp-corner", corner: i });
    }
  });
  return out;
}

/** Does an axis-aligned box {x,y,w,h} (x,y = centre) come within `pad` of a disc? */
export function boxHitsDisc(box, d, pad = 0) {
  const nx = Math.max(box.x - box.w / 2, Math.min(d.x, box.x + box.w / 2));
  const ny = Math.max(box.y - box.h / 2, Math.min(d.y, box.y + box.h / 2));
  return Math.hypot(d.x - nx, d.y - ny) < d.r + pad;
}

/**
 * @param {{x:number,y:number}[]} quad the pad's four corners in screen px (ring order)
 * @param {number} idx which corner this tag is for
 * @param {string} text the tag's words
 * @param {boolean} selected the building is selected — its buttons are on screen
 * @returns {{x:number,y:number,leader:null|{x1:number,y1:number,x2:number,y2:number}, w:number, h:number}} the tag's centre and
 *   box size, plus the leader tying a moved tag to its exact corner (null where the tag is in its usual place)
 */
export function placeCornerTag(quad, idx, text, selected) {
  const P = quad[idx], w = pillWidth(text), h = CORNER_TAG_PILL_H;
  const C = { x: quad.reduce((s, p) => s + p.x, 0) / quad.length, y: quad.reduce((s, p) => s + p.y, 0) / quad.length };
  const toC = { x: C.x - P.x, y: C.y - P.y }, d = Math.hypot(toC.x, toC.y) || 1;
  if (!selected) { // unchanged from before: a little way in from the corner, toward the centre
    const inset = Math.min(26, d * 0.3);
    return { x: P.x + (toC.x / d) * inset, y: P.y + (toC.y / d) * inset, leader: null, w, h };
  }
  const prev = quad[(idx + quad.length - 1) % quad.length], next = quad[(idx + 1) % quad.length];
  const wallTo = (Q) => ({ Q, len: Math.hypot(Q.x - P.x, Q.y - P.y) });
  const walls = [wallTo(prev), wallTo(next)].sort((p, q) => q.len - p.len); // the longer wall first: the most room to slide
  const discs = buttonDiscs(quad);
  const free = (c) => !discs.some((dc) => boxHitsDisc({ x: c.x, y: c.y, w, h }, dc, CLEAR_PX));
  // Candidates, in order: along the longer wall INSIDE the footprint, then (a wall too short to carry the tag between its
  // buttons — a small, nearly square building) along it on the OUTSIDE, where there are no buttons, then the same on the other
  // wall. The tag is axis-aligned on screen, so how far it reaches across a wall is its half-extent ALONG the wall's normal.
  for (const outside of [false, true]) {
    for (const wall of walls) {
      const u = unit(wall.Q.x - P.x, wall.Q.y - P.y);
      let n = { x: -u.y, y: u.x };
      if (n.x * toC.x + n.y * toC.y < 0) n = { x: -n.x, y: -n.y }; // toward the building's inside
      const reach = Math.abs(n.x) * (w / 2) + Math.abs(n.y) * (h / 2);
      const off = outside ? -(reach + TAG_OUTSIDE_PX) : TAG_INSET_PX;
      const at = (s) => ({ x: P.x + u.x * s + n.x * off, y: P.y + u.y * s + n.y * off });
      const lastS = Math.max(w / 2, wall.len - w / 2);
      for (let s = w / 2 + 2; ; s += STEP_PX) {
        const c = at(Math.min(s, lastS));
        if (free(c)) return { x: c.x, y: c.y, leader: { x1: P.x, y1: P.y, x2: c.x, y2: c.y }, w, h };
        if (s >= lastS) break;
      }
    }
  }
  // Nothing clears (a building too small to label legibly anyway): the usual spot, leader and all — never a guess off the drawing.
  const inset = Math.min(26, d * 0.3);
  const c = { x: P.x + (toC.x / d) * inset, y: P.y + (toC.y / d) * inset };
  return { x: c.x, y: c.y, leader: null, w, h };
}
