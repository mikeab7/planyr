/* Where the grading's court / lot labels sit — "dock 784.5", "curb 786.0", "784.5" (the far edge), "1.5% fall" — owner 2026-11-04 (NEW-1):
 * "no grading label is ever drawn under an edit button, a wall handle or another label. Controls stay where they are; labels move clear of them
 * (a short leader line is fine). Labels near the map edge move inside it."
 *
 * WHY A PLACER AND NOT A RULE LIKE THE CORNER TAGS. The corner tags (lib/padCornerTag.js) sit INSIDE the footprint and every button sits OUTSIDE it, so two
 * half-planes separate them by construction. A court's labels live on the OTHER side of the wall — in the court, exactly where the button row, the
 * wall-middle grip and the rotate grip are — so there is no half-plane to hide behind. The answer is the same property stated the other way round:
 * the placer is handed every control the building can show (all of them, selected or not — the layout must not move when you select) and every label
 * already placed, and walks outward from the label's natural spot to the NEAREST one that touches none of them and lies inside the map.
 *
 * The controls are the very ones the planner draws: the button discs come from `layoutBuildingButtons` through the same wall filter `sideAddNodes` uses
 * (`buildingButtonWalls`), the grips are the four wall-middle squares, the four corner squares and the rotate grip + stem of `handleNodes`. Pure, screen px.
 * A label that finds no clear place within reach is HIDDEN (named in the result) — never drawn under a control.
 */
import { layoutBuildingButtons, layoutDiscs, buildingButtonWalls, ROTATE_GRIP_OFFSET_PX, ROTATE_GRIP_R_PX } from "./buildingButtons.js";
import { dockSidesFor } from "./dockZones.js";
import { placeCornerTag, pillWidth, CORNER_TAG_PILL_H } from "./padCornerTag.js";

export const LABEL_PAD_PX = 2;            // air kept between a label's box and anything else
export const VIEW_MARGIN_PX = 3;          // air kept between a label's box and the map's edge
export const SEARCH_REACH_PX = 150;       // how far a label may travel from its natural spot before it is hidden instead
export const LEADER_FROM_PX = 6;          // a label moved farther than this from its natural spot is tied back to it
const SEARCH_STEP_PX = 4;
const EDGE_GRIP_HALF = 5.25 + 0.75;       // the 9 px wall-middle square + its keyline
const CORNER_GRIP_HALF = 5.75 + 0.75;     // the 10 px corner square + its keyline
const STEM_R = 2.5, STEM_STEP = 5;        // the rotate grip's stem, as a chain of small discs

const rot2 = (x, y, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };

/** Every control a building can show, as obstacles in screen px: { discs: [{x,y,r}], rects: [{x,y,hw,hh}] }. Empty for a locked or polygon building
 *  (the planner draws none for them). `el` is the building element (cx, cy, w, h, rot, locked, points, footEdit, dock…). */
export function buildingControlObstacles(el, f2p, rppf) {
  const out = { discs: [], rects: [] };
  if (!el || el.locked || el.points || el.dogEar || !Number.isFinite(el.w) || !Number.isFinite(el.h)) return out;
  const corner = (lx, ly) => { const o = rot2(lx, ly, el.rot || 0); return f2p({ x: el.cx + o.x, y: el.cy + o.y }); };
  const quad = [corner(-el.w / 2, -el.h / 2), corner(el.w / 2, -el.h / 2), corner(el.w / 2, el.h / 2), corner(-el.w / 2, el.h / 2)];
  const wpx = Math.abs(el.w) * rppf, hpx = Math.abs(el.h) * rppf;
  // the buttons: the planner's own wall filter + layout (a button that is not drawn is not an obstacle)
  const walls = buildingButtonWalls(quad, dockSidesFor(el).dockSides, { wpx, hpx, footEdit: !!el.footEdit });
  out.discs.push(...layoutDiscs(layoutBuildingButtons(walls)).map((d) => ({ x: d.x, y: d.y, r: d.r })));
  // the selection grips: four wall-middle squares, four corner squares, the rotate grip and its stem
  for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const o = rot2(nx * el.w / 2, ny * el.h / 2, el.rot || 0), m = f2p({ x: el.cx + o.x, y: el.cy + o.y });
    out.rects.push({ x: m.x, y: m.y, hw: EDGE_GRIP_HALF, hh: EDGE_GRIP_HALF });
  }
  for (const c of quad) out.rects.push({ x: c.x, y: c.y, hw: CORNER_GRIP_HALF, hh: CORNER_GRIP_HALF });
  const topMid = { x: (quad[0].x + quad[1].x) / 2, y: (quad[0].y + quad[1].y) / 2 };
  const cp = { x: (quad[0].x + quad[2].x) / 2, y: (quad[0].y + quad[2].y) / 2 };
  const ul = Math.hypot(topMid.x - cp.x, topMid.y - cp.y) || 1, ux = (topMid.x - cp.x) / ul, uy = (topMid.y - cp.y) / ul;
  out.discs.push({ x: topMid.x + ux * ROTATE_GRIP_OFFSET_PX, y: topMid.y + uy * ROTATE_GRIP_OFFSET_PX, r: ROTATE_GRIP_R_PX + 0.75 });
  for (let d = STEM_STEP; d < ROTATE_GRIP_OFFSET_PX; d += STEM_STEP) out.discs.push({ x: topMid.x + ux * d, y: topMid.y + uy * d, r: STEM_R });
  return out;
}

