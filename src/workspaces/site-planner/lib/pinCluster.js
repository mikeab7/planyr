/* pinCluster.js — B2013744: pins that sit on the SAME ground must not hide each other.
 *
 * A parcel-anchored comp, a map note on that parcel and the site's own pin all resolve to the
 * parcel's centre, so their markers land on one point and the biggest/last-added one swallows every
 * press meant for the others (owner-measured 2026-10-02: a note's 34x46 hit box fully covered a
 * comp's 14x14 marker — `elementFromPoint` never returned the comp, so it could not be clicked or
 * right-clicked). Pure + Leaflet-free so it is unit-testable.
 *
 * `pinClusterOffsets(points)` takes the pins in PRIORITY order (the first pin of a cluster keeps its
 * true spot; the rest are nudged sideways in SCREEN pixels, so the gap is the same at every zoom)
 * and returns Map id -> [dx, dy]. Only pins that genuinely coincide (within `epsM` metres) move;
 * a lone pin is never touched. The caller applies the offset by shifting the marker's iconAnchor,
 * so the true lat/lon is untouched. */

/** Pixel slots around the cluster's true point: the hit boxes are 34 px wide, so 38 clears them. */
const STEP_X = 38;
const STEP_Y = 50;
const SLOTS = [[0, 0], [STEP_X, 0], [-STEP_X, 0], [0, -STEP_Y], [0, STEP_Y], [STEP_X, -STEP_Y], [-STEP_X, -STEP_Y], [STEP_X, STEP_Y], [-STEP_X, STEP_Y]];

export const slotOffset = (k) => {
  if (k < SLOTS.length) return SLOTS[k];
  // Past the nine hand-placed slots: an ever-wider ring, deterministic in k.
  const ring = Math.ceil((k - SLOTS.length + 1) / 8) + 1;
  const a = (((k - SLOTS.length) % 8) / 8) * 2 * Math.PI;
  return [Math.round(Math.cos(a) * STEP_X * ring), Math.round(Math.sin(a) * STEP_Y * ring)];
};

const metres = (a, b) => {
  const dLat = (a.lat - b.lat) * 111320;
  const dLon = (a.lon - b.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
};

/** @param {{id:string, lat:number, lon:number}[]} points  priority order
 *  @returns {Map<string,[number,number]>} offsets for ONLY the pins that move (never a [0,0] entry) */
export function pinClusterOffsets(points, { epsM = 4 } = {}) {
  const out = new Map();
  const clusters = []; // each: { at:{lat,lon}, n }
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    let c = clusters.find((cl) => metres(cl.at, p) <= epsM);
    if (!c) { c = { at: p, n: 0 }; clusters.push(c); }
    const k = c.n++;
    if (k > 0) out.set(p.id, slotOffset(k));
  }
  return out;
}

/** Stable signature, so a caller can keep the same object identity while nothing moved. */
export const pinOffsetsSig = (m) => [...m.entries()].map(([id, [x, y]]) => `${id}:${x},${y}`).sort().join("|");

/* ── B2671329: STACKS, NOT NUDGES ────────────────────────────────────────────────────────────────
 * Owner 2026-11-24: "the pin moves independently of the map on zoom in or out" (an orange
 * under-construction comp). Root cause: `pinClusterOffsets` above moved every coincident pin but the
 * first by a FIXED number of SCREEN pixels. A screen-pixel gap is the same at every zoom, so in
 * ground terms the pin's spot changed with every zoom step: zoomed out it sat a quarter-mile off its
 * building, zoomed in it sat a few feet off, and during the zoom animation it visibly slid against
 * the aerial. Supply records made it common (a park's buildings share one pin: Fairbanks Landing has
 * four under-construction rows on one coordinate).
 *
 * The rule now: EVERY PIN IS ALWAYS DRAWN ON ITS OWN COORDINATE. Pins that share a spot form a
 * STACK: only its lead is drawn, on the true point, wearing a small count badge. Pressing the badge
 * FANS the stack out (each member tethered back to the true point by a thin line) so every member is
 * clickable (B2013744's reason for the nudge still holds). A fan is collapsed the moment the map
 * starts to zoom, so nothing ever slides against the map. A site pin is never moved or hidden (it is
 * drawn by its own layer); when one sits in a stack, the comps/notes on it draw ABOVE it, and in a
 * fan they all leave the true spot so the site stays reachable. Pure + Leaflet-free. */

const isSiteId = (id) => String(id).startsWith("site:");

/** @param {{id:string, lat:number, lon:number}[]} points  priority order (sites, then comps, then notes)
 *  @returns {Map<string,{key:string, members:string[], hasSite:boolean}>} ONLY pins that share a spot */
