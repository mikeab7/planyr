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

/**
 * Lift the annotation-class features out of `clone` (mutates it) and describe them.
 *
 *   ctx = { markups, callouts, measures, f2p, measureText }
 *
 * Returns { descriptors, patterns } — descriptors are in DOM order, which IS paint order.
 */
export function extractMarkupAnnotations(clone, ctx) {
  const { markups = [], callouts = [], measures = [], f2p = null, measureText = null } = ctx || {};
  const patterns = {};
  const descriptors = [];
  const nodes = Array.from(clone.querySelectorAll("[data-feature]"));
  for (const node of nodes) {
    const key = node.getAttribute("data-feature") || "";
    const colon = key.indexOf(":");
    const family = key.slice(0, colon), id = key.slice(colon + 1);
    if (family === "markup") {
      const m = markups.find((x) => x && String(x.id) === id);
      if (!m || !ANNOTATION_KINDS.includes(m.kind)) continue; // easement / encumbrance / utility routes stay on the page
      const hints = {};
      if (m.kind === "cloud" && Array.isArray(m.pts) && f2p) { hints.verts = m.pts.map((p) => f2p(p)); hints.arcFt = m.arcFt; }
      const tree = domToTree(node, { measureText, patterns, root: clone });
      node.parentNode.removeChild(node);
      descriptors.push({
        family: "markup", id, kind: m.kind, tree, hints,
        meta: { subject: m.subject || null, comment: m.comment || (m.inlineLabel || m.label || ""), author: m.author || null, createdAt: m.createdAt || null, modifiedAt: m.modifiedAt || null },
      });
    } else if (family === "callout") {
      const c = callouts.find((x) => x && String(x.id) === id);
      if (!c) continue;
      const tree = domToTree(node, { measureText, patterns, root: clone });
      const lines = Array.from(node.querySelectorAll("text")).map((t) => t.textContent || "");
      node.parentNode.removeChild(node);
      const st = calloutStyle(c);
      descriptors.push({
        family: "callout", id, kind: parseInt(node.getAttribute("data-callout-leaders"), 10) > 0 ? "callout" : "textbox", tree,
        meta: { lines, align: st.align, rot: c.rot || 0, subject: c.subject || null, author: c.author || null, createdAt: c.createdAt || null, modifiedAt: c.modifiedAt || null },
      });
    } else if (family === "measure") {
      const idx = parseInt(id, 10);
      const m = Number.isFinite(idx) ? measures[idx] : null;
      const mode = node.getAttribute("data-measure-mode") || (m && m.mode) || "line";
      const chipTexts = Array.from(node.querySelectorAll("[data-chip-text]")).map((t) => (t.textContent || "").trim()).filter(Boolean);
      const tree = domToTree(node, { measureText, patterns, root: clone });
      node.parentNode.removeChild(node);
      descriptors.push({
        family: "measure", id: (m && m.id) || String(idx), kind: mode, tree,
        meta: { chipTexts, subject: null, comment: (m && m.note) || "", author: (m && m.author) || null, createdAt: (m && m.createdAt) || null, modifiedAt: (m && m.modifiedAt) || null },
      });
    }
  }
  return { descriptors, patterns };
}