/* ---- geometry of a label box (x, y = centre) against the things it must clear ---- */
export const boxHitsDisc = (b, d, pad = 0) => Math.hypot(d.x - Math.max(b.x - b.w / 2, Math.min(d.x, b.x + b.w / 2)), d.y - Math.max(b.y - b.h / 2, Math.min(d.y, b.y + b.h / 2))) < d.r + pad;
export const boxHitsRect = (b, r, pad = 0) => Math.abs(b.x - r.x) < b.w / 2 + r.hw + pad && Math.abs(b.y - r.y) < b.h / 2 + r.hh + pad;
export const boxHitsBox = (a, b, pad = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad;
export const pointInView = (p, view) => !view || (p.x >= 0 && p.y >= 0 && p.x <= view.w && p.y <= view.h);
/** Does the segment {x1,y1,x2,y2} pass through the box (x, y = centre) grown by `pad`? (Liang–Barsky clip.) */
export function segHitsBox(g, b, pad = 0) {
  const x0 = b.x - b.w / 2 - pad, x1 = b.x + b.w / 2 + pad, y0 = b.y - b.h / 2 - pad, y1 = b.y + b.h / 2 + pad;
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, g.x1 - x0], [dx, x1 - g.x1], [-dy, g.y1 - y0], [dy, y1 - g.y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}
export const boxInView = (b, view, margin = VIEW_MARGIN_PX) => !view || (b.x - b.w / 2 >= margin && b.y - b.h / 2 >= margin && b.x + b.w / 2 <= view.w - margin && b.y + b.h / 2 <= view.h - margin);

/* Candidate offsets, nearest first (ties: the larger forward step first). In a label's own frame: `f` along the court's fall (away from the wall), `s` along the wall. */
const OFFSETS = (() => {
  const all = [];
  for (let f = -SEARCH_REACH_PX; f <= SEARCH_REACH_PX; f += SEARCH_STEP_PX) for (let s = -SEARCH_REACH_PX; s <= SEARCH_REACH_PX; s += SEARCH_STEP_PX) {
    const d = Math.hypot(f, s);
    if (d <= SEARCH_REACH_PX) all.push({ f, s, d });
  }
  return all.sort((p, q) => (p.d - q.d) || (q.f - p.f) || (p.s - q.s));
})();

/**
 * Place a list of labels so none touches an obstacle, a fixed box, a label already placed, or the map's edge.
 * @param {{key:string,text:string,x:number,y:number,anchor?:{x:number,y:number},axes?:{f:{x:number,y:number},s:{x:number,y:number}},size?:number}[]} items
 *   in priority order. x,y = the natural spot (box centre); `anchor` = the measured point to tie a moved label back to (default: x,y);
 *   `axes` = unit screen vectors of the court's fall (f) and wall (s) directions (default: screen down / right).
 * @param {{discs:{x,y,r}[], rects:{x,y,hw,hh}[], boxes?:{x,y,w,h}[]}} obstacles
 * @param {{w:number,h:number}|null} view the map's box in px (labels stay inside it), null = unbounded
 * @returns {Map<string,{x:number,y:number,w:number,h:number,moved:boolean,gap?:number,hidden:boolean,skip?:boolean,leader:null|{x1:number,y1:number,x2:number,y2:number}}>}
 */
export function placeLabels(items, obstacles, view) {
  const placed = [...(obstacles.boxes || [])];
  const leaders = [];                                         // the leader lines of the labels placed so far — a later label must not sit on one
  const res = new Map();
  // a moved label's leader: from the point it measures to the nearest point of its box (null when the box is right against it)
  const leaderFor = (box, anchor, from) => {
    const nx = Math.max(box.x - box.w / 2, Math.min(anchor.x, box.x + box.w / 2)), ny = Math.max(box.y - box.h / 2, Math.min(anchor.y, box.y + box.h / 2));
    const gap = Math.hypot(anchor.x - nx, anchor.y - ny), moved = Math.hypot(box.x - from.x, box.y - from.y) > LEADER_FROM_PX;
    return { gap, moved, line: moved && gap > 4 ? { x1: anchor.x, y1: anchor.y, x2: nx, y2: ny } : null };
  };
  // the measured points themselves: a label never covers the point another label measures (its leader would start under this one)
  const anchors = items.map((it) => it.anchor || { x: it.x, y: it.y });
  const coversAnchor = (b, self) => anchors.some((a, i) => i !== self && Math.abs(a.x - b.x) < b.w / 2 + 1 && Math.abs(a.y - b.y) < b.h / 2 + 1);
  const clear = (b, line, strict = true, self = -1) => boxInView(b, view)
    && !obstacles.discs.some((d) => boxHitsDisc(b, d, LABEL_PAD_PX))
    && !obstacles.rects.some((r) => boxHitsRect(b, r, LABEL_PAD_PX))
    && !placed.some((p) => boxHitsBox(b, p, LABEL_PAD_PX))
    && (!strict || (!coversAnchor(b, self) && !leaders.some((g) => segHitsBox(g, b, 1))                   // nobody sits on an earlier label's leader …
      && !(line && placed.some((p) => segHitsBox(line, p, 0)))));                // … and this label's own leader crosses no one else's box
  for (let ii = 0; ii < items.length; ii++) {
    const it = items[ii];
    const w = pillWidth(it.text, it.size || 11), h = CORNER_TAG_PILL_H;
    const F = it.axes ? it.axes.f : { x: 0, y: 1 }, S = it.axes ? it.axes.s : { x: 1, y: 0 };
    const anchor = it.anchor || { x: it.x, y: it.y }, from = { x: it.x, y: it.y };
    // a label whose measured point is off the map is not on screen at all — it is left alone, never dragged in to stand in the picture without its subject
    if (!pointInView(anchor, view)) { res.set(it.key, { x: it.x, y: it.y, w, h, moved: false, hidden: false, skip: true, leader: null }); continue; }
    let box = null, info = null;
    const natural = { x: it.x, y: it.y, w, h };
    if (clear(natural, null, true, ii)) { box = natural; info = leaderFor(natural, anchor, from); }
    else for (const strict of [true, false]) {                  // the clean search first; only when the map's edge leaves no clean spot, one whose leader has to cross something
      for (const o of OFFSETS) {
        const b = { x: it.x + F.x * o.f + S.x * o.s, y: it.y + F.y * o.f + S.y * o.s, w, h };
        const li = leaderFor(b, anchor, from);
        if (clear(b, li.line, strict, ii)) { box = b; info = li; break; }
      }
      if (box) break;
    }
    if (!box) { res.set(it.key, { x: it.x, y: it.y, w, h, moved: false, hidden: true, leader: null }); continue; }
    placed.push(box);
    if (info.line) leaders.push(info.line);
    res.set(it.key, { x: box.x, y: box.y, w, h, moved: box !== natural && info.moved, gap: info.gap, hidden: false, leader: info.line });
  }
  return res;
}

const unit = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; };

