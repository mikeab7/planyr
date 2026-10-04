/* lib/parcelLotNumbers.js — NEW-1 (owner decision 2026-10-04): Planyr draws the lot NUMBERS.
 *
 * WHY. A county's own /export picture carried its own labels baked into the image (Chambers drew
 * '1532567588' west of the pond), so the map showed the county's number, in the county's place,
 * colliding with Planyr's own "Parcel 19" chip. Planyr now owns outlines AND numbers in every
 * county: this module is the pure half of the number layer — which attribute is the number,
 * what it reads as, and where each one goes. `parcelLotLabelLayer.js` is the Leaflet half.
 *
 * Pure (no Leaflet, no DOM) so a plain Node test can prove the placement rules. */
import { layoutLabelsSolve } from "./labelLayout.js";
import { interiorFitter } from "./labelFitLadder.js";

export const LOT_NO_FONT_PX = 11;
const LOT_NO_PAD_X = 4;   // breathing room either side of the text inside its own box
const LOT_NO_GAP_PX = 3;  // minimum clear space between two numbers / a number and a chip
export const LOT_NO_MAX_LABELS = 600; // bounded DOM: a dense view thins out, it never piles up

const bare = (name) => String(name || "").split(".").pop().toLowerCase();

/** The layer's exact field name for a config hint, or null.
 *  Joined CAD layers (Chambers) publish table-PREFIXED names (`ChambersCADWeb.DBO.Accounts.Account`),
 *  so a bare hint (`Account`) matches a field whose LAST dotted segment equals it. An exact
 *  (case-insensitive) match always wins. `fields` is the layer metadata's `fields` array. */
export function resolveLotNumberField(fields, hint) {
  if (!hint || !Array.isArray(fields)) return null;
  const want = String(hint).toLowerCase();
  const names = fields.map((f) => (f && f.name) || "").filter(Boolean);
  const exact = names.find((n) => n.toLowerCase() === want);
  if (exact) return exact;
  const tail = names.find((n) => bare(n) === bare(hint));
  return tail || null;
}

/** What a feature's number reads as, or "" when it has none worth drawing.
 *  `field` is the resolved field name; a prefixed/unprefixed spelling difference between metadata
 *  and the returned attributes is tolerated. null/blank/0 (a CAD's "no account" placeholder) → "". */
export function lotNumberText(props, field) {
  if (!props || typeof props !== "object" || !field) return "";
  let v = props[field];
  if (v === undefined) {
    const want = field.toLowerCase();
    const k = Object.keys(props).find((x) => x.toLowerCase() === want) || Object.keys(props).find((x) => bare(x) === bare(field));
    v = k === undefined ? undefined : props[k];
  }
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s === "0" || /^(null|<null>|none|n\/a|undefined)$/i.test(s)) return "";
  return s.length > 40 ? s.slice(0, 40) : s;
}

const ringBox = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

/** Clip a ring ([{x,y}]) to an axis-aligned rect {x0,y0,x1,y1} (Sutherland–Hodgman). A lot bigger than the
 *  screen is laid out against the part of it you can SEE — otherwise its number would be placed at the
 *  lot's own centre, which can be off-screen. Returns null when nothing of the ring is inside. Pure. */
export function clipRingToRect(ring, rect) {
  const edges = [
    [(p) => p.x >= rect.x0, (a, b) => ({ x: rect.x0, y: a.y + ((b.y - a.y) * (rect.x0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= rect.x1, (a, b) => ({ x: rect.x1, y: a.y + ((b.y - a.y) * (rect.x1 - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= rect.y0, (a, b) => ({ x: a.x + ((b.x - a.x) * (rect.y0 - a.y)) / (b.y - a.y), y: rect.y0 })],
    [(p) => p.y <= rect.y1, (a, b) => ({ x: a.x + ((b.x - a.x) * (rect.y1 - a.y)) / (b.y - a.y), y: rect.y1 })],
  ];
  let pts = ring;
  for (const [inside, cross] of edges) {
    if (!pts.length) return null;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cross(prev, cur));
    }
    pts = out;
  }
  return pts.length >= 3 ? pts : null;
}

/** Place the lot numbers for one view.
 *    lots      [{ id, text, ring }] — `ring` = the lot's OUTER ring as [{x,y}] in WORLD PIXELS at the
 *              current zoom (pan-independent, so the interior fit is cached per ring).
 *    origin    {x,y} — the world-pixel point that sits at container (0,0).
 *    measure   (text, fontPx) => px width.
 *    obstacles container-pixel boxes {x,y,w,h} that a number must clear (the Site planner's own
 *              parcel chips) — the same pre-committed-box mechanism B951 gave the acreage badges.
 *  Returns [{ id, text, x, y, w, h }] — CENTRE x/y in container pixels. A number that cannot be
 *  placed INSIDE its own lot without touching another number or an obstacle is OMITTED, never
 *  leadered out and never overprinted: hiding is the contract. */
export function layoutLotNumbers({ lots, origin, measure, fontPx = LOT_NO_FONT_PX, obstacles = [], maxLabels = LOT_NO_MAX_LABELS }) {
  const lh = Math.ceil(fontPx * 1.25);
  const items = [];
  const byId = new Map();
  for (const lot of lots || []) {
    if (!lot || !lot.text || !Array.isArray(lot.ring) || lot.ring.length < 3) continue;
    const b = ringBox(lot.ring);
    const w = Math.ceil(measure(lot.text, fontPx)) + LOT_NO_PAD_X;
    if (!(b.w >= w) || !(b.h >= lh)) continue;            // cheap reject: the lot's bbox cannot hold it
    const fitter = interiorFitter(lot.ring);
    if (!fitter || !fitter.place(w, lh)) continue;        // the real interior cannot hold it either
    byId.set(lot.id, { text: lot.text, w, h: lh });
    items.push({
      id: lot.id, cx: 0, cy: 0, lines: [lot.text], lh, charW: fontPx * 0.68, textW: { [lot.text]: w },
      halfW: b.w / 2, halfH: b.h / 2, importance: b.w * b.h,   // the bigger lot keeps its number when two compete
      ring: lot.ring, ringOrigin: origin, ringPpf: 1,
    });
  }
  items.sort((p, q) => (q.importance - p.importance) || (String(p.id) < String(q.id) ? -1 : 1));
  const solved = layoutLabelsSolve(items.slice(0, maxLabels), { pad: LOT_NO_GAP_PX, obstacles });
  const out = [];
  solved.forEach((pl, id) => {
    if (pl.leader || pl.rung === "outside") return; // never a connector: a number lives inside its lot or not at all
    const m = byId.get(id);
    if (m) out.push({ id, text: m.text, x: pl.x, y: pl.y, w: m.w, h: m.h });
  });
  return out;
}
