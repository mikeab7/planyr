/* NEW-1 (B1057 completion) — the REAL-DATA verification of the screening-BFE pipeline.
 *
 * This exists because an assumption was wrong. The V494 entry was drafted saying the sandbox blocks
 * USGS 3DEP, FEMA NFHL, NOAA PFDS and USDA SSURGO. Three of the four are in fact reachable, and the
 * fourth (SSURGO) is reachable through this branch's own `/api/soils` Pages Function on the
 * Cloudflare preview deploy. So the pipeline can be driven end-to-end on REAL public data here,
 * and "needs a live pass" would have been a false park.
 *
 * What it proves that the unit tests cannot: that the real 3DEP LERC tiles decode into a grid this
 * code can delineate over, that a real channel is found and cut, that the real NOAA Atlas 14 depths
 * for the point parse and drive the storms, that real SSURGO returns a hydrologic soil group, and
 * that the composed 1% / 0.2% elevations are physically sane against the real ground at the site.
 *
 *   node ui-audit/verify-screening-bfe-live.mjs <lat> <lng> [label]
 *
 * ⛔ THE LOCATION IS REQUIRED, AND IT IS REQUIRED BECAUSE OF A NEAR-MISS (B1089).
 * This script used to DEFAULT to 29.9 / -95.98 and describe it in code only as "a Waller County
 * point". A run against that default produced a clean 1% of 165.9 ft — and that number was then
 * summarised as coming from "a real Waller point", which read as if it were the owner's site. It
 * was not: it is ~10 miles from Tsakiris and in a different watershed. Tsakiris itself, run
 * properly, produces NO number at all (flat reach, no defined channel). A convenience default
 * nearly turned one site's number into another site's answer.
 *
 * So: no default. Every run must name where it is, every line of output is stamped with the
 * coordinates and the label, and the summary block repeats them — so no report of this script's
 * output can say "a real Waller point" without saying WHICH point.
 *
 * Known sites (pass the label to have it echoed, or just pass coordinates):
 *   Tsakiris / Concept A   29.77938  -95.89503   (Waller, in BKDD — the §5.C(3) site)
 *
 * Network-bound by design: this is the live gate, not a unit test, and it is not wired into CI.
 */
import { gridRequest, exportUrl, looksLikeLerc, sampleAtLatLng, mercPerPx, groundScale } from "../src/workspaces/site-planner/lib/demGrid.js";
import { DEP_URL } from "../src/workspaces/site-planner/lib/elevation.js";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { parsePfdsText } from "../src/workspaces/site-planner/lib/pfds.js";
import { parseSoilResponse, buildSdaRequest } from "../src/workspaces/site-planner/lib/soils.js";
import {
  terrainInputsForScreeningBfe, atlas14Depths, screeningBfeForSite, screeningStudyNote, screeningDeclined,
  WATERSHED_GRID_ZOOM, WATERSHED_PAD_DEG,
} from "../src/workspaces/site-planner/lib/screeningBfeSite.js";
// terrainLayers.js can't load in Node (it static-imports a Vite `?worker` specifier), and this
// script only needs its zoom picker — which is pure. Mirrored here verbatim; `test/…` keeps the
// shipped copy honest, and a drift between the two would change only which zoom this probe pulls.
const SITE_GRID_TARGET_GROUND_M = 3;
const siteGridZoom = (lat) => {
  for (let z = 12; z <= 19; z++) if (mercPerPx(z) * 2 * groundScale(lat) <= SITE_GRID_TARGET_GROUND_M) return z;
  return 19;
};

const LAT = Number(process.argv[2]);
const LNG = Number(process.argv[3]);
const LABEL = process.argv[4] || null;
if (!Number.isFinite(LAT) || !Number.isFinite(LNG)) {
  console.error(
    "\n⛔ This probe REQUIRES an explicit location — there is deliberately no default.\n" +
    "   A default of 29.9 / -95.98 once produced a number that was reported as though it were\n" +
    "   the owner's site; it was ten miles away. Name the point you mean.\n\n" +
    "   node ui-audit/verify-screening-bfe-live.mjs <lat> <lng> [label]\n" +
    "   e.g. node ui-audit/verify-screening-bfe-live.mjs 29.77938 -95.89503 \"Tsakiris / Concept A\"\n",
  );
  process.exit(2);
}
// Every output line carries WHERE it came from, so a quoted figure can never lose its provenance.
const WHERE = `${LABEL ? `${LABEL} @ ` : ""}${LAT}, ${LNG}`;
// This branch's Cloudflare preview — the only place the NEW /api/soils Function is deployed.
const PREVIEW = process.env.PREVIEW_URL || "https://claude-waller-county-flood-o.planyr.pages.dev";

