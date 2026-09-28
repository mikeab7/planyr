/* buildingSfTable.js — per-building SF rows for the exhibit's compact "Buildings" inset
 * (B1934529, bringing back the B197-era buildings table as a compact, toggleable corner plate
 * instead of the full-width column B1804993 removed).
 *
 * One row per numbered building ("Building N", the SAME numbering `buildingNumbers` gives the
 * canvas and every other reader — kmzExport.js, editorNames.js). A building's SF is its own
 * footprint plus any bump-outs (dog-ears) attached to it — the SAME two terms the canvas label
 * sums for that building (SitePlanner.jsx's building-label branch: `area + ba`) — so a printed
 * row can never disagree with what the map itself shows for that building.
 *
 * The TOTAL across every row is exactly `siteMetrics(els, ...).bldg`: that metric walks every
 * `type === "building"` element (parent footprints AND their bump-outs, each counted once, as
 * its own element) and sums their areas; summing (footprint + its own bump-outs) per PARENT
 * building covers the identical set of elements once each. Proven in
 * test/buildingSfTable.test.js rather than merely reasoned about.
 *
 * Pure — no React, no DOM — so it can be unit-tested and reused by the export path without a
 * second derivation.
 */
import { polyArea } from "./siteGeometry.js";
import { isBuilding, buildingNumbers } from "./siteModel.js";

const areaOf = (e) => (e ? (e.points ? polyArea(e.points) : (e.w || 0) * (e.h || 0)) : 0);

/**
 * @param {Array} els — the full drawn-element model.
 * @returns {{ rows: Array<{id:string, n:number, name:string, sf:number}>, total: number }}
 */
export function buildingSfRows(els) {
  const list = (els || []).filter(isBuilding);
  if (!list.length) return { rows: [], total: 0 };
  const nums = buildingNumbers(els);
  const rows = list
    .map((b) => {
      const bumps = (els || []).filter((x) => x && x.dogEar && x.attachedTo === b.id);
      const sf = areaOf(b) + bumps.reduce((s, x) => s + areaOf(x), 0);
      const n = nums.get(b.id) || 0;
      return { id: b.id, n, name: `Building ${n}`.trim(), sf };
    })
    .sort((a, b) => a.n - b.n);
  const total = rows.reduce((s, r) => s + r.sf, 0);
  return { rows, total };
}
