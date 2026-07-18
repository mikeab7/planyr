/* NEW-C1 — upstream / offsite drainage delineation from the existing 3DEP DEM. Extends the
 * flowField.js D8 flow-DIRECTION into flow-ACCUMULATION (the "seed of the storm-outfall flow-
 * accumulation feature" flowField.js already flagged), so the app can answer: how much land
 * drains ONTO this site from uphill? When that contributing area MATERIALLY exceeds the site
 * itself, significant offsite flow is entering that the on-site detention screen does NOT
 * model — a loud "engineer's check" flag (offsite/upstream flow, bypass/conveyance, and the
 * detention that offsite area may itself require are all the engineer's call).
 *
 * Screening only — a LiDAR-derived contributing area over a coarse grid, NOT a delineated
 * drainage study. LOUD-FAILURE: a grid too small / an off-grid outlet → honest null. Pure +
 * Node-testable (runs in the terrain worker like the rest of flowField/demGrid); no DOM. */
import { d8Direction } from "./flowField.js";

const SQFT_PER_ACRE = 43560;

/* D8 downstream neighbor index for a cell, or -1 (pit/flat/edge). Wraps flowField.d8Direction
 * (which returns a {dx,dy} step or null) into a flat index. Pure. */
export function downstreamIndex(values, mask, width, height, i, cellFt) {
  const x = i % width, y = (i / width) | 0;
  const step = d8Direction(values, mask, width, height, x, y, cellFt);
  if (!step) return -1;
  const nx = x + step.dx, ny = y + step.dy;
  if (nx < 0 || ny < 0 || nx >= width || ny >= height) return -1;
  const j = ny * width + nx;
  return mask[j] ? j : -1;
}

/* Flow accumulation: for each masked cell, the COUNT of cells (incl. itself) that drain
 * through it. Computed by pushing accumulation downstream in descending-elevation order
 * (each cell's water reaches its D8 downstream neighbor before that neighbor is processed).
 * Returns an Int32Array (0 on unmasked cells). Pure. */
export function flowAccumulation({ values, mask, width, height, cellFt = 1 } = {}) {
  const n = width * height;
  const acc = new Int32Array(n);
  const order = [];
  for (let i = 0; i < n; i++) if (mask[i]) { acc[i] = 1; order.push(i); }
  // Descending elevation → downstream neighbor is always processed AFTER the cell.
  order.sort((a, b) => values[b] - values[a]);
  for (const i of order) {
    const j = downstreamIndex(values, mask, width, height, i, cellFt);
    if (j >= 0) acc[j] += acc[i];
  }
  return acc;
}

/* The contributing area (acres) draining THROUGH a cell — its accumulation × cell area. Pure. */
export function contributingAcres(acc, i, cellFt) {
  if (!acc || i < 0 || i >= acc.length) return null;
  return (acc[i] * cellFt * cellFt) / SQFT_PER_ACRE;
}

/* The lowest masked cell within a sub-mask (the site) — the natural low point / screening
 * outfall the site drains to. Returns a flat index or -1. `siteMask` (optional) restricts to
 * the site footprint; without it, the whole grid's low point. Pure. */
export function lowestCell({ values, mask, width, height } = {}, siteMask = null) {
  let lo = -1, loV = Infinity;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    if (siteMask && !siteMask[i]) continue;
    if (values[i] < loV) { loV = values[i]; lo = i; }
  }
  return lo;
}

/* Delineate the upstream contributing area at an outlet: the set of masked cells whose D8
 * downstream path reaches the outlet cell. Returns { cells:Set, upstreamAcres } or null when
 * the outlet is off-grid. Bounded path length guards against a cycle on flat/noisy terrain.
 * Pure. */
export function delineateUpstream({ values, mask, width, height, cellFt = 1 } = {}, outletCell) {
  const n = width * height;
  if (outletCell == null || outletCell < 0 || outletCell >= n || !mask[outletCell]) return null;
  const cells = new Set();
  const maxSteps = n + 1;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    // Walk downstream from i; if it reaches the outlet, i is upstream of it.
    let cur = i, steps = 0;
    const seen = new Set();
    while (cur >= 0 && steps++ < maxSteps) {
      if (cur === outletCell) { cells.add(i); break; }
      if (seen.has(cur)) break; // cycle guard
      seen.add(cur);
      cur = downstreamIndex(values, mask, width, height, cur, cellFt);
    }
  }
  cells.add(outletCell);
  return { cells, upstreamAcres: (cells.size * cellFt * cellFt) / SQFT_PER_ACRE };
}

/* The offsite-drainage screen. `upstreamAcres` is the contributing area at the site outfall
 * (flowAccumulation at the low point, or delineateUpstream); `siteAcres` the site itself.
 * When the upstream area materially exceeds the site (default ≥25% larger), offsite flow is
 * entering that the on-site detention screen doesn't model → a warn flag. Pure. */
export const OFFSITE_MATERIAL_RATIO = 1.25;
export function offsiteDrainageFlag({ upstreamAcres = null, siteAcres = null, materialRatio = OFFSITE_MATERIAL_RATIO } = {}) {
  if (upstreamAcres == null || siteAcres == null || !(siteAcres > 0)) {
    return { known: false, offsite: null, severity: "muted", message: "Upstream contributing area unscreened — need the site DEM + an outfall low point." };
  }
  const offsiteAcres = Math.max(0, upstreamAcres - siteAcres);
  const ratio = upstreamAcres / siteAcres;
  const material = ratio >= materialRatio;
  const r1 = (n) => Math.round(n * 10) / 10;
  if (!material) {
    return { known: true, offsite: false, upstreamAcres: r1(upstreamAcres), offsiteAcres: r1(offsiteAcres), ratio: Math.round(ratio * 100) / 100, severity: "ok",
      message: `Upstream contributing area ≈ ${r1(upstreamAcres)} ac (~${r1(offsiteAcres)} ac offsite) — not materially larger than the ${r1(siteAcres)}-ac site. Screening only; confirm the drainage path.` };
  }
  return { known: true, offsite: true, upstreamAcres: r1(upstreamAcres), offsiteAcres: r1(offsiteAcres), ratio: Math.round(ratio * 100) / 100, severity: "warn",
    message: `⚠ Offsite flow: ~${r1(upstreamAcres)} ac drains to this site's outfall — ${Math.round((ratio - 1) * 100)}% MORE than the ${r1(siteAcres)}-ac site (~${r1(offsiteAcres)} ac from uphill). That offsite runoff is NOT modeled in the on-site detention screen; it may need bypass/conveyance and its own detention — engineer's check. (Screening from the 3DEP DEM, not a delineated study.)` };
}
