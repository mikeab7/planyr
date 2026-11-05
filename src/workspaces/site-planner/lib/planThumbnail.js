/* planThumbnail — a pure, DOM-free SVG-string render of a plan's drawn geometry, built for the
 * Dashboard's "Recent plans" thumbnail card (NEW-1, 2026-09-08). Given only a plan model (no live
 * app state — no React tree, no Leaflet map, no mounted canvas), so it can run right after a save
 * (site-planner/lib/siteThumbnail.js) or lazily from the Dashboard (which dynamic-imports this
 * module — see dashboard/lib/recentPlansThumbnails.js — so it never rides that workspace's own
 * bundle).
 *
 * Deliberately NOT the real export pipeline (exportSheet.js): that clones the LIVE mounted <svg>
 * and needs a rendered canvas + Leaflet instance. This instead reuses the same pure geometry
 * primitives the canvas and the export pipeline are both built on — elToRingFeet + the TYPE style
 * palette (planStyle.js) — so a thumbnail is a real render of the boundary plus every drawn
 * element (building, paving/truck-court, parking, trailer, pond, sidewalk, landscape, road),
 * painted in the same z-order the canvas uses and in the app's own TYPE colors — never an icon,
 * a placeholder, or a generic shape.
 *
 * ⛔ TWO HARD RULES THIS FILE EXISTS UNDER (B<PENDING>, 2026-09-08). Both were defects here first,
 * both are now guarded in test/planThumbnail.test.js:
 *
 * 1. **A THUMBNAIL HAS A CEILING.** It is a ~180px picture in a dashboard card, and FOUR of them
 *    load on every visit. Before this, output scaled linearly and without limit with how much is
 *    drawn — a busy plan measured 185 KB at 300 elements x 40 vertices and 380 KB at 600 x 40,
 *    which is half a megabyte of data-URI for four postage stamps. Size is now bounded by
 *    `MAX_SVG_BYTES` regardless of plan complexity, via `simplifyRing` (Ramer-Douglas-Peucker in
 *    VIEW space, so the tolerance is stated in units of the picture actually shown, never in feet)
 *    and, only if that is not enough, by dropping the smallest-area elements last. The FIRST
 *    tolerance is set BELOW the visible resolution of the rendered thumbnail, so an ordinary plan
 *    is simplified imperceptibly and no escalation ever runs; `MAX_DEVIATION_UNITS` is asserted
 *    against the ORIGINAL rings in test, so "it still looks like itself" is a measured property
 *    and not a hope.
 *
 * 2. **EVERY INTERPOLATED VALUE IS ESCAPED.** `stroke`/`fill`/`fill-opacity` come off the user's
 *    own model (a parcel's chosen colors, a style override) and were written raw into attributes.
 *    A single `"` in one of them closes its attribute early and the rest of the string is parsed
 *    as markup — the drawing corrupts. Not a script-execution hole (the result is displayed via
 *    `<img src="data:image/svg+xml,...">`, where SVG scripting does not run) but a real rendering
 *    break, and the fix is the same either way: `xmlAttr()` on every interpolation, no exceptions.
 *
 * Output is an SVG string on a fixed 4:3 viewBox, content CONTAIN-fit (padded, centered, aspect
 * preserved — never stretched) with a transparent background, so it drops straight into an
 * `<img src="data:image/svg+xml,...">` over whatever panel/theme surrounds it. Being vector text
 * (not a raster), it stays crisp at any thumbnail size the dashboard renders it at.
 */
import { parcelsOf, elementsOf } from "./siteModel.js";
import { elToRingFeet, TYPE, elStyle, byZ } from "./planStyle.js";
import { sortElsForPaint } from "./trailerOverRoads.js"; // NEW-1 (2026-11-05) — trailer parking always draws above roads, same as the canvas

const VB_W = 400, VB_H = 300; // 4:3 — arbitrary viewBox units; vector output scales to any render size
const PAD_FRAC = 0.07;
const BOUNDARY_STROKE = "#6b6558";

/* The ceiling, and the reasoning for each number.
 *
 * A thumbnail renders at roughly 180 CSS px wide against a 400-unit viewBox, so one viewBox unit
 * is under half a rendered pixel: geometry detail finer than ~1 unit cannot survive rasterization
 * at that size on any display. BASE_TOLERANCE_UNITS sits well under that, so the default pass is
 * imperceptible by construction rather than by taste (PERCEPTUAL-PARITY's bar, applied to the one
 * surface where the render size is fixed and known). MAX_DEVIATION_UNITS is the hard promise the
 * escalation ladder may never break, and is what test/planThumbnail.test.js measures.
 *
 * COORD_DP: at 1 decimal place a coordinate is quantized to a tenth of a unit — an order of
 * magnitude finer than the tolerance above it, and it roughly halves the byte cost of a path. */
