/* HOW A COUNTIES & CITIES FEATURE IS PAINTED (NEW-1, owner 2026-11-05). Pure — no Leaflet, no DOM.
 *
 * One home for "what colour / weight / dash / tint is THIS feature", shared by the live map layer (`vectorOverlay.js`) and the printed sheet (`exportSheet.js`), so the screen
 * and the PDF cannot drift (PDF-PARITY).
 *   • a CITY gets its own hue from PLACE_PALETTE; its ETJ gets the SAME hue (the key strips " ETJ"), so a city and its ETJ read as one place;
 *   • two places whose polygons come near each other never share a hue while a free one exists (`createColorBook`);
 *   • a place keeps its hue for the whole session (the book remembers), so panning never re-colours a city;
 *   • limits are the bold solid line with the stronger tint, ETJ the thinner dashed line with the fainter tint. */
import { PLACE_PALETTE, ETJ_LINE_WEIGHT, ETJ_LINE_DASH, ETJ_TINT_OPACITY, CITY_TINT_OPACITY, CITY_LINE_MIN_WEIGHT, BOUNDARY_FALLBACK_INK } from "./boundaryStyle.js";

/* The key a place is coloured by: "City of Sugar Land", "SUGAR LAND", "Sugar Land ETJ" → "sugar land". */
export const placeKey = (name) => String(name == null ? "" : name).toLowerCase()
  .replace(/\s+/g, " ").replace(/^city of\s+/, "").replace(/\s*(—|-)?\s*(etj|city limits)\s*$/, "").replace(/\s*\(.*\)\s*$/, "").trim();

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const ringsOf = (g) => !g ? [] : g.type === "Polygon" ? (g.coordinates || []) : g.type === "MultiPolygon" ? (g.coordinates || []).flat() : [];
const bboxCache = new WeakMap();
/* [w, s, e, n] of a geometry, cached on the geometry object. */
export function geometryBox(g) {
  if (!g) return null;
  const hit = bboxCache.get(g);
  if (hit) return hit;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of ringsOf(g)) for (const p of ring) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }
  const box = isFinite(w) ? [w, s, e, n] : null;
  if (box) bboxCache.set(g, box);
  return box;
}
const near = (a, b, eps) => a && b && a[0] <= b[2] + eps && b[0] <= a[2] + eps && a[1] <= b[3] + eps && b[1] <= a[3] + eps;

/* A colour book: remembers every place it has coloured. `assign(items)` takes [{ key, box }] and gives each NEW key the hue its hash prefers unless a place whose box
 * comes near it already holds that hue, then the next free one; if every hue is taken nearby, the least-used among the neighbours. Existing keys are never changed. */
export function createColorBook(palette = PLACE_PALETTE, eps = 0.01) {
  const held = new Map(); // key → { idx, box }
  const assign = (items) => {
    const fresh = (items || []).filter((it) => it && it.key && !held.has(it.key)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const it of fresh) {
      const used = new Array(palette.length).fill(0);
      for (const h of held.values()) if (near(h.box, it.box, eps)) used[h.idx]++;
      const pref = hash(it.key) % palette.length;
      let pick = -1;
      for (let k = 0; k < palette.length; k++) { const i = (pref + k) % palette.length; if (!used[i]) { pick = i; break; } }
      if (pick < 0) { let best = Infinity; for (let k = 0; k < palette.length; k++) { const i = (pref + k) % palette.length; if (used[i] < best) { best = used[i]; pick = i; } } }
      held.set(it.key, { idx: pick, box: it.box });
    }
  };
  return {
    assign,
    colorOf: (key) => { const h = held.get(key); return h ? palette[h.idx] : null; },
    size: () => held.size,
    clear: () => held.clear(),
  };
}
/* The page-wide book: a city's hue is the same on the limits layer, the ETJ layer, the Map and the planner, for the whole session. */
export const sharedColorBook = createColorBook();

/* Give every named feature of a collection a hue (idempotent). `nameOf(feature)` → the place name. */
export function colorFeatures(fc, nameOf, book = sharedColorBook) {
  const items = [];
  for (const f of (fc && fc.features) || []) {
    const key = placeKey(nameOf(f));
    if (key) items.push({ key, box: geometryBox(f.geometry) });
  }
  book.assign(items);
}

/* The paint for one feature of the CITY-LIMITS or ETJ layer. Returns the style plain-object (Leaflet path options + the print emitter read the same fields). */
export function placeStyle(kind, name, { opacity = 1, book = sharedColorBook, fallbackInk = BOUNDARY_FALLBACK_INK } = {}) {
  const color = book.colorOf(placeKey(name)) || fallbackInk;
  if (kind === "etj") return { color, weight: ETJ_LINE_WEIGHT, opacity, dashArray: ETJ_LINE_DASH, fillColor: color, fillOpacity: ETJ_TINT_OPACITY };
  return { color, weight: CITY_LINE_MIN_WEIGHT, opacity, fillColor: color, fillOpacity: CITY_TINT_OPACITY };
}