export function pinStacks(points, { epsM = 4 } = {}) {
  const clusters = [];
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    let c = clusters.find((cl) => metres(cl.at, p) <= epsM);
    if (!c) { c = { at: p, ids: [] }; clusters.push(c); }
    c.ids.push(p.id);
  }
  const out = new Map();
  for (const c of clusters) {
    if (c.ids.length < 2) continue;
    const stack = { key: c.ids[0], members: c.ids.slice(), hasSite: c.ids.some(isSiteId) };
    for (const id of c.ids) out.set(id, stack);
  }
  return out;
}

export const pinStacksSig = (m) => [...m.entries()].map(([id, s]) => `${id}>${s.key}:${s.members.length}`).sort().join("|");

/** Where ONE comp/note pin draws. `fannedKey` = the key of the stack currently fanned out (or null).
 *  - not in a stack: on its point, untouched.
 *  - in a collapsed stack: the first non-site member draws on the true point with the stack's
 *    count; every other member is hidden.
 *  - in the fanned stack: every non-site member draws at its own slot (pixel offset) with a
 *    tether; with no site in the stack the first keeps the true spot.
 * @returns {{hidden:boolean, offset:[number,number]|null, count:number, fanned:boolean, key:string|null, aboveSite:boolean}} */
export function pinPlacement(stacks, id, fannedKey = null) {
  const s = stacks && stacks.get(id);
  if (!s || isSiteId(id)) return { hidden: false, offset: null, count: 0, fanned: false, key: null, aboveSite: false };
  const movable = s.members.filter((m) => !isSiteId(m));
  const i = movable.indexOf(id);
  const fanned = fannedKey != null && fannedKey === s.key;
  if (!fanned) {
    return i === 0
      ? { hidden: false, offset: null, count: s.members.length, fanned: false, key: s.key, aboveSite: s.hasSite }
      : { hidden: true, offset: null, count: 0, fanned: false, key: s.key, aboveSite: s.hasSite };
  }
  const k = s.hasSite ? i + 1 : i;
  const o = slotOffset(k);
  return { hidden: false, offset: k === 0 ? null : o, count: i === 0 ? s.members.length : 0, fanned: true, key: s.key, aboveSite: s.hasSite };
}

/** The icon anchor for a placement: a fanned member's drawing sits `offset` pixels from its point. */
export const placedAnchor = (anchor, pl) => (pl && pl.offset ? [anchor[0] - pl.offset[0], anchor[1] - pl.offset[1]] : anchor);

/** Extra HTML a stacked pin wears: the tether (fanned members) and the count badge (the lead).
 *  `anchor` is the icon's own anchor (the drawn pin's centre in icon coordinates); `r` the drawn
 *  pin's visual radius, so the badge sits on its upper-right shoulder. The badge carries
 *  `data-pin-stack` so the marker's click handler can tell a badge press from a pin press. */
export function pinStackHtml(pl, anchor, r) {
  if (!pl || (!pl.count && !pl.offset)) return "";
  const [ax, ay] = anchor;
  let html = "";
  if (pl.offset) {
    const [dx, dy] = pl.offset;
    html +=
      `<svg data-pin-tether="1" width="1" height="1" style="position:absolute;left:${ax}px;top:${ay}px;overflow:visible;pointer-events:none;z-index:-1">` +
      `<line x1="0" y1="0" x2="${-dx}" y2="${-dy}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` + // design-exempt: white tether casing on a photograph, SVG attrs can't use var()
      `<line x1="0" y1="0" x2="${-dx}" y2="${-dy}" stroke="#1f2937" stroke-width="1.4" stroke-linecap="round"/>` + // design-exempt: dark tether core on a photograph, fixed across themes
      `<circle cx="${-dx}" cy="${-dy}" r="3" fill="#1f2937" stroke="#fff" stroke-width="1.2"/>` + // design-exempt: the true-point dot, fixed ink on a photograph
      `</svg>`;
  }
  if (pl.count) {
    const left = +(ax + r * 0.55).toFixed(1), top = +(ay - r * 0.55 - 15).toFixed(1);
    const label = pl.fanned ? "×" : String(pl.count);
    const title = pl.fanned ? "Put these back in one stack" : `${pl.count} records on this spot: show them all`;
    html +=
      `<span data-pin-stack="1" role="button" title="${title}" aria-label="${title}" style="position:absolute;left:${left}px;top:${top}px;` +
      `min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;` +
      `border-radius:9px;background:#1f2937;color:#fff;border:1.5px solid #fff;` + // design-exempt: count chip on a photograph, fixed ink like the pin keylines
      `font:700 10px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap">${label}</span>`;
  }
  return html;
}

/** True when a marker click landed on its stack badge (not the pin itself). */
export const isStackBadgePress = (e) => {
  const t = e && (e.originalEvent ? e.originalEvent.target : e.target);
  return !!(t && typeof t.closest === "function" && t.closest("[data-pin-stack]"));
};