const MAX_SVG_BYTES = 24 * 1024;
const BASE_TOLERANCE_UNITS = 0.30;
const MAX_DEVIATION_UNITS = 1.5;
const COORD_DP = 1;
const MIN_RING_EXTENT_UNITS = 0.6; // a ring whose whole bbox is under this cannot be seen at all

const roundCoord = (n) => Math.round(n * 10 ** COORD_DP) / 10 ** COORD_DP;
const finitePt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** XML attribute-value escaping. Every interpolation into the output goes through this — see rule
 * 2 in this file's header. `&` first, or the escapes below would be double-escaped. */
function xmlAttr(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Perpendicular distance from `p` to the segment `a`-`b`. */
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker on an OPEN polyline. Iterative (an explicit stack, never recursion): a
 * surveyed ring can carry thousands of vertices and this runs on the main thread right after a
 * save. Guarantees every dropped vertex lies within `tol` of the kept outline — which is exactly
 * the deviation bound the header promises. */
function rdp(points, tol) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    let far = -1, best = tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(points[i], points[lo], points[hi]);
      if (d > best) { best = d; far = i; }
    }
    if (far === -1) continue;
    keep[far] = 1;
    stack.push([lo, far], [far, hi]);
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Simplify a CLOSED ring at `tol`, in view units. The ring is split at its two extreme points so
 * neither of them can be discarded — RDP on an open line pins only its own ends, and closing a
 * ring by simply pinning index 0 lets the far side collapse. Never returns fewer than 3 points:
 * below that there is no shape left to draw, so the original is kept instead. */
export function simplifyRing(ring, tol) {
  if (!Array.isArray(ring) || ring.length <= 4 || !(tol > 0)) return ring;
  let iMin = 0, iMax = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i].x < ring[iMin].x) iMin = i;
    if (ring[i].x > ring[iMax].x) iMax = i;
  }
  const [a, b] = iMin < iMax ? [iMin, iMax] : [iMax, iMin];
  if (a === b) return ring;
  const first = rdp(ring.slice(a, b + 1), tol);
  const second = rdp(ring.slice(b).concat(ring.slice(0, a + 1)), tol);
  const out = first.concat(second.slice(1, -1));
  return out.length >= 3 ? out : ring;
}

