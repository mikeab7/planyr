/* annotationExtract — the DOM half of the "editable markups" PDF export (NEW-1, 2026-10-05; site elements 2026-10-20).
 *
 * Takes the CLONED plan <svg> that buildExportSvg produced (so every print retarget — stroke
 * weights, label sizes, hidden groups — has already been applied), lifts each ANNOTATION markup /
 * callout / measurement node OUT of the page content, and returns a descriptor per object for
 * `pdfAnnotations.buildAnnotations`. What it removes is exactly what the flattened export would have
 * painted, so the picture and the annotations can never describe two different drawings.
 *
 * EVERY DRAWN OBJECT MOVES (NEW-1, 2026-10-20, owner: "buildings weren't touchable, detention wasn't touchable, roads
 * aren't editable"): markups of every kind (easements and utility routes included), callouts / text boxes,
 * measurements, AND every site element — buildings (with their bump-outs), roads (one per dissolved network),
 * detention ponds, paving / truck courts, parking, trailer parking, sidewalks, landscape. What stays page content is the
 * ground the plan is drawn on: the aerial, parcels, GIS layers, reference drawings, title block and furniture.
 *
 * `domToTree` is the one place that touches the DOM, so the converter in pdfAnnotations.js stays
 * pure and unit-testable in plain node.
 */
import { ANNOTATION_KINDS } from "./siteModel.js";
import { isBuilding } from "../../../shared/projects/projectModel.js";
import ClipperLib from "clipper-lib";
import { flattenTree, unionBox } from "./pdfAnnotations.js";
import { bumpOutsOf, buildingOutlineRing } from "./buildingOutline.js";
import { calloutStyle } from "./calloutStyle.js";