const fail = (m) => { console.error(`✗ [${WHERE}] ${m}`); process.exitCode = 1; };
const pass = (m) => console.log(`✓ [${WHERE}] ${m}`);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");

async function fetchGrid(bounds, zoom, label) {
  const req = gridRequest(bounds, zoom);
  const res = await fetch(exportUrl(req, DEP_URL));
  if (!res.ok) throw new Error(`${label} grid HTTP ${res.status}`);
  // NOTE: looksLikeLerc takes the ArrayBuffer itself, not a view — `new Uint8Array(view, 0, 9)`
  // silently ignores the offset/length and copies the whole 4 MB payload. (Shipped callers get
  // this right; this probe did not, at first.)
  const buf = await res.arrayBuffer();
  if (!looksLikeLerc(buf)) throw new Error(`${label} grid did not come back as LERC (${buf.byteLength} bytes)`);
  const grid = decodeGrid(buf, req);
  let live = 0;
  for (let i = 0; i < grid.mask.length; i++) live += grid.mask[i];
  console.log(`  · ${label}: ${req.width}×${req.height} cells, ${(live / (req.width * req.height) * 100).toFixed(1)}% non-void, ~${(req.cellMeters * 3.281).toFixed(0)} ft/cell (mercator)`);
  return { grid, req };
}

console.log(`\nScreening BFE — REAL-DATA run at ${WHERE}\n`);
if (!LABEL) console.log("  (no site label given — quote this run as the coordinates above, never as \"a Waller point\")\n");

// ── 1. Terrain: the fine site grid (section) + the wide coarse grid (watershed). One source.
console.log("USGS 3DEP");
const SITE_PAD = 0.006; // ~2,200 ft — a site-scale envelope, matching the drainage check's own pull
let section, watershed;
try {
  section = await fetchGrid(
    { west: LNG - SITE_PAD, east: LNG + SITE_PAD, south: LAT - SITE_PAD, north: LAT + SITE_PAD },
    siteGridZoom(LAT), "site DEM (section)",
  );
  watershed = await fetchGrid(
    { west: LNG - WATERSHED_PAD_DEG, east: LNG + WATERSHED_PAD_DEG, south: LAT - WATERSHED_PAD_DEG, north: LAT + WATERSHED_PAD_DEG },
    Math.min(WATERSHED_GRID_ZOOM, siteGridZoom(LAT)), "wide DEM (watershed)",
  );
  const g = sampleAtLatLng(section.grid, section.req, LAT, LNG);
  if (!Number.isFinite(g)) fail("3DEP returned no ground elevation at the point");
  else pass(`3DEP live — ground at the point reads ${f1(g)}′ NAVD88`);
} catch (e) { fail(`3DEP: ${e.message}`); }

// ── 2. Rainfall: NOAA Atlas 14, the ordinance-mandated source.
console.log("\nNOAA Atlas 14 (PFDS)");
let rainfall = { in1pct: null, in02pct: null, missing: ["not fetched"] };
try {
  const res = await fetch(`${PREVIEW}/api/pfds?lat=${LAT}&lon=${LNG}`);
  const table = parsePfdsText(await res.text());
  rainfall = atlas14Depths(table);
  if (rainfall.missing.length) fail(`Atlas 14 incomplete: ${rainfall.missing.join("; ")}`);
  else pass(`Atlas 14 live — 24-hr depths: 100-yr ${rainfall.in1pct}″, 500-yr ${rainfall.in02pct}″ (both required by Waller §5.C(3))`);
} catch (e) { fail(`PFDS: ${e.message}`); }

