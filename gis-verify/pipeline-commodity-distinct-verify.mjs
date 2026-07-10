/* RRC pipeline COMMODITY crosswalk reconciler (B751 — the live half of V264).
 *
 * The B751 commodity styling maps the RRC T-4 layer's free-text COMMODITY_DESCRIPTION into six
 * fixed buckets via a keyword crosswalk (src/.../pipelineCommodity.js). The crosswalk MUST be
 * reconciled against the REAL distinct values — which can't be pulled from the sandbox because
 * gis.rrc.texas.gov is not on the egress allowlist. This script runs that reconciliation wherever
 * RRC is reachable (CI / open internet / a Cowork run on planyr.io's edge):
 *
 *   • pulls DISTINCT COMMODITY_DESCRIPTION from the live RRC layer 13,
 *   • buckets each value with the SAME commodityBucket() the app uses,
 *   • REPORTS every value that lands in "unknown" (the gray bucket) so a real commodity the
 *     crosswalk misses is visible, never silently buried,
 *   • FLAGS high-hazard outliers (hydrogen / anhydrous ammonia …) routed to the red HVL style so
 *     the owner can confirm the "red HVL style, labeled by true commodity" decision holds.
 *
 * Exit 0 = every distinct value maps to a NAMED bucket (nothing in gray). Exit 1 = at least one
 * value fell to "unknown" — inspect the list and extend the crosswalk keywords (then re-run).
 *
 *   node gis-verify/pipeline-commodity-distinct-verify.mjs
 */
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { commodityBucket, isHazardOutlier, commodityBucketRecord } from "../src/workspaces/site-planner/lib/pipelineCommodity.js";

const TIMEOUT_MS = 30000;
const src = GIS_SOURCES.pipelines;
const field = src.fields.commodity; // COMMODITY_DESCRIPTION
const queryUrl = `${src.serviceUrl}/${src.layerId}/query`;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j && j.error) throw new Error(`ArcGIS error ${j.error.code ?? ""}: ${j.error.message || "query error"}`);
    return j;
  } finally {
    clearTimeout(t);
  }
}

const params = new URLSearchParams({
  where: "1=1",
  outFields: field,
  returnDistinctValues: "true",
  returnGeometry: "false",
  orderByFields: field,
  f: "json",
});

(async () => {
  console.log(`RRC pipeline commodity crosswalk reconcile — layer 13\n  ${queryUrl}\n`);
  let j;
  try {
    j = await getJson(`${queryUrl}?${params.toString()}`);
  } catch (e) {
    console.error(`UNREACHABLE — ${e.message}. (Expected in the sandbox: gis.rrc.texas.gov is not on the egress allowlist. Run in CI / open internet.)`);
    process.exit(2);
  }
  const values = (j.features || []).map((f) => f.attributes && f.attributes[field]);
  console.log(`Distinct ${field} values: ${values.length}\n`);

  const byBucket = {};
  const unknowns = [];
  const outliers = [];
  for (const v of values) {
    const key = commodityBucket(v);
    (byBucket[key] = byBucket[key] || []).push(v);
    if (key === "unknown") unknowns.push(v);
    if (isHazardOutlier(v)) outliers.push(v);
  }

  for (const b of ["hvl", "gas", "crude", "refined", "co2", "unknown"]) {
    const list = byBucket[b] || [];
    console.log(`  ${commodityBucketRecord(b).label} [${b}] — ${list.length}`);
    for (const v of list) console.log(`      ${v == null || v === "" ? "(blank)" : v}`);
  }

  if (outliers.length) {
    console.log(`\n⚠ High-hazard OUTLIERS routed to the red HVL style (confirm the styling decision):`);
    for (const v of outliers) console.log(`      ${v}`);
  }

  if (unknowns.length) {
    console.log(`\n❌ ${unknowns.length} value(s) fell to the gray "unknown" bucket — extend the crosswalk keywords so real commodities aren't buried:`);
    for (const v of unknowns) console.log(`      ${v == null || v === "" ? "(blank)" : v}`);
    process.exit(1);
  }
  console.log(`\n✅ Every distinct commodity maps to a NAMED bucket — crosswalk is complete for the live data.`);
})();