/**
 * The whole label layout of one building's label set (`labels[i]` from GradingController): every court / lot spot (dock face, far-edge spots, the
 * fall tag), the four pad-corner tags (fixed — they are inside the footprint and move for nothing) and the setback flag pill, against the building's
 * controls and the map's edge. Called by GradingCanvas (and by the tests) with the planner's own `f2p`.
 * @returns {{ spots: Map<string, object>, corners: Map<number, object>, hiddenCount: number }}
 *   `spots` keys: `flag` · `<elId>:face` · `<elId>:tag` · `<elId>:far<i>`.
 */
export function layoutLabelSet(L, f2p, rppf, view = null) {
  const obstacles = { discs: [], rects: [], boxes: [] };
  if (L.ctrl) { const c = buildingControlObstacles(L.ctrl, f2p, rppf); obstacles.discs.push(...c.discs); obstacles.rects.push(...c.rects); }
  // fixed: the corner tags (placed by padCornerTag, inside the footprint — and past the grips that reach a few px inside the walls)
  const hitsControl = (b) => obstacles.discs.some((d) => boxHitsDisc(b, d, LABEL_PAD_PX)) || obstacles.rects.some((r) => boxHitsRect(b, r, LABEL_PAD_PX));
  const corners = new Map();
  const quad = L.quad ? L.quad.map((q) => f2p(q)) : null;
  const c0 = f2p(L.centre);
  for (const k of L.corners || []) {
    const p = f2p(k.pt);
    const cornerOn = pointInView(p, view);          // a corner that is off the map keeps its tag where it was; one on the map keeps its tag on the map
    const w = pillWidth(k.text), h = CORNER_TAG_PILL_H;
    const blocked = (b) => hitsControl(b) || (cornerOn && !boxInView(b, view)) || obstacles.boxes.some((q) => boxHitsBox(b, q, LABEL_PAD_PX));
    const t = quad ? placeCornerTag(quad, k.idx, k.text, blocked) : null;
    let x, y;
    if (t) { x = t.x; y = t.y; } else {
      const dx = c0.x - p.x, dy = c0.y - p.y, d = Math.hypot(dx, dy) || 1, inset = Math.min(26, d * 0.3);
      x = p.x + (dx / d) * inset; y = p.y + (dy / d) * inset;
    }
    // a footprint too small on the map to hold all four tags clear of each other drops the one that cannot fit — never draws it over its neighbour
    const hidden = cornerOn && (hitsControl({ x, y, w, h }) || obstacles.boxes.some((q) => boxHitsBox({ x, y, w, h }, q, LABEL_PAD_PX)));
    corners.set(k.idx, { x, y, w, h, leader: t ? t.leader : null, hidden });
    if (!hidden) obstacles.boxes.push({ x, y, w, h });
  }
  // the court / lot spots, in the order they matter: the face number, the fall tag, then each far-edge number
  const items = [];
  if (L.flagDot) {                                                         // the setback flag's pill rides 16 px above its dot, and moves like any label
    const d = f2p(L.flagDot.pt);
    items.push({ key: "flag", text: L.flagDot.text, x: d.x, y: d.y - 16, anchor: d });
    obstacles.discs.push({ x: d.x, y: d.y, r: 6 });
  }
  for (const sp of L.spots || []) {
    if (sp.depthFt * rppf < 46) continue;                                  // too small to carry a label legibly (the canvas draws none either)
    const inset = Math.min(sp.depthFt * 0.22, 15 / rppf);
    const at = (a, b) => f2p(sp.world(a, b));
    const o = at(0, 0);
    const axes = { f: unit(at(1, 0).x - o.x, at(1, 0).y - o.y), s: unit(at(0, 1).x - o.x, at(0, 1).y - o.y) };
    // each station's arrow is a thin line the labels should not sit on either
    for (const st of sp.stations) {
      const a = at(st.from, st.b), z = at(st.to, st.b), n = Math.max(1, Math.ceil(Math.hypot(z.x - a.x, z.y - a.y) / 6));
      for (let i = 0; i <= n; i++) obstacles.discs.push({ x: a.x + ((z.x - a.x) * i) / n, y: a.y + ((z.y - a.y) * i) / n, r: 3 });
    }
    const fp = at(sp.face.a + inset, sp.face.b);
    items.push({ key: `${sp.elId}:face`, text: sp.face.label, x: fp.x, y: fp.y, anchor: at(sp.face.a, sp.face.b), axes });
    if (sp.tag) {
      const t = at(sp.tag.a, sp.tag.b + Math.min(26 / rppf, sp.widthFt * 0.12));
      items.push({ key: `${sp.elId}:tag`, text: sp.tag.text, x: t.x, y: t.y, anchor: at(sp.tag.a, sp.tag.b), axes });
    }
    sp.stations.forEach((st, i) => {
      const far = at(st.far.a - inset, st.b);
      items.push({ key: `${sp.elId}:far${i}`, text: st.far.label, x: far.x, y: far.y, anchor: at(st.far.a, st.b), axes });
    });
  }
  const spots = placeLabels(items, obstacles, view);
  let hiddenCount = 0;
  for (const v of spots.values()) if (v.hidden) hiddenCount++;
  for (const v of corners.values()) if (v.hidden) hiddenCount++;   // `skip` (off the map) is not a drop
  return { spots, corners, hiddenCount };
}