// ── 3. Soils: SSURGO through THIS BRANCH'S NEW Pages Function — its first live exercise.
console.log("\nUSDA SSURGO (via the new /api/soils Pages Function)");
let hsg = null;
try {
  const { body } = buildSdaRequest(LNG, LAT, { proxy: true });
  const res = await fetch(`${PREVIEW}/api/soils`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const soils = parseSoilResponse(await res.json());
  hsg = soils ? soils.hsg : null;
  if (!hsg) fail("SSURGO returned no hydrologic soil group at this point");
  else pass(`/api/soils live (NEW Function, first live exercise) — HSG ${hsg}, "${soils.muname}"`);
} catch (e) { fail(`/api/soils: ${e.message}`); }

// ── 4. The composed answer.
console.log("\nComposed screening BFE");
const site = 0.0025; // a ~1,800-ft-square footprint about the point, in place of a drawn parcel
const rings = [[[LAT - site, LNG - site], [LAT - site, LNG + site], [LAT + site, LNG + site], [LAT + site, LNG - site]]];
const terrain = terrainInputsForScreeningBfe({
  sectionGrid: section?.grid, sectionReq: section?.req,
  watershedGrid: watershed?.grid, watershedReq: watershed?.req,
  siteRingsLatLng: rings, lat: LAT,
});
if (!terrain.ok) {
  // A named unknown IS a correct outcome — the truncation guard and the flat-reach guard exist to
  // produce exactly this. It is only a failure if it is unnamed.
  console.log(`  · terrain inputs: UNKNOWN — ${terrain.missing.join("; ")}`);
  if (!terrain.missing.length) fail("terrain failed WITHOUT naming a missing input (LOUD-FAILURE violation)");
  else pass("terrain unavailable, and every missing input is NAMED (LOUD-FAILURE holds on real data)");
} else {
  console.log(`  · watershed ${terrain.areaAcres} ac · channel grade ${(terrain.slopeFtPerFt * 100).toFixed(3)}% · section ${terrain.section.samples} pts, ${terrain.section.reliefFt}′ relief, bed ${terrain.section.bedFt}′`);
  pass(`watershed delineated over the wide window (truncation guard did NOT trip: ${terrain.watershed.truncated === false})`);
}

const result = screeningBfeForSite({ terrain, rainfall, hsg });
if (!result.ok) {
  console.log(`  · result: UNKNOWN — ${(result.missing || [result.reason]).join("; ")}`);
  if (result.wse1pctFt != null) fail("an elevation was returned alongside a not-ok result");
  else pass("no elevation was fabricated where an input was missing (the whole point of LOUD-FAILURE)");
} else {
  const b = result.band1pctFt;
  console.log(`\n  1% (100-yr)  ≈ ${f1(result.wse1pctFt)}′   range ${f1(b.loFt)}′–${f1(b.hiFt)}′${b.openEnded ? " (open-ended)" : ""}`);
  console.log(`  0.2% (500-yr) ≈ ${f1(result.wse02pctFt)}′`);
  console.log(`  peak discharge ${result.storms.wse1pct.hydrology.qCfs} cfs · Tc ${result.inputs.tcMin} min · CN from HSG ${result.inputs.hsg}`);
  if (!(result.wse02pctFt > result.wse1pctFt)) fail("the 0.2% surface is NOT above the 1% — physically impossible from one derivation");
  else pass("the 0.2% surface sits above the 1% (both from one derivation, as §5.C(3) requires)");
  const bed = result.storms.wse1pct.bedFt;
  if (!(result.wse1pctFt > bed)) fail("the water surface is at or below the channel bed");
  else pass(`the water surface sits ${f1(result.wse1pctFt - bed)}′ above the real channel bed — physically sane`);
  if (!result.notModeled?.length || !result.clomrNote) fail("the honesty payload did not ride the real answer");
  else pass("NOT_MODELED + the CLOMR/LOMR note ride the real answer, as they must");
}

// B1089 — the panel's DEFAULT-VIEW state and its behind-the-fold detail, printed separately,
// because the visible half is now a named state and the reason/implication ride the ⓘ.
const declined = screeningDeclined(result);
if (declined) {
  console.log(`\n— what the owner SEES on the panel (default view) —\n  "… — screening can't improve it: ${declined.state}"`);
  console.log(`\n— behind the ⓘ —\n${declined.detail}\n`);
} else {
  console.log(`\n— the note the panel would show —\n${screeningStudyNote(result).trim()}\n`);
}
console.log(process.exitCode
  ? `FAILED — ${WHERE}`
  : `REAL-DATA RUN COMPLETE — every figure above is for ${WHERE} and for nowhere else.`);