/** Parse `style="a: b; c: d"` into a plain object (property names kebab-cased). */
function parseStyle(text) {
  const out = {};
  String(text || "").split(";").forEach((decl) => {
    const i = decl.indexOf(":");
    if (i < 0) return;
    const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

/** A presentation attribute, resolved the way CSS inheritance would (own attr / style, else ancestors). */
function inherited(el, name) {
  for (let n = el; n && n.getAttribute; n = n.parentNode) {
    const st = parseStyle(n.getAttribute("style"));
    if (st[name] != null && st[name] !== "") return st[name];
    const v = n.getAttribute(name);
    if (v != null && v !== "") return v;
  }
  return null;
}

/**
 * DOM element → plain `{ tag, a, kids, str?, tw? }` tree.
 * `measureText(str, fontShorthand) → px width` (a canvas measure) lets each text line keep the width
 * the browser gave it, so the Helvetica re-draw can be squeezed to the same span. `patterns` is an
 * out-map filled with every `fill="url(#id)"` pattern the subtree references.
 */
export function domToTree(el, { measureText = null, patterns = {}, root = el } = {}) {
  if (!el || el.nodeType !== 1) return null;
  const tag = el.tagName.toLowerCase();
  const a = {};
  for (const at of Array.from(el.attributes || [])) a[at.name] = at.value;
  Object.assign(a, parseStyle(el.getAttribute("style")));
  const m = /^url\(#([^)]+)\)/.exec(a.fill || "");
  if (m && !patterns[m[1]]) {
    // the clone is detached, so look the pattern up inside it
    let pe = null;
    try { pe = root.querySelector ? root.querySelector(`#${CSS.escape(m[1])}`) : null; } catch (_) { pe = null; }
    if (pe) patterns[m[1]] = domToTree(pe, { measureText, patterns, root });
  }
  const node = { tag, a, kids: [] };
  /* A STACKED label is ONE <text> whose lines are <tspan x dy> children (the planner's element labels). Read as
     textContent they run together on one line ("Building 1450,000 SF900′ × 500′"), so each tspan becomes its own
     text line at its own baseline (y + the running dy) inside a group that keeps the text's style and transform. */
  const tspans = tag === "text" ? Array.from(el.childNodes || []).filter((c) => c.nodeType === 1 && String(c.tagName).toLowerCase() === "tspan") : [];
  if (tspans.length > 1 && tspans.every((t) => t.getAttribute("dy") == null || Number.isFinite(parseFloat(t.getAttribute("dy"))))) {
    const { x: _x, y: _y, ...rest } = a; void _x; void _y;
    const g = { tag: "g", a: rest, kids: [] };
    let y = parseFloat(a.y) || 0;
    for (const t of tspans) {
      y += parseFloat(t.getAttribute("dy")) || 0;
      const line = { tag: "text", a: { x: t.getAttribute("x") != null ? t.getAttribute("x") : (a.x != null ? a.x : 0), y }, kids: [], str: t.textContent || "" };
      if (measureText && line.str) {
        const size = parseFloat(inherited(el, "font-size")) || 12;
        try { const w = measureText(line.str, `${inherited(el, "font-style") || "normal"} ${inherited(el, "font-weight") || "400"} ${size}px ${inherited(el, "font-family") || "Inter, system-ui, sans-serif"}`); if (Number.isFinite(w) && w > 0) line.tw = w; } catch (_) { /* accuracy nicety only */ }
      }
      g.kids.push(line);
    }
    return g;
  }
  if (tag === "text") {
    node.str = el.textContent || "";
    if (measureText && node.str) {
      const size = parseFloat(inherited(el, "font-size")) || 12;
      const weight = inherited(el, "font-weight") || "400";
      const style = inherited(el, "font-style") || "normal";
      const family = inherited(el, "font-family") || "Inter, system-ui, sans-serif";
      try {
        const w = measureText(node.str, `${style} ${weight} ${size}px ${family}`);
        if (Number.isFinite(w) && w > 0) node.tw = w;
      } catch (_) { /* measuring is an accuracy nicety, never a reason to fail the export */ }
    }
    return node;
  }
  for (const c of Array.from(el.childNodes || [])) {
    if (c.nodeType === 1) { const k = domToTree(c, { measureText, patterns, root }); if (k) node.kids.push(k); }
  }
  return node;
}

const IDENT = [1, 0, 0, 1, 0, 0];
const ALL = [-Infinity, -Infinity, Infinity, Infinity];
/* Two flush neighbours (a truck court against its building, a bump-out on its wall) share an edge; real covering is
   deeper than a hairline. Applied to the INTERSECTION OF THE REAL SHAPES (below), never to bounding boxes. */
const OVERLAP_TOL = 1.5;
const boxesTouch = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > OVERLAP_TOL && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > OVERLAP_TOL;

/** `<image>` has no ink in flattenTree (its draw is the raster); for its footprint it is just its (transformed) rect. */
function imagesAsRects(t) {
  if (!t) return t;
  if (t.tag === "image") return { ...t, tag: "rect", a: { ...t.a, fill: "black", stroke: "none" }, kids: [] };
  return { ...t, kids: (t.kids || []).map(imagesAsRects) };
}

/* Subpaths of a flattened path item as vertex lists (control points dropped — the hull a Bézier lies inside is close
   enough for an overlap test), each with whether it was closed. */
function subpaths(it, onCurve = false) {
  const out = [];
  let cur = null;
  for (const s of it.segs) {
    if (s[0] === "M") { cur = { v: [[s[1], s[2]]], closed: false }; out.push(cur); }
    else if (s[0] === "L" && cur) cur.v.push([s[1], s[2]]);
    else if (s[0] === "C" && cur) { if (!onCurve) cur.v.push([s[1], s[2]], [s[3], s[4]]); cur.v.push([s[5], s[6]]); }
    else if (s[0] === "Z" && cur) cur.closed = true;
  }
  return out.filter((p) => p.v.length >= 2);
}
const ringArea = (v) => { let a = 0; for (let i = 0, j = v.length - 1; i < v.length; j = i++) a += (v[j][0] + v[i][0]) * (v[j][1] - v[i][1]); return Math.abs(a / 2); };

/**
 * The REAL painted footprint of `node` (clone user units): one polygon per filled / closed subpath, a thin quad per
 * segment of an open stroke, a rotated box per text run. NEW-1 (2026-10-20): the pin test used to compare axis-aligned
 * BOUNDING BOXES, and on a real plan every building and its truck court are ROTATED — a tilted truck court's box
 * swallows its building's box although the two only touch along the dock wall, so all five buildings on the owner's
 * Bain plan stayed burned into the page while a square throwaway plan passed. Returns null when nothing is painted.
 */
function paintShapes(node, root) {
  let items;
  try { items = flattenTree(imagesAsRects(domToTree(node, { root })), IDENT, {}).items; } catch (_) { return null; }
  const polys = [];
  for (const it of items) {
    if (it.t === "text") {
      const c = Math.cos(it.ang), s = Math.sin(it.ang), up = it.size * 0.95, dn = it.size * 0.3;
      polys.push([[0, -dn], [it.w, -dn], [it.w, up], [0, up]].map(([u, v]) => [it.x + u * c - v * s, it.y + u * s + v * c]));
      continue;
    }
    for (const sp of subpaths(it)) {
      if ((sp.closed || it.fill || it.pat) && sp.v.length >= 3) { polys.push(sp.v); continue; }
      const hw = Math.max(it.sw || 0, 1) / 2;
      for (let i = 1; i < sp.v.length; i++) {
        const [x0, y0] = sp.v[i - 1], [x1, y1] = sp.v[i];
        const L = Math.hypot(x1 - x0, y1 - y0); if (!(L > 0)) continue;
        const nx = (-(y1 - y0) / L) * hw, ny = ((x1 - x0) / L) * hw;
        polys.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
      }
    }
  }
  if (!polys.length) return null;
  const box = unionBox(polys.map((p) => unionBox(p.map(([x, y]) => [x, y, x, y]))));
  return { polys, box };
}
const CLIP = 100;
const toClip = (v) => v.map(([x, y]) => ({ X: Math.round(x * CLIP), Y: Math.round(y * CLIP) }));
/** Do two painted footprints genuinely overlap — an intersection thicker than a hairline, not a shared edge? */
function shapesOverlap(a, b) {
  if (!a || !b) return false;
  if (a === ALL || b === ALL) return true;
  if (!boxesTouch(a.box, b.box)) return false;
  for (const pa of a.polys) {
    const ba = unionBox(pa.map(([x, y]) => [x, y, x, y]));
    for (const pb of b.polys) {
      const bb = unionBox(pb.map(([x, y]) => [x, y, x, y]));
      if (!boxesTouch(ba, bb)) continue;
      const c = new ClipperLib.Clipper();
      c.AddPath(toClip(pa), ClipperLib.PolyType.ptSubject, true);
      c.AddPath(toClip(pb), ClipperLib.PolyType.ptClip, true);
      const sol = new ClipperLib.Paths();
      c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      for (const q of sol) {
        const area = Math.abs(ClipperLib.Clipper.Area(q)) / (CLIP * CLIP);
        const qb = unionBox(q.map((pt) => [pt.X / CLIP, pt.Y / CLIP, pt.X / CLIP, pt.Y / CLIP]));
        const span = Math.max(qb[2] - qb[0], qb[3] - qb[1], 1e-9);
        if (area / span > OVERLAP_TOL) return true; // thicker than a hairline on average
      }
    }
  }
  return false;
}

/** The outer outline the element DRAWS (clone units): the largest closed subpath of the largest filled/closed item. */
function drawnOutline(node, root) {
  let items;
  try { items = flattenTree(domToTree(node, { root }), IDENT, {}).items; } catch (_) { return null; }
  let best = null, bestA = 0;
  for (const it of items) {
    if (it.t !== "path" || !(it.fill || it.pat || it.stroke)) continue;
    for (const sp of subpaths(it, true)) { // on-curve vertices only: a Bézier's control points are not corners
      if (!(sp.closed || it.fill || it.pat) || sp.v.length < 3) continue;
      const a = ringArea(sp.v);
      if (a > bestA) { bestA = a; best = sp.v; }
    }
  }
  if (best && best.length > 3 && Math.hypot(best[0][0] - best[best.length - 1][0], best[0][1] - best[best.length - 1][1]) < 1e-6) best = best.slice(0, -1);
  return best ? best.map(([x, y]) => ({ x, y })) : null;
}

/** The words a recipient sees for an element in Bluebeam's Subject column. */
export function elementSubject(el) {
  if (!el) return "Site element";
  if (el.type === "building") return "Building";
  if (el.type === "paving") return el.truckCourt ? "Truck court" : "Paving";
  const W = { pond: "Detention pond", road: "Road", parking: "Car parking", trailer: "Trailer parking", sidewalk: "Sidewalk", landscape: "Landscape" };
  return W[el.type] || String(el.type || "Site element").replace(/^./, (c) => c.toUpperCase());
}
/** Plain words for a site-data markup kind (easements, utility routes — they live in `markups` but are drawn site data). */
export const MARKUP_SITE_SUBJECT = { easement: "Easement", encumbrance: "Encumbrance", utilRoute: "Utility route", traced: "Traced line", infwater: "Water main (inferred)" };

/**
 * Lift every drawn object out of `clone` (mutates it) and describe each as a native annotation.
 *
 *   ctx = { markups, callouts, measures, els, f2p, measureText }
 *
 * Returns { descriptors, patterns, flattened, pinned, notes }. Descriptors are in PAINT ORDER — a PDF viewer paints
 * annotations in /Annots order, so the z-order of the drawing is carried entirely by that order (NEW-1, 2026-10-20).
 *
 * ONE ANNOTATION PER OBJECT, and what an object IS:
 *   · a building and its corner bump-outs (B2352496 — `bumpOutsOf`, one outline through all of them);
 *   · a dissolved ROAD NETWORK: every road whose pavement the planner unions into one surface (`data-road-cluster`) is
 *     one annotation — the surface belongs to none of them alone (NO-ONE-OWNS-A-COMPOSITE), so splitting it would
 *     leave the joint behind when one road is dragged;
 *   · every other element, markup, callout and measurement on its own.
 *   An element's LABEL (`data-label-for`) and its dimension text travel inside its own annotation. A parcel's acreage
 *   chip is the PARCEL's — it never rides on a building (that is what B2326896's "moving a building moves its Parcel 1
 *   24.79 AC label" was); a chip a lifted element would cover becomes its own small "Parcel label" annotation.
 *
 * WHAT STILL STAYS IN THE PAGE (the only pin left): an ELEMENT that a REFERENCE DRAWING promoted above the plan really
 * covers (real shapes, not boxes) — the reference is page content, so lifting the element would paint it over the
 * drawing the user put on top. Anything such a pinned element in turn covers is pinned with it. Each pin is returned
 * in `pinned` with its reason, for the export's warning list. Markups are never pinned by a reference (the 2026-10-19
 * decision), and a lifted GIS layer pins nothing — it is a frame-wide translucent raster, so pinning under it would
 * make the whole plan uneditable again; that deviation is returned in `notes` instead.
 */
export function extractMarkupAnnotations(clone, ctx) {
  const { markups = [], callouts = [], measures = [], els = [], f2p = null, measureText = null } = ctx || {};
  const patterns = {};
  const descriptors = [];
  const flattened = [];
  const pinned = [];
  const notes = [];

  const keyOf = (n) => { const k = n.getAttribute("data-feature") || ""; const i = k.indexOf(":"); return { fam: k.slice(0, i), id: k.slice(i + 1), key: k }; };
  const inFeature = (n) => { for (let p = n.parentNode; p && p.getAttribute; p = p.parentNode) if (p.getAttribute("data-feature") != null) return true; return false; };
  const elById = new Map(els.filter(Boolean).map((e) => [String(e.id), e]));
  // bump-out id → host building (only for a host that is itself a building in `els`)
  const groupOfEl = new Map(); // element id → group key
  for (const e of els) if (isBuilding(e)) { const bumps = bumpOutsOf(els, e); if (bumps.length) { groupOfEl.set(String(e.id), `b:${e.id}`); for (const b of bumps) groupOfEl.set(String(b.id), `b:${e.id}`); } }

  const all = Array.from(clone.querySelectorAll("[data-feature],[data-overlay-id],[data-gis-front-band],[data-label-for],[data-road-cluster]"));
  // a road network: every road id in one `data-road-cluster` shares a group
  for (const n of all) {
    const rc = n.getAttribute("data-road-cluster");
    if (rc == null) continue;
    const ids = rc.split(",").filter(Boolean);
    for (const id of ids) groupOfEl.set(id, `r:${ids[0]}`);
  }
  const groupKey = (id) => groupOfEl.get(id) || `e:${id}`;
  const labelsByEl = new Map();
  for (const n of all) { const lf = n.getAttribute("data-label-for"); if (lf != null) (labelsByEl.get(lf) || labelsByEl.set(lf, []).get(lf)).push(n); }

  const stack = [];
  const chips = [];
  const groups = new Map(); // group key → stack entry
  const elEntry = (gk, id) => {
    let e = groups.get(gk);
    if (!e) {
      const kind = gk[0];
      const hostId = gk.slice(2);
      const model = kind === "r" ? elById.get(hostId) || elById.get(id) : elById.get(hostId);
      e = { fam: "el", gk, id: hostId, model, element: true, building: kind === "b" || isBuilding(model), road: kind === "r", members: [], ids: new Set() };
      groups.set(gk, e);
      stack.push(e);
    }
    return e;
  };
  for (const node of all) {
    if (node.getAttribute("data-label-for") != null) continue; // owned by its element (lifted or kept with it)
    if (node.getAttribute("data-gis-front-band") != null) { stack.push({ node, content: "gis" }); continue; }
    const rc = node.getAttribute("data-road-cluster");
    if (rc != null) { const ids = rc.split(",").filter(Boolean); if (ids.length && elById.has(ids[0])) { const e = elEntry(groupKey(ids[0]), ids[0]); e.members.push(node); ids.forEach((x) => e.ids.add(x)); } continue; }
    if (node.getAttribute("data-feature") == null) { if (!inFeature(node)) stack.push({ node, content: "reference" }); continue; }
    if (inFeature(node)) continue; // a nested feature key inside another feature's group (chrome) travels with its owner
    const { fam, id } = keyOf(node);
    if (fam === "parcel") { if (node.getAttribute("data-print-chip") != null) chips.push(node); continue; }
    if (fam === "reference") { stack.push({ node, content: "reference" }); continue; }
    if (fam === "markup") {
      const m = markups.find((x) => x && String(x.id) === id);
      if (m) stack.push({ node, fam, id, model: m, annot: true, members: [node] });
      else stack.push({ node, content: "plan" });
    } else if (fam === "callout") {
      const c = callouts.find((x) => x && String(x.id) === id);
      if (c) stack.push({ node, fam, id, model: c, annot: true, members: [node] });
      else stack.push({ node, content: "plan" });
    } else if (fam === "measure") {
      const idx = parseInt(id, 10);
      const m = Number.isFinite(idx) ? measures[idx] : null;
      stack.push({ node, fam, id, model: m, annot: true, members: [node] });
    } else if (fam === "el") {
      if (!elById.has(id)) { stack.push({ node, content: "plan" }); continue; }
      const gk = groupKey(id);
      const e = elEntry(gk, id);
      if (!e.model) { e.model = elById.get(id); e.building = isBuilding(e.model); }
      e.members.push(node); e.ids.add(id);
    } else stack.push({ node, content: "plan" });
  }
  // A building group whose host never drew (only its bump-outs did) is ordinary: its first member stands in.
  for (const e of stack) {
    if (!e.element) continue;
    e.node = e.members[0];
    // a building group whose HOST never drew (only a bump-out did) is an ordinary element: what drew is what moves
    if (e.building && !e.members.some((n) => n.getAttribute("data-feature") === `el:${e.id}`)) {
      const first = keyOf(e.node).id;
      e.building = false; e.id = first; e.model = elById.get(first); e.ids = new Set(e.members.map((n) => keyOf(n).id).filter(Boolean));
    }
  }

  /* 2 — which candidates stay in the page. Every candidate is a set of (real footprint, paint position) pairs, one per
     member node at ITS OWN position (a building's bump-outs, a road network's strips and surface). Labels are left out
     of this judgement: they paint above every element on screen and ride inside their own element's appearance. */
  const posOf = (n) => all.indexOf(n);
  const shapeCache = new Map();
  const shapesOf = (e) => {
    if (!shapeCache.has(e)) {
      const nodes = e.members || [e.node];
      shapeCache.set(e, nodes.map((n) => ({ shape: paintShapes(n, clone), pos: posOf(n) })).filter((b) => b.shape));
    }
    return shapeCache.get(e);
  };
  const coveredBy = (e, c) => {
    const counts = c.content === "plan" || c.pinned || (e.element && c.content === "reference");
    if (!counts) return false;
    return shapesOf(e).some((m) => shapesOf(c).some((t) => t.pos > m.pos && shapesOverlap(m.shape, t.shape)));
  };
  const under = (x, y) => shapesOf(x).some((m) => shapesOf(y).some((t) => t.pos > m.pos && shapesOverlap(m.shape, t.shape)));
  const nameOf = (e) => (e.element ? `${elementSubject(e.model)} ${e.id}` : (e.node && e.node.getAttribute("data-feature")) || e.content);
  const pinIt = (e, why, by) => { e.pinned = true; const key = e.element ? `el:${e.id}` : e.node.getAttribute("data-feature"); flattened.push(key); pinned.push({ key, why, by: by ? nameOf(by) : null, name: nameOf(e) }); };
  for (let again = true; again;) {
    for (let changed = true; changed;) {
      changed = false;
      for (let i = stack.length - 1; i >= 0; i--) {
        const e = stack[i];
        if (e.content || e.pinned) continue;
        const cov = stack.find((c) => c !== e && (c.content || c.pinned) && coveredBy(e, c));
        if (cov) { pinIt(e, cov.content === "reference" ? "under-reference" : cov.pinned ? "under-pinned" : "under-page", cov); changed = true; }
      }
    }
    // Two lifted objects whose members straddle each other have NO annotation order that reproduces the page: both stay.
    // Only a multi-member object (a building with bump-outs, a road network) can straddle, so one of each pair is one.
    again = false;
    const lifted = stack.filter((e) => !e.content && !e.pinned);
    const multi = (e) => (e.members || []).length > 1;
    for (let a = 0; a < lifted.length; a++) for (let b = a + 1; b < lifted.length; b++) {
      const x = lifted[a], y = lifted[b];
      if ((multi(x) || multi(y)) && !x.pinned && !y.pinned && under(x, y) && under(y, x)) { pinIt(x, "straddle", y); pinIt(y, "straddle", x); again = true; }
    }
  }
  // Annotations paint in array order: a lifted object is ordered by its LAST member's paint position.
  const lastPos = (e) => Math.max(...(e.members || [e.node]).map(posOf));
  const liftOrder = stack.filter((e) => !e.content && !e.pinned).sort((a, b) => lastPos(a) - lastPos(b));
  const liftedEls = liftOrder.filter((e) => e.element);

  // A lifted GIS front band is printed into the page under the editable elements it overlaps — say so, once.
  const gis = stack.find((c) => c.content === "gis" && paintShapes(c.node, clone));
  if (gis && liftedEls.length) notes.push("a map layer shown above the plan is printed into the page, so the editable site elements paint over it (turn on “Flatten markups” for the exact stacking)");

  /* Parcel acreage chips: the PARCEL's label, never a building's. One that a lifted element would cover becomes its
     own annotation at its own paint position (above the elements, as on screen); the rest stay in the page. */
  const chipEntries = [];
  for (const chip of chips) {
    const sh = paintShapes(chip, clone);
    if (!sh) continue;
    const cp = posOf(chip);
    if (liftOrder.some((e) => lastPos(e) < cp && shapesOf(e).some((m) => shapesOverlap(sh, m.shape)))) chipEntries.push({ node: chip, chip: true, pos: cp });
  }

  /* 3 — lift the rest, in paint order (chips slot in by their own position). */
  const ordered = [...liftOrder.map((e) => ({ e, pos: lastPos(e) })), ...chipEntries.map((c) => ({ e: c, pos: c.pos }))].sort((a, b) => a.pos - b.pos).map((x) => x.e);
  const linesOf = (labelNodes) => labelNodes.flatMap((n) => Array.from(n.querySelectorAll("text")).flatMap((t) => {
    const ts = Array.from(t.childNodes || []).filter((c) => c.nodeType === 1 && String(c.tagName).toLowerCase() === "tspan");
    return (ts.length > 1 ? ts : [t]).map((x) => (x.textContent || "").trim());
  }).filter(Boolean));
  for (const e of ordered) {
    if (e.chip) {
      const tree = domToTree(e.node, { measureText, patterns, root: clone });
      const text = Array.from(e.node.querySelectorAll("text")).map((t) => (t.textContent || "").trim()).filter(Boolean).join(" ");
      const pid = e.node.getAttribute("data-chip-parcel") || keyOf(e.node).id;
      e.node.parentNode.removeChild(e.node);
      descriptors.push({ family: "parcel-label", id: pid, kind: "parcel-label", tree, meta: { subject: "Parcel label", comment: text } });
      continue;
    }
    const { node, fam, id, model } = e;
    if (fam === "markup") {
      const m = model;
      const hints = {};
      if (m.kind === "cloud" && Array.isArray(m.pts) && f2p) { hints.verts = m.pts.map((p) => f2p(p)); hints.arcFt = m.arcFt; }
      const tree = domToTree(node, { measureText, patterns, root: clone });
      node.parentNode.removeChild(node);
      descriptors.push({
        family: "markup", id, kind: m.kind, tree, hints,
        meta: { subject: m.subject || MARKUP_SITE_SUBJECT[m.kind] || null, comment: m.comment || (m.inlineLabel || m.label || m.name || ""), author: m.author || null, createdAt: m.createdAt || null, modifiedAt: m.modifiedAt || null },
      });
    } else if (fam === "callout") {
      const c = model;
      const tree = domToTree(node, { measureText, patterns, root: clone });
      const lines = Array.from(node.querySelectorAll("text")).map((t) => t.textContent || "");
      node.parentNode.removeChild(node);
      const st = calloutStyle(c);
      descriptors.push({
        family: "callout", id, kind: parseInt(node.getAttribute("data-callout-leaders"), 10) > 0 ? "callout" : "textbox", tree,
        meta: { lines, align: st.align, rot: c.rot || 0, subject: c.subject || null, author: c.author || null, createdAt: c.createdAt || null, modifiedAt: c.modifiedAt || null },
      });
    } else if (fam === "measure") {
      const m = model;
      const mode = node.getAttribute("data-measure-mode") || (m && m.mode) || "line";
      const chipTexts = Array.from(node.querySelectorAll("[data-chip-text]")).map((t) => (t.textContent || "").trim()).filter(Boolean);
      const tree = domToTree(node, { measureText, patterns, root: clone });
      node.parentNode.removeChild(node);
      descriptors.push({
        family: "measure", id: (m && m.id) || String(id), kind: mode, tree,
        meta: { chipTexts, subject: null, comment: (m && m.note) || "", author: (m && m.author) || null, createdAt: (m && m.createdAt) || null, modifiedAt: (m && m.modifiedAt) || null },
      });
    } else if (e.element) {
      const el = model;
      const labelNodes = [...e.ids].flatMap((x) => labelsByEl.get(x) || []);
      const membersSorted = e.members.slice().sort((a, b) => posOf(a) - posOf(b));
      const lifted = [...membersSorted, ...labelNodes];
      const hints = {};
      const meta = { subject: elementSubject(el), author: el.author || null, createdAt: el.createdAt || null, modifiedAt: el.modifiedAt || null };
      if (e.building) {
        const bumps = bumpOutsOf(els, el);
        const outline = buildingOutlineRing(el, bumps);
        if (f2p) hints.verts = outline.ring.map((p) => f2p(p));
        if (outline.detached.length) hints.detachedBumpOuts = outline.detached.slice(); // LOUD: named, never silently outside the ring
        meta.bumpOuts = [...e.ids].filter((x) => x !== String(el.id));
      } else {
        // the outline the element DRAWS (a road network: its dissolved surface), so vertices and picture agree
        const surface = e.road ? membersSorted.find((n) => n.getAttribute("data-road-cluster") != null) : null;
        const src = surface || membersSorted.find((n) => drawnOutline(n, clone)) || membersSorted[0];
        const v = src ? drawnOutline(src, clone) : null;
        if (v && v.length >= 3) hints.verts = v;
        if (e.road) meta.roads = [...e.ids];
      }
      const kids = lifted.map((n) => domToTree(n, { measureText, patterns, root: clone })).filter(Boolean);
      const lines = linesOf(labelNodes);
      lifted.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
      meta.lines = lines;
      meta.comment = lines[0] || meta.subject; // Contents = its label (the name line), the rest rides the appearance
      descriptors.push({ family: e.building ? "building" : "element", id: e.id, kind: e.building ? "building" : (el && el.type) || "element", tree: { tag: "g", a: {}, kids }, hints, meta });
    }
  }
  return { descriptors, patterns, flattened, pinned, notes };
}
