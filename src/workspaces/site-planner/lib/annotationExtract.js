/* annotationExtract — the DOM half of the "editable markups" PDF export (NEW-1, 2026-10-05).
 *
 * Takes the CLONED plan <svg> that buildExportSvg produced (so every print retarget — stroke
 * weights, label sizes, hidden groups — has already been applied), lifts each ANNOTATION markup /
 * callout / measurement node OUT of the page content, and returns a descriptor per object for
 * `pdfAnnotations.buildAnnotations`. What it removes is exactly what the flattened export would have
 * painted, so the picture and the annotations can never describe two different drawings.
 *
 * Only the neutral drawing markups (line · polyline · rect · ellipse · polygon · cloud), callouts /
 * text boxes and measurements move. Easements, encumbrances and utility routes are SITE DATA that
 * happen to live in the `markups` array — they stay as page content, like parcels and buildings.
 *
 * `domToTree` is the one place that touches the DOM, so the converter in pdfAnnotations.js stays
 * pure and unit-testable in plain node.
 */
import { ANNOTATION_KINDS } from "./siteModel.js";
import { isBuilding } from "../../../shared/projects/projectModel.js";
import { flattenTree, itemBBox, unionBox } from "./pdfAnnotations.js";
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
/* Two flush neighbours (a truck court against its building, a bump-out on its wall) share an edge, and the half-unit
   fringe itemBBox adds to a box would read that as an overlap. Real covering is deeper than a hairline. */
const OVERLAP_TOL = 1.5;
const overlaps = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > OVERLAP_TOL && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > OVERLAP_TOL;

/** `<image>` has no ink in flattenTree (its draw is the raster); for a bounding box it is just its rect. */
function imagesAsRects(t) {
  if (!t) return t;
  if (t.tag === "image") return { ...t, tag: "rect", a: { ...t.a, fill: "black", stroke: "none" }, kids: [] };
  return { ...t, kids: (t.kids || []).map(imagesAsRects) };
}

/** Plan-space (clone user units) box of everything `node` paints; null when it paints nothing; ALL when it can't be told. */
function paintBox(node, root) {
  try {
    const tree = imagesAsRects(domToTree(node, { root }));
    const { items } = flattenTree(tree, IDENT, {});
    return unionBox(items.map((it) => (it.t === "path" ? itemBBox({ ...it, stroke: null, sw: 0 }) : itemBBox(it)))); // the fill geometry, not its stroke fringe
  } catch (_) { return ALL; } // unknown extent = assume it overlaps (keeps the safe, flattened answer)
}

/**
 * Lift the annotation-class features out of `clone` (mutates it) and describe them.
 *
 *   ctx = { markups, callouts, measures, els, f2p, measureText }
 *
 * Returns { descriptors, patterns, flattened } — descriptors are in paint order (each object at its last member's
 * position in the page), which is the order the annotations are written in.
 *
 * WHICH OBJECTS STAY IN THE PAGE (NEW-1 of 2026-10-19, replacing "everything that precedes the last content node"):
 * a PDF annotation always paints above the page, so an object may be lifted only if nothing that stays in
 * the page is meant to paint over it. Walking the stack top-down:
 *   · an annotation the user sent BEHIND THE PLAN (the `behindEls` band, ladder rungs 2–4) is pinned, always;
 *   · any other annotation is pinned only when page content that paints AFTER it genuinely overlaps it in
 *     plan space — a later element, a later easement/encumbrance line, or an annotation already pinned.
 *     A promoted reference drawing or a lifted GIS layer does NOT pin an annotation (decision: those are
 *     thin overlays the user put over the plan on purpose; "anything under a transparent overlay is burned
 *     in" was never the intent of the behind-the-plan rule), and an empty `data-gis-front-band` is not content;
 *   · a BUILDING (NEW-2) is held to the stricter bar of the flattened picture: any later content that
 *     overlaps it — including a reference drawing or GIS layer — keeps it in the page, so the editable
 *     export looks identical to the flattened one.
 * Parcel outlines/chips and element LABELS are thin linework laid over the plan and never pin (stated deviation).
 *
 * A BUILDING AND ITS CORNER BUMP-OUTS ARE ONE ANNOTATION (NEW-1 of 2026-10-19, amending NEW-2). A bump-out is its
 * own element on the canvas (`dogEar`, `attachedTo` the host — lib/dogEar.js) and so its own `el:` node in the
 * clone; left as page content it stayed behind when a recipient dragged the building in Bluebeam. It is therefore a
 * MEMBER of its host's entry here (the grading layer's pad-member rule, `bumpOutsOf`): the entry sits at the first
 * member's paint position, its box is the union of every member (so later content over a bump-out pins the whole
 * building, and a chip over a bump-out travels with it), every member node leaves the page together, and the
 * Polygon's vertices are the one outline `buildingOutlineRing` draws through host and bump-outs alike.
 */
