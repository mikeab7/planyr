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
import { elCorners } from "./siteGeometry.js";
import { flattenTree, itemBBox, unionBox } from "./pdfAnnotations.js";
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
 * Returns { descriptors, patterns, flattened } — descriptors are in DOM order, which IS paint order.
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
 */
export function extractMarkupAnnotations(clone, ctx) {
  const { markups = [], callouts = [], measures = [], els = [], f2p = null, measureText = null } = ctx || {};
  const patterns = {};
  const descriptors = [];
  const flattened = [];

  const keyOf = (n) => { const k = n.getAttribute("data-feature") || ""; const i = k.indexOf(":"); return { fam: k.slice(0, i), id: k.slice(i + 1), key: k }; };
  const inFeature = (n) => { for (let p = n.parentNode; p && p.getAttribute; p = p.parentNode) if (p.getAttribute("data-feature") != null) return true; return false; };
  const buildingOf = (id) => { const e = els.find((x) => x && String(x.id) === id); return e && isBuilding(e) ? e : null; };

  /* 1 — the stack in paint order, each node classed as a lift candidate or page content. */
  const all = Array.from(clone.querySelectorAll("[data-feature],[data-overlay-id],[data-gis-front-band],[data-label-for]"));
  const labelsByEl = new Map();
  for (const n of all) { const lf = n.getAttribute("data-label-for"); if (lf != null) (labelsByEl.get(lf) || labelsByEl.set(lf, []).get(lf)).push(n); }
  const stack = [];
  const chips = []; // parcel acreage chips: laid over the plan, so a lifted building would otherwise cover them
  const seenBuilding = new Set();
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
    } else if (fam === "el" && buildingOf(id) && !seenBuilding.has(id)) {
      seenBuilding.add(id);
      stack.push({ node, fam, id, model: buildingOf(id), building: true, behind: false });
    } else stack.push({ node, content: "plan" });
  }

  /* 2 — top-down: decide which candidates stay in the page. */
  const boxCache = new Map();
  const boxOf = (e) => {
    if (!boxCache.has(e)) {
      const nodes = e.building ? [e.node, ...(labelsByEl.get(e.id) || [])] : [e.node];
      const boxes = nodes.map((n) => paintBox(n, clone));
      boxCache.set(e, boxes.includes(ALL) ? ALL : unionBox(boxes));
    }
    return boxCache.get(e);
  };
  const covering = []; // everything stacked above the current position that STAYS in the page
  for (let i = stack.length - 1; i >= 0; i--) {
    const e = stack[i];
    if (e.content) { covering.push(e); continue; }
    let pin = e.annot && e.behind;
    if (!pin && covering.length) {
      const mine = boxOf(e);
      if (mine) pin = covering.some((c) => {
        const counts = c.content === "plan" || c.pinned || (e.building && (c.content === "reference" || c.content === "gis"));
        if (!counts) return false;
        const theirs = boxOf(c);
        return !!theirs && overlaps(mine, theirs);
      });
    }
    if (pin) { e.pinned = true; covering.push(e); flattened.push(e.node.getAttribute("data-feature")); }
  }

  /* A parcel's acreage chip paints above the buildings on screen, but a lifted building paints above the whole
     page. So a chip that overlaps a lifted building travels INSIDE that building's appearance (the topmost one it
     overlaps) and leaves the page — the default export then looks exactly like the flattened one. (Move the
     building and its chip moves with it; that is the one cosmetic cost, stated in the PR.) */
  const chipsOf = new Map();
  for (const chip of chips) {
    let owner = null;
    const cb = paintBox(chip, clone);
    if (!cb) continue;
    for (const e of stack) {
      if (!e.building || e.pinned) continue;
      if (all.indexOf(chip) < all.indexOf(e.node)) continue; // only a chip that paints after the building
      const b = boxOf(e);
      if (b && overlaps(cb, b)) owner = e;
    }
    if (owner) (chipsOf.get(owner) || chipsOf.set(owner, []).get(owner)).push(chip);
  }

  /* 3 — lift the rest, in DOM order. */
  for (const e of stack) {
    if (e.content || e.pinned) continue;
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
      const ring = el.points && el.points.length >= 3 ? el.points : elCorners(el);
      const hints = f2p ? { verts: ring.map((p) => f2p(p)) } : {};
      const labelNodes = labelsByEl.get(id) || [];
      const carried = chipsOf.get(e) || [];
      const kids = [node, ...labelNodes, ...carried].map((n) => domToTree(n, { measureText, patterns, root: clone })).filter(Boolean);
      const lines = labelNodes.flatMap((n) => Array.from(n.querySelectorAll("text")).map((t) => (t.textContent || "").trim()).filter(Boolean));
      [node, ...labelNodes, ...carried].forEach((n) => n.parentNode && n.parentNode.removeChild(n));
      descriptors.push({
        family: "building", id, kind: "building", hints, tree: { tag: "g", a: {}, kids },
        meta: { lines, subject: "Building", comment: lines[0] || "", author: el.author || null, createdAt: el.createdAt || null, modifiedAt: el.modifiedAt || null },
      });
    }
  }
  return { descriptors, patterns, flattened };
}

