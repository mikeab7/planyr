/* GIS Source coverage / schema / reachability verifier (B369 — the live half).
 *
 * For every row in the registry (src/shared/gis/sources.js) this hits the LIVE service
 * and asserts three things — the checks that would have caught both shipping bugs:
 *   • REACHABLE + CORS-irrelevant here (server-to-server): the layer metadata returns 200
 *     with a `fields` array.
 *   • SCHEMA: every field the screen reads (outFields) still exists on the live layer —
 *     catches a silent agency field rename.
 *   • COVERAGE: each known-truth fixture returns at least its expected minimum count —
 *     a county-clipped or non-authoritative source FAILS immediately (Chambers wells
 *     14-vs-8,014 would have tripped `expectMinCount: 1000`).
 *
 * Exit 0 = all good; exit 1 = at least one problem (the weekly drift workflow turns a
 * non-zero exit into a @claude GitHub issue with this report).
 *
 *   node gis-verify/gis-source-coverage-verify.mjs
 *
 * NOTE on the sandbox: outbound HTTPS is allow-listed, and gis.rrc.texas.gov is NOT on
 * the sandbox list — so the RRC rows will report "unreachable" HERE. That is expected;
 * this script is meant to run in CI / GitHub Actions (open internet) or anywhere RRC is
 * reachable. A sandbox run still verifies the FEMA / TxGIO / TxDOT / NWI rows.
 */
import { GIS_SOURCES, outFieldsFor } from "../src/shared/gis/sources.js";

const TIMEOUT_MS = 20000;

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

// The full layer endpoint(s) for a row: the serviceUrl already carries the layer index
// for the FeatureServer rows (layerId null); the MapServer rows append /<layerId>.
function layerEndpoints(s) {
  const ids = Array.isArray(s.layerId) ? s.layerId : s.layerId != null ? [s.layerId] : [null];
  return ids.map((id) => ({ id, url: id != null ? `${s.serviceUrl}/${id}` : s.serviceUrl }));
}

function envelopeParam(fixture) {
  if (fixture.bbox) return fixture.bbox.join(",");
  const [lng, lat] = fixture.point;
  const d = 0.01; // ~1 km envelope around the point
  return [lng - d, lat - d, lng + d, lat + d].join(",");
}

async function checkSource(key, s) {
  const problems = [];
  const notes = [];
  const eps = layerEndpoints(s);

  // 1) reachability + schema (per layer)
  for (const ep of eps) {
    let meta;
    try {
      meta = await getJson(`${ep.url}?f=json`);
    } catch (e) {
      problems.push(`${key} layer ${ep.id ?? "(root)"}: UNREACHABLE — ${e.message}`);
      continue;
    }
    const fields = (meta.fields || []).map((f) => String(f.name).toLowerCase());
    if (!fields.length) { problems.push(`${key} layer ${ep.id ?? "(root)"}: no fields array (not a queryable layer?)`); continue; }
    // schema: every named field we request must exist (skip the joined-layer "*" override)
    if (!(s.outFields && s.outFields.includes("*"))) {
      for (const col of Object.values(s.fields || {}).filter(Boolean)) {
        if (!fields.includes(String(col).toLowerCase())) {
          problems.push(`${key} layer ${ep.id ?? "(root)"}: field "${col}" not found on the live layer (renamed/removed?).`);
        }
      }
    }
    notes.push(`${key} layer ${ep.id ?? "(root)"}: reachable, ${fields.length} fields.`);
  }

  // 2) coverage fixtures (the 14-vs-8,014 guard)
  for (const fx of s.fixtures || []) {
    const ep = fx.layer != null ? eps.find((e) => e.id === fx.layer) || eps[0] : eps[0];
    const params = new URLSearchParams({
      f: "json", where: "1=1",
      geometry: envelopeParam(fx), geometryType: "esriGeometryEnvelope",
      spatialRel: "esriSpatialRelIntersects", inSR: "4326", returnCountOnly: "true",
    });
    try {
      const j = await getJson(`${ep.url}/query?${params}`);
      const count = j.count ?? (j.features ? j.features.length : null);
      if (count == null) { problems.push(`${key} fixture "${fx.label}": no count in response.`); continue; }
      if (count < fx.expectMinCount) {
        problems.push(`${key} fixture "${fx.label}": got ${count}, expected ≥ ${fx.expectMinCount} — coverage/authority regression (county-clipped or non-authoritative source?).`);
      } else {
        notes.push(`${key} fixture "${fx.label}": ${count} ≥ ${fx.expectMinCount} ✓`);
      }
    } catch (e) {
      problems.push(`${key} fixture "${fx.label}": query failed — ${e.message}`);
    }
  }

  return { problems, notes };
}

const allProblems = [];
const allNotes = [];
for (const [key, s] of Object.entries(GIS_SOURCES)) {
  const { problems, notes } = await checkSource(key, s);
  allProblems.push(...problems);
  allNotes.push(...notes);
}

console.log("--- GIS source coverage verify ---");
for (const n of allNotes) console.log("  ✓ " + n);
console.log(`outFields sanity: oilgas=${outFieldsFor(GIS_SOURCES.oilgas)} · pipelines=${outFieldsFor(GIS_SOURCES.pipelines)}`);
if (allProblems.length) {
  console.error("\n✗ PROBLEMS:");
  for (const p of allProblems) console.error("  - " + p);
  console.error(`\n${allProblems.length} problem(s).`);
  process.exit(1);
}
console.log("\n✓ All GIS sources reachable, schema intact, coverage fixtures met.");
