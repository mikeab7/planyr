/* PAVING SETBACK (NEW-1, owner-approved mockup 2026-11-09) — a second per-edge setback beside the building one.
 *
 * ── THE RULES, so a later session does not "simplify" them away ───────────────────────────────────
 *  · OFF until the owner clicks "+ Add paving setback". A parcel that never added it carries NO `pavingSetbacks`
 *    key at all (absent = not added) — it renders and saves byte-for-byte as before.
 *  · It starts at 0 on every edge and is NEVER copied from, or derived from, the building setback
 *    (owner: "I don't want the paving setback to be automatic"). There is no default setting for it.
 *  · Same SECTIONS as the building setback (lib/boundarySections.js) — one split/join applies to both. This file
 *    keeps no section system of its own; a section is only a view over edge indices.
 *  · What it limits: car parking, trailer parking, truck courts / paving, and roads (drive aisles, on-site roads).
 *    NOT sidewalks (owner, 2026-11-09), NOT buildings (the building setback alone), NOT buffers / landscape / ponds.
 *  · A driveway that connects the site to a road OUTSIDE the site may cross the line: the app has no "this drive
 *    connects to the public road" record, so the rule is geometric — see `pavingConflicts`.
 *
 * Pure: no React, no DOM. The planner passes in how to turn an element into a ring.
 */
import { offsetPolygon } from "./parcelOffset.js";
import { polyIntersectArea } from "./polyClip.js";
import { pointInRing, projectOntoSegment } from "./ringMath.js";
import { setSectionSetback } from "./boundarySections.js";

/** The element kinds the paving setback limits. Sidewalks are deliberately absent. */
export const PAVING_TYPES = Object.freeze(["parking", "trailer", "paving", "road"]);
export const limitedByPaving = (el) => !!el && PAVING_TYPES.includes(el.type) && !el.buffer;

/** Has this parcel added a paving setback? (Presence of the array IS the answer — `[]`/zeros still count.) */
export const hasPaving = (pc) => !!pc && Array.isArray(pc.pavingSetbacks);

/** The per-edge values, always as long as the ring (a short array pads with 0, never invents a value); null = not added. */
export function pavingValues(pc) {
  if (!hasPaving(pc) || !Array.isArray(pc.points)) return null;
  const n = pc.points.length;
  return Array.from({ length: n }, (_, i) => { const v = Number(pc.pavingSetbacks[i]); return Number.isFinite(v) && v > 0 ? v : 0; });
}

/** A fresh "added, nothing set" array. */
export const newPaving = (edgeCount) => Array.from({ length: Math.max(0, edgeCount | 0) }, () => 0);

/** Every edge to `v` (clamped ≥ 0) — the "Paving [n] ft · all sections" box. */
export const pavingAll = (edgeCount, v) => Array.from({ length: Math.max(0, edgeCount | 0) }, () => Math.max(0, Number(v) || 0));

/** Only this section's edges get `v`; the others keep their value. Same writer the building setback uses. */
export const setPavingSection = (values, section, v, edgeCount) => setSectionSetback(values, section, v, edgeCount);

/** The common value of a section's edges, or null when they differ ("mixed") — the same reading `boundarySections` gives `s.value`. */
export function sectionValue(values, section) {
  if (!Array.isArray(values) || !section || !Array.isArray(section.edges) || !section.edges.length) return null;
  const first = values[section.edges[0]] || 0;
  return section.edges.every((e) => (values[e] || 0) === first) ? first : null;
}

/* Ring-length bookkeeping — the SAME shapes setbackRoles.shiftOverridesOn* use, for a numeric vector.
 * INSERT on edge `edgeIndex`: both halves are the same side, so both keep the value. DELETE vertex `index`: edges
 * index-1 and index merge and keep the first half's value (drop slot `index`). null/absent stays absent. */
export function shiftPavingOnInsert(values, edgeIndex) {
  if (!Array.isArray(values)) return values;
  const next = values.slice();
  const at = Math.max(0, Math.min(values.length - 1, edgeIndex));
  next.splice(at + 1, 0, Number.isFinite(values[at]) ? values[at] : 0);
  return next;
}
export function shiftPavingOnDelete(values, index) {
  if (!Array.isArray(values)) return values;
  return values.filter((_, j) => j !== index);
}

/** The line itself: the parcel offset inward by the per-edge paving values. null when not added or every value is 0. */
export function pavingRing(pc) {
  const v = pavingValues(pc);
  if (!v || !v.some((x) => x > 0)) return null;
  return offsetPolygon(pc.points, v);
}

/* ---- conflicts ------------------------------------------------------------------------------------------------------ */

const MIN_CONFLICT_SF = 20;      // a sliver of a curb kiss is not a finding
const DRIVE_EDGE_TOL_FT = 2;     // a drive that ends within this of the lot line "reaches" it
const WALK_STEP_FT = 2;          // how finely a drive's centreline is walked to find where it enters the paving line