function ringExtent(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

function extendBBox(bbox, ring) {
  for (const p of ring) {
    if (!finitePt(p)) continue;
    if (p.x < bbox.minX) bbox.minX = p.x;
    if (p.x > bbox.maxX) bbox.maxX = p.x;
    if (p.y < bbox.minY) bbox.minY = p.y;
    if (p.y > bbox.maxY) bbox.maxY = p.y;
  }
}

function ringPathD(ring) {
  let d = "";
  ring.forEach((p, i) => { d += `${i === 0 ? "M" : "L"}${roundCoord(p.x)} ${roundCoord(p.y)} `; });
  return d + "Z";
}

/**
 * Render a plan model to an SVG string, or null when there's nothing drawable (no active
 * boundary and no element with real geometry) — the caller's cue to show a plan-name-over-empty-
 * panel instead of a blank/broken image.
 */
export function planThumbnailSvg(model) {
  if (!model) return null;

  const boundaryRings = parcelsOf(model)
    .filter((p) => p && p.active !== false && Array.isArray(p.points) && p.points.length >= 3)
    .map((p) => ({ p, ring: p.points.filter(finitePt) }))
    .filter((r) => r.ring.length >= 3);

  const elRings = sortElsForPaint(elementsOf(model).filter(Boolean), byZ)
    .map((el) => ({ el, ring: el && TYPE[el.type] ? elToRingFeet(el) : null }))
    .filter((r) => Array.isArray(r.ring) && r.ring.length >= 3 && r.ring.every(finitePt));

  if (!boundaryRings.length && !elRings.length) return null;

  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  boundaryRings.forEach(({ ring }) => extendBBox(bbox, ring));
  elRings.forEach(({ ring }) => extendBBox(bbox, ring));
  const spanX = bbox.maxX - bbox.minX, spanY = bbox.maxY - bbox.minY;
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || spanX <= 0 || spanY <= 0) return null;

  const padX = spanX * PAD_FRAC, padY = spanY * PAD_FRAC;
  const vx0 = bbox.minX - padX, vy0 = bbox.minY - padY;
  const vw = spanX + 2 * padX, vh = spanY + 2 * padY;
  const scale = Math.min(VB_W / vw, VB_H / vh);
  const drawW = vw * scale, drawH = vh * scale;
  const offX = (VB_W - drawW) / 2 - vx0 * scale;
  const offY = (VB_H - drawH) / 2 - vy0 * scale;
  const toView = (ring) => ring.map((p) => ({ x: p.x * scale + offX, y: p.y * scale + offY }));

  // ── Render, under the ceiling (rule 1 in this file's header) ─────────────────────────────────
  // The ladder, in the order it degrades. Step 0 is what an ordinary plan gets, and its tolerance
  // is below the thumbnail's own visible resolution, so nothing perceptible happens there. Only a
  // plan still over budget after that climbs, and the climb stops at MAX_DEVIATION_UNITS — past
  // which geometry is left alone and the SMALLEST-area elements are dropped instead, because
  // losing a few specks whole is a truer picture than distorting every outline.
  const boundaryView = boundaryRings.map(({ p, ring }) => ({ p, ring: toView(ring) }));
  const elView = elRings.map(({ el, ring }) => ({ el, ring: toView(ring) }));
  // Ascending extent — the drop pass takes from the front, so the least visible go first.
  const dropOrder = elView
    .map((e, i) => ({ i, extent: ringExtent(e.ring) }))
    .sort((a, b) => a.extent - b.extent)
    .map((e) => e.i);

  const compose = (tol, dropCount) => {
    const dropped = new Set(dropOrder.slice(0, dropCount));
    const parts = [];
    // Boundary — outline only by default (matching the canvas's own "unfilled unless the user set
    // a fill" convention, planStyle.js's parcelDefaultStyle), a real fill if the parcel has one.
    // The boundary is the one thing never dropped: it is the shape of the site itself.
    boundaryView.forEach(({ p, ring }) => {
      const simple = simplifyRing(ring, tol);
      const fillAttr = p.fill
        ? ` fill="${xmlAttr(p.fill)}" fill-opacity="${xmlAttr(p.fillOpacity ?? 1)}"`
        : ' fill="none"';
      parts.push(`<path d="${ringPathD(simple)}"${fillAttr} stroke="${xmlAttr(p.stroke || BOUNDARY_STROKE)}" stroke-width="1.5" />`);
    });
    // Drawn elements, in the same paint order (type band, then z) the live canvas uses.
    elView.forEach(({ el, ring }, i) => {
      if (dropped.has(i)) return;
      if (ringExtent(ring) < MIN_RING_EXTENT_UNITS) return; // smaller than a rendered pixel
      const st = elStyle(el, model.settings);
      const simple = simplifyRing(ring, tol);
      parts.push(`<path d="${ringPathD(simple)}" fill="${xmlAttr(st.fill)}" fill-opacity="${xmlAttr(st.fillOpacity)}" stroke="${xmlAttr(st.stroke)}" stroke-width="0.75" />`);
    });
    return parts.length
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}">${parts.join("")}</svg>`
      : null;
  };

  let svg = compose(BASE_TOLERANCE_UNITS, 0);
  if (svg && svg.length > MAX_SVG_BYTES) {
    for (let tol = BASE_TOLERANCE_UNITS * 2; tol <= MAX_DEVIATION_UNITS; tol *= 2) {
      svg = compose(Math.min(tol, MAX_DEVIATION_UNITS), 0);
      if (!svg || svg.length <= MAX_SVG_BYTES) break;
    }
  }
  // Still over after the geometry ladder: drop the smallest elements, halving the survivor count
  // each round so this terminates in log2(n) passes however extreme the plan. The boundary always
  // survives, so a plan can degrade to its own outline but never to nothing.
  if (svg && svg.length > MAX_SVG_BYTES) {
    const keepFloor = boundaryView.length ? 0 : Math.max(1, Math.min(elView.length, 8));
    let dropCount = Math.ceil(elView.length / 2);
    while (svg && svg.length > MAX_SVG_BYTES && dropCount < elView.length - keepFloor) {
      svg = compose(MAX_DEVIATION_UNITS, dropCount);
      dropCount = elView.length - Math.floor((elView.length - dropCount) / 2);
    }
    // Never drop the LAST elements: with no boundary parcel to fall back on that would compose an
    // empty picture and return null, turning "a heavy plan" into "no thumbnail at all" — a worse
    // outcome than an over-budget one, and a silent one.
    const floor = boundaryView.length ? elView.length : Math.max(1, Math.min(elView.length, 8));
    if (svg && svg.length > MAX_SVG_BYTES && floor < elView.length) {
      svg = compose(MAX_DEVIATION_UNITS, elView.length - floor);
    }
  }
  return svg;
}