export function extractMarkupAnnotations(clone, ctx) {
  const { markups = [], callouts = [], measures = [], els = [], f2p = null, measureText = null } = ctx || {};
  const patterns = {};
  const descriptors = [];
  const flattened = [];

  const keyOf = (n) => { const k = n.getAttribute("data-feature") || ""; const i = k.indexOf(":"); return { fam: k.slice(0, i), id: k.slice(i + 1), key: k }; };
  const inFeature = (n) => { for (let p = n.parentNode; p && p.getAttribute; p = p.parentNode) if (p.getAttribute("data-feature") != null) return true; return false; };
  const buildingOf = (id) => { const e = els.find((x) => x && String(x.id) === id); return e && isBuilding(e) ? e : null; };
  // bump-out id → its host building (only for a host that is itself a liftable building in `els`)
  const bumpHostOf = new Map();
  for (const e of els) if (isBuilding(e)) for (const b of bumpOutsOf(els, e)) bumpHostOf.set(String(b.id), e);

  /* 1 — the stack in paint order, each node classed as a lift candidate or page content. */
  const all = Array.from(clone.querySelectorAll("[data-feature],[data-overlay-id],[data-gis-front-band],[data-label-for]"));
  const labelsByEl = new Map();
  for (const n of all) { const lf = n.getAttribute("data-label-for"); if (lf != null) (labelsByEl.get(lf) || labelsByEl.set(lf, []).get(lf)).push(n); }
  const stack = [];
  const chips = []; // parcel acreage chips: laid over the plan, so a lifted building would otherwise cover them
  const seenBuilding = new Set();
  /* A building's MEMBERS: its own node plus every bump-out node bonded to it. One pass over the stack groups them
     by host (a bump-out whose host is not a liftable building here is ordinary page content below). */
  const hostNodeOf = new Map(), bumpNodesOf = new Map();
  for (const n of all) {
    if (n.getAttribute("data-label-for") != null || n.getAttribute("data-feature") == null) continue;
    const { fam, id } = keyOf(n);
    if (fam !== "el") continue;
    const bumpHost = bumpHostOf.get(id);
    if (bumpHost) (bumpNodesOf.get(String(bumpHost.id)) || bumpNodesOf.set(String(bumpHost.id), []).get(String(bumpHost.id))).push(n);
    else if (buildingOf(id) && !hostNodeOf.has(id)) hostNodeOf.set(id, n);
  }
  // Push the host's ONE entry the first time any member is met, so it sits at the first member's paint position.
  const pushBuilding = (hostId) => {
    const host = buildingOf(hostId), node = hostNodeOf.get(hostId);
    if (!host || !node || seenBuilding.has(hostId)) return;
    seenBuilding.add(hostId);
    const bumpNodes = bumpNodesOf.get(hostId) || [];
    stack.push({ node, fam: "el", id: hostId, model: host, building: true, behind: false, bumpNodes, members: [node, ...bumpNodes].sort((a, b) => all.indexOf(a) - all.indexOf(b)) });
  };
  for (const node of all) {
    if (node.getAttribute("data-label-for") != null) continue; // owned by its element (lifted or kept with it)
    if (node.getAttribute("data-gis-front-band") != null) { stack.push({ node, content: "gis" }); continue; }
    if (node.getAttribute("data-feature") == null) { if (!inFeature(node)) stack.push({ node, content: "reference" }); continue; }
    const { fam, id } = keyOf(node);
    if (fam === "parcel") { if (node.getAttribute("data-print-chip") != null) chips.push(node); continue; }
    if (fam === "reference") { stack.push({ node, content: "reference" }); continue; }
    if (fam === "markup") {
      const m = markups.find((x) => x && String(x.id) === id);
      if (m && ANNOTATION_KINDS.includes(m.kind)) stack.push({ node, fam, id, model: m, annot: true, behind: m.behindEls === true });
      else stack.push({ node, content: "plan" });
    } else if (fam === "callout") {
      const c = callouts.find((x) => x && String(x.id) === id);
      if (c) stack.push({ node, fam, id, model: c, annot: true, behind: c.behindEls === true && c.frontForce !== true });
    } else if (fam === "measure") {
      const idx = parseInt(id, 10);
      const m = Number.isFinite(idx) ? measures[idx] : null;
      stack.push({ node, fam, id, model: m, annot: true, behind: !!(m && m.behindEls === true) });
    } else if (fam === "el" && bumpHostOf.has(id)) {
      const hostId = String(bumpHostOf.get(id).id);
      if (hostNodeOf.has(hostId)) pushBuilding(hostId); // a member: the host's entry starts at the first member's position
      else stack.push({ node, content: "plan" });       // host not drawn: the bump-out is ordinary page content
    } else if (fam === "el" && buildingOf(id)) {
      pushBuilding(id);
    } else stack.push({ node, content: "plan" });
  }

  /* 2 — decide which candidates stay in the page. Every candidate is a set of (box, paint position) pairs — a
     building's are its host, its bump-outs and its labels, each at ITS OWN position; judging a building by one
     bounding box would let a truck court, which sits exactly in the notch between two bump-outs, "cover" it, and
     judging it at one position would let a markup painted between a bump-out and its host pin or free the whole
     building wrongly. A candidate is pinned when some box of something that stays in the page paints AFTER one of
     its boxes and overlaps it. Pins only ever accumulate, so this runs to a fixpoint (a building whose members
     straddle another candidate is seen whichever order the stack puts them in). */
  const posOf = (n) => all.indexOf(n);
  const boxCache = new Map();
  const boxesOf = (e) => {
    if (!boxCache.has(e)) {
      const nodes = e.building ? [...e.members, ...(labelsByEl.get(e.id) || [])] : [e.node];
      boxCache.set(e, nodes.map((n) => ({ box: paintBox(n, clone), pos: posOf(n) })).filter((b) => b.box));
    }
    return boxCache.get(e);
  };
  const coveredBy = (e, c) => {
    const counts = c.content === "plan" || c.pinned || (e.building && (c.content === "reference" || c.content === "gis"));
    if (!counts) return false;
    const mine = boxesOf(e), theirs = boxesOf(c);
    return mine.some((m) => theirs.some((t) => t.pos > m.pos && overlaps(m.box, t.box)));
  };
  // X must paint UNDER Y when some box of Y paints after an overlapping box of X (the page's own order).
  const under = (x, y) => boxesOf(x).some((m) => boxesOf(y).some((t) => t.pos > m.pos && overlaps(m.box, t.box)));
  const pinIt = (e) => { e.pinned = true; flattened.push(e.node.getAttribute("data-feature")); };
  for (let again = true; again;) {
    for (let changed = true; changed;) {
      changed = false;
      for (let i = stack.length - 1; i >= 0; i--) {
        const e = stack[i];
        if (e.content || e.pinned) continue;
        if ((e.annot && e.behind) || stack.some((c) => c !== e && (c.content || c.pinned) && coveredBy(e, c))) { pinIt(e); changed = true; }
      }
    }
    /* Two lifted objects whose members straddle each other (building A's bump-out painted over building B's host,
       B's host over A's host) have NO annotation order that reproduces the page: both stay in it. Pinning them can
       pin others, so the pass above runs again. Only buildings can straddle (every other candidate paints in its
       own band), so this is a building-against-building question in practice. */
    again = false;
    const lifted = stack.filter((e) => !e.content && !e.pinned);
    for (let a = 0; a < lifted.length; a++) for (let b = a + 1; b < lifted.length; b++) {
      const x = lifted[a], y = lifted[b];
      if (!x.pinned && !y.pinned && under(x, y) && under(y, x)) { pinIt(x); pinIt(y); again = true; }
    }
  }
  // Annotations paint in array order, so a lifted object is ordered by its LAST member's paint position: a
  // building whose bump-out paints over a neighbour's host then lands above that neighbour, as on the page.
  const lastPos = (e) => Math.max(...boxesOf(e).map((b) => b.pos), posOf(e.node));
  const liftOrder = stack.filter((e) => !e.content && !e.pinned).sort((a, b) => lastPos(a) - lastPos(b));

  /* A parcel's acreage chip paints above the buildings on screen, but a lifted building paints above the whole
     page. So a chip that overlaps a lifted building travels INSIDE that building's appearance (the topmost one it
     overlaps) and leaves the page — the default export then looks exactly like the flattened one. (Move the
     building and its chip moves with it; that is the one cosmetic cost, stated in the PR.) */
  const chipsOf = new Map();
  for (const chip of chips) {
    let owner = null;
    const cb = paintBox(chip, clone), cp = posOf(chip);
    if (!cb) continue;
    for (const e of stack) {
      if (!e.building || e.pinned) continue;
      if (boxesOf(e).some((m) => m.pos < cp && overlaps(cb, m.box))) owner = e; // only a chip that paints after the member it covers
    }
    if (owner) (chipsOf.get(owner) || chipsOf.set(owner, []).get(owner)).push(chip);
  }

  /* 3 — lift the rest, in paint order. */
  for (const e of liftOrder) {
    const { node, fam, id, model } = e;
    if (fam === "markup") {
      const m = model;
      const hints = {};
      if (m.kind === "cloud" && Array.isArray(m.pts) && f2p) { hints.verts = m.pts.map((p) => f2p(p)); hints.arcFt = m.arcFt; }
      const tree = domToTree(node, { measureText, patterns, root: clone });
      node.parentNode.removeChild(node);
      descriptors.push({
        family: "markup", id, kind: m.kind, tree, hints,
        meta: { subject: m.subject || null, comment: m.comment || (m.inlineLabel || m.label || ""), author: m.author || null, createdAt: m.createdAt || null, modifiedAt: m.modifiedAt || null },
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
    } else if (e.building) {
      const el = model;
      const bumps = bumpOutsOf(els, el);
      const outline = buildingOutlineRing(el, bumps);
      const hints = f2p ? { verts: outline.ring.map((p) => f2p(p)) } : {};
      if (outline.detached.length) hints.detachedBumpOuts = outline.detached.slice(); // LOUD: named, never silently outside the ring
      const labelNodes = labelsByEl.get(id) || [];
      const carried = chipsOf.get(e) || [];
      const lifted = [...e.members, ...labelNodes, ...carried];
      const kids = lifted.map((n) => domToTree(n, { measureText, patterns, root: clone })).filter(Boolean);
      const lines = labelNodes.flatMap((n) => Array.from(n.querySelectorAll("text")).flatMap((t) => {
        const ts = Array.from(t.childNodes || []).filter((c) => c.nodeType === 1 && String(c.tagName).toLowerCase() === "tspan");
        return (ts.length > 1 ? ts : [t]).map((x) => (x.textContent || "").trim());
      }).filter(Boolean));
      lifted.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
      void node;
      descriptors.push({
        family: "building", id, kind: "building", hints, tree: { tag: "g", a: {}, kids },
        meta: { lines, subject: "Building", comment: lines[0] || "", bumpOuts: e.bumpNodes.map((n) => keyOf(n).id), author: el.author || null, createdAt: el.createdAt || null, modifiedAt: el.modifiedAt || null },
      });
    }
  }
  return { descriptors, patterns, flattened };
}