const distToRing = (p, ring) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const q = projectOntoSegment(ring[i], ring[(i + 1) % ring.length], p);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best) best = d;
  }
  return best;
};

/* every sample of a polyline at <= step feet, in order */
function densify(pts, step = WALK_STEP_FT) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    if (i + 1 < pts.length) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y), k = Math.floor(L / step);
      for (let j = 1; j <= k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / (k + 1), y: a.y + ((b.y - a.y) * j) / (k + 1) });
    }
  }
  return out;
}

const bbox = (ring) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of ring) { if (p.x < a) a = p.x; if (p.x > c) c = p.x; if (p.y < b) b = p.y; if (p.y > d) d = p.y; }
  return { a, b, c, d };
};
const bbTouch = (u, v) => u.a <= v.c && v.a <= u.c && u.b <= v.d && v.b <= u.d;

/** Square feet of `ring` lying in the band between the lot line and the paving line. */
function bandArea(ring, lot, inner) {
  if (!ring || ring.length < 3) return 0;
  // Cheap first stage: every corner strictly inside the paving line => nothing in the band (no area maths for the common case).
  if (ring.every((p) => pointInRing(p, inner))) return 0;
  return Math.max(0, polyIntersectArea(ring, lot) - polyIntersectArea(ring, inner));
}

/**
 * Which paving-limited elements cross a parcel's paving setback line.
 *
 * ctx:
 *  parcels  — every parcel of the plan (active ones count; the ones with a paving setback drive the check)
 *  els      — the plan's elements (the caller drops hidden ones)
 *  ringOf(el)            — the element's footprint ring in feet (a centreline road: its pavement + curb strip)
 *  roadCentreline(el)    — a centreline road's dense centreline, or null for a non-centreline element
 *  roadRingOf(el, line)  — the pavement strip of just that centreline piece
 *
 * THE DRIVEWAY RULE (no "connects to a public road" record exists in the app — measured: `parcelStreets` and the
 * junction code only know road-to-road / road-to-field links, not "this drive reaches the street"): an END of a
 * road that lies OUTSIDE the site (outside every active parcel, or within 2 ft of this lot's line and not inside
 * another lot) is where it connects to the street, and the stretch from that end to the first point inside the
 * paving line is the driveway — it is allowed across the line and never counted. A road that only wanders into
 * the band, or dead-ends there, is NOT a driveway and is flagged.
 *
 * @returns [{ id, parcelId, areaSf, driveway }] — one per element/parcel pair with more than MIN_CONFLICT_SF in the band.
 */
export function pavingConflicts({ parcels = [], els = [], ringOf, roadCentreline = () => null, roadRingOf = () => null } = {}) {
  const active = (parcels || []).filter((p) => p && p.active !== false && Array.isArray(p.points) && p.points.length >= 3);
  const out = [];
  for (const pc of active) {
    const inner = pavingRing(pc);
    if (!inner) continue;
    const lotBox = bbox(pc.points);
    const others = active.filter((o) => o !== pc);
    const reachesStreet = (pt) => {
      const outsideThisLot = !pointInRing(pt, pc.points) || distToRing(pt, pc.points) <= DRIVE_EDGE_TOL_FT;
      if (!outsideThisLot) return false;
      return !others.some((o) => pointInRing(pt, o.points) && distToRing(pt, o.points) > DRIVE_EDGE_TOL_FT);
    };
    for (const el of els) {
      if (!limitedByPaving(el)) continue;
      const line = roadCentreline(el);
      const ring = line ? roadRingOf(el, line) : ringOf(el);
      if (!ring || ring.length < 3 || !bbTouch(bbox(ring), lotBox)) continue;
      const total = bandArea(ring, pc.points, inner);
      if (total < MIN_CONFLICT_SF) continue;
      let exempt = 0;
      if (line && line.length >= 2) {
        const samples = densify(line);
        const ends = [{ list: samples }, { list: samples.slice().reverse() }];
        for (const { list } of ends) {
          if (!reachesStreet(list[0])) continue;
          const cut = list.findIndex((p) => pointInRing(p, inner));
          if (cut < 0) continue; // never reaches inside the paving line: it runs along / ends in the band — not a driveway, flagged
          const approach = list.slice(0, cut + 1);
          if (approach.length < 2) continue;
          const aRing = roadRingOf(el, approach);
          exempt += bandArea(aRing, pc.points, inner);
        }
      }
      const areaSf = Math.max(0, total - Math.min(exempt, total));
      if (areaSf >= MIN_CONFLICT_SF) out.push({ id: el.id, parcelId: pc.id, areaSf, driveway: exempt > 0 });
    }
  }
  return out;
}

/** A value signature of the result, so a state setter can skip a no-change update. */
export const conflictSig = (list) => (list || []).map((c) => `${c.id}:${c.parcelId}:${Math.round(c.areaSf)}`).join("|");
