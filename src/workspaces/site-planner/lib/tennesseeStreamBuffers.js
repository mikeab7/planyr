/* Tennessee stream buffers — the PURE half (B2521584). No Leaflet, no DOM, no network.
 *
 * WHAT IS DRAWN. A band on each side of a stream centreline, at the width Tennessee's CONSTRUCTION permit asks for that stream:
 *   standard    30 ft   every stream — the natural riparian buffer zone the TDEC Construction General Permit (TNR100000) requires between
 *                       the waterbody and the limits of disturbance. The permit lets a project AVERAGE the width, with no point narrower than
 *                       half of it (15 ft), so the band is the required AVERAGE, not a hard setback line.
 *   restricted  60 ft   a stream TDEC lists as "unavailable" under the permit — Exceptional Tennessee Waters and waters with unavailable
 *                       parameters (siltation / habitat alteration). The average is 60 ft with no point narrower than 30 ft. TDEC publishes
 *                       those reaches as the CGP Unavailable Waters layer; this module takes TDEC's own lines for the 60 ft band and never
 *                       decides "exceptional" or "impaired" itself.
 * Where a stream is both, the wider (restricted) governs. The NHD reach and TDEC's line for the same stream are the same water drawn twice, so an
 * NHD reach whose middle lies within `MATCH_FT` of a restricted line is NOT drawn again at 30 ft.
 *
 * WHAT IS NOT. Only streams are buffered (the same NHD rule the Georgia layer uses — `georgiaStreamBuffers.isBufferedStream`: ftype 460, not
 * ephemeral; never canals, ditches, artificial paths or pipelines). A wet-weather conveyance is not "waters of the state" and carries no buffer
 * — NHD cannot tell one from a stream, so a small headwater channel can be drawn that TDEC would call a conveyance (a hydrologic determination,
 * TDEC rule 0400-40-17, settles it: see "Hydrologic Determinations"). Local governments add their own post-construction buffers on top (an MS4
 * city such as Murfreesboro or Nashville) — those are NOT drawn: their width depends on drainage area and stream class the data does not carry.
 *
 * ⛔ MEASURED FROM THE CENTRELINE, NOT THE BANK. The permit measures from the top of the stream bank; NHD gives a centreline, so the band is too
 * narrow by half the channel width on a wide stream. Said on the layer; a survey of the bank governs.
 *
 * Reuses `corridorRingLngLat` (the pipeline-corridor buffer: local flat-earth feet frame). */
import { corridorRingLngLat } from "./pipelineCorridor.js";
import { isBufferedStream, linePartsOf } from "./georgiaStreamBuffers.js";

export const TN_BUFFER_TIERS = {
  standard: { id: "standard", eachSideFt: 30, color: "#b45309", label: "30 ft construction buffer (average)" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
  restricted: { id: "restricted", eachSideFt: 60, color: "#b91c1c", label: "60 ft buffer — exceptional / unavailable water (average)" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
};

/* An NHD reach and TDEC's line for the same stream agree to well within this; a different stream a block away does not. */
export const MATCH_FT = 150;

const FT_PER_DEG_LAT = 364567; // 1° of latitude, US survey feet (mean)
const midpoint = (path) => path[Math.floor(path.length / 2)];

/* Distance in feet from a point to a segment, in a flat-earth frame centred on the point. Pure. */
export function pointSegmentFt(lng, lat, a, b) {
  const kx = Math.cos((lat * Math.PI) / 180) * FT_PER_DEG_LAT, ky = FT_PER_DEG_LAT;
  const ax = (a[0] - lng) * kx, ay = (a[1] - lat) * ky, bx = (b[0] - lng) * kx, by = (b[1] - lat) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const px = ax + t * dx, py = ay + t * dy;
  return Math.hypot(px, py);
}

/* A coarse grid over a set of line paths so "is this point within N ft of any of them" costs a handful of segments, not all of them. */
const CELL_DEG = 0.004; // ~1,450 ft of latitude — comfortably wider than MATCH_FT, so the 3×3 neighbourhood always holds the answer
export function buildLineIndex(paths) {
  const cells = new Map();
  const key = (cx, cy) => cx + "," + cy;
  for (const path of paths || []) {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL_DEG), x1 = Math.floor(Math.max(a[0], b[0]) / CELL_DEG);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL_DEG), y1 = Math.floor(Math.max(a[1], b[1]) / CELL_DEG);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push([a, b]);
      }
    }
  }
  return {
    size: cells.size,
    /* the shortest distance in feet from the point to any indexed segment within the 3×3 cells around it, or Infinity */
    nearestFt(lng, lat) {
      const cx = Math.floor(lng / CELL_DEG), cy = Math.floor(lat / CELL_DEG);
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const segs = cells.get(key(cx + dx, cy + dy));
        if (!segs) continue;
        for (const [a, b] of segs) { const d = pointSegmentFt(lng, lat, a, b); if (d < best) best = d; }
      }
      return best;
    },
  };
}

/* THE FUNCTION: NHD flowlines + TDEC's restricted-water lines → the bands to draw.
 *   returns [{ ring: [[lng,lat],…], tier, from: "nhd" | "tdec" }]
 * `restricted` = null means the TDEC layer could not be loaded: then NOTHING is promoted to 60 ft and the caller must say so — a missing
 * list must never silently draw the narrower band as if it were the answer (the Georgia District rule). Pure. */
export function streamBufferBandsTn({ nhd = null, restricted = null } = {}) {
  const bands = [];
  const restrictedPaths = [];
  for (const feature of (restricted && restricted.features) || []) for (const part of linePartsOf(feature)) if (part && part.length >= 2) restrictedPaths.push(part);
  const index = restrictedPaths.length ? buildLineIndex(restrictedPaths) : null;
  const push = (path, tier, from) => {
    const ring = corridorRingLngLat(path, tier.eachSideFt * 2);
    if (ring && ring.length >= 3) bands.push({ ring, tier, from });
  };
  for (const feature of (nhd && nhd.features) || []) {
    if (!isBufferedStream(feature.properties)) continue;
    for (const part of linePartsOf(feature)) {
      if (!part || part.length < 2) continue;
      const m = midpoint(part);
      if (index && index.nearestFt(m[0], m[1]) <= MATCH_FT) continue; // TDEC's own line draws this stream at 60 ft
      push(part, TN_BUFFER_TIERS.standard, "nhd");
    }
  }
  for (const path of restrictedPaths) push(path, TN_BUFFER_TIERS.restricted, "tdec");
  return bands;
}

/* The legend/ⓘ line — one sentence per tier actually present in the bands. Pure. */
export function bufferLegendTn(bands) {
  const seen = new Set((bands || []).map((b) => b.tier.id));
  return Object.values(TN_BUFFER_TIERS).filter((t) => seen.has(t.id)).map((t) => t.label);
}
