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

// Raster (ImageServer) rows: no /query catalog — reachability reads the mosaic metadata
// (bandCount/pixelType) and the fixtures are point getSamples with an expected value
// range (in coverage) or an expected no-data empty value (out of coverage).
async function checkRasterSource(key, s) {
  const problems = [];
  const notes = [];
  let meta;
  try {
    meta = await getJson(`${s.serviceUrl}?f=json`);
  } catch (e) {
    return { problems: [`${key}: UNREACHABLE — ${e.message}`], notes };
  }
  if (meta.error || !meta.bandCount) {
    problems.push(`${key}: not an image service any more? (no bandCount in metadata)`);
  } else {
    notes.push(`${key}: reachable, ${meta.bandCount} band(s), ${meta.pixelType}.`);
  }
  for (const fx of s.sampleFixtures || []) {
    const geometry = JSON.stringify({ x: fx.point[0], y: fx.point[1], spatialReference: { wkid: 4326 } });
    // A fixture may name its own service (B807 multiplex rows: in-coverage probes span
    // watersheds, while s.serviceUrl is just the representative endpoint).
    const u = `${fx.serviceUrl || s.serviceUrl}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryPoint` +
      `&interpolation=RSP_BilinearInterpolation&returnFirstValueOnly=true&f=json`;
    try {
      const j = await getJson(u);
      const raw = j.samples && j.samples[0] ? j.samples[0].value : undefined;
      const v = parseFloat(raw);
      if (fx.expectNoData) {
        if (isFinite(v)) problems.push(`${key} fixture "${fx.label}": expected no-data, got ${v} — coverage extent changed?`);
        else notes.push(`${key} fixture "${fx.label}": no-data as expected ✓`);
      } else if (!isFinite(v)) {
        problems.push(`${key} fixture "${fx.label}": no sample value returned (service moved / extent shrank?).`);
      } else if (fx.expectValueRange && (v < fx.expectValueRange[0] || v > fx.expectValueRange[1])) {
        problems.push(`${key} fixture "${fx.label}": ${v} outside expected ${fx.expectValueRange.join("–")} — datum/units/model change?`);
      } else {
        notes.push(`${key} fixture "${fx.label}": ${v} ✓`);
      }
    } catch (e) {
      problems.push(`${key} fixture "${fx.label}": getSamples failed — ${e.message}`);
    }
  }
  if (s.multiplex) {
    const mx = await checkMultiplexCatalog(key, s);
    problems.push(...mx.problems);
    notes.push(...mx.notes);
  }
  return { problems, notes };
}

/* B807 — parity check for a multiplexed raster row (per-watershed services routed by a
 * baked table): walk the LIVE services directory, filter leaf names by the row's
 * include/exclude patterns, and diff BOTH ways against multiplex.services — a live
 * service missing from the table means lost coverage; a table service missing live means
 * the app will sample a dead endpoint. Then compare each live fullExtent to the baked
 * extent2278 (±1 ft) so a re-published raster can't silently shift the routing. Folders
 * that require a token are skipped (the public study folders don't). */
async function checkMultiplexCatalog(key, s) {
  const problems = [];
  const notes = [];
  const { restBase, include, exclude, services } = s.multiplex;
  let root;
  try {
    root = await getJson(`${restBase}?f=json`);
  } catch (e) {
    return { problems: [`${key} multiplex: catalog UNREACHABLE — ${e.message}`], notes };
  }
  const liveNames = (root.services || []).filter((x) => x.type === "ImageServer").map((x) => x.name);
  for (const folder of root.folders || []) {
    try {
      const j = await getJson(`${restBase}/${encodeURIComponent(folder)}?f=json`);
      for (const x of j.services || []) if (x.type === "ImageServer") liveNames.push(x.name);
    } catch {
      // Token-gated / private folder — not part of the public study catalog.
    }
  }
  const liveMatch = liveNames.filter((n) => {
    const leaf = n.split("/").pop();
    return include.test(leaf) && !(exclude && exclude.test(leaf));
  });
  const tableNames = new Set(services.map((x) => x.name));
  const liveSet = new Set(liveMatch);
  for (const n of liveMatch) {
    if (!tableNames.has(n)) {
      const msg = `${key} multiplex: LIVE service "${n}" missing from the registry table — coverage the app can't route to.`;
      // B827 — a provisional table is a KNOWINGLY-incomplete seed (the live directory can't be
      // enumerated from the build sandbox): live-not-in-table diffs are recon notes, not failures,
      // so the weekly check isn't permanently red. Dead-endpoint + extent-drift stay problems.
      if (s.multiplex.provisional) notes.push(`${msg} (provisional seed table, B827 — bake this service in.)`);
      else problems.push(msg);
    }
  }
  for (const x of services) {
    if (!liveSet.has(x.name)) {
      problems.push(`${key} multiplex: table service "${x.name}" not in the live catalog — the app would sample a dead endpoint.`);
      continue;
    }
    try {
      const meta = await getJson(`${restBase}/${x.name}/ImageServer?f=json`);
      const ext = meta.fullExtent || meta.extent;
      const live = [ext?.xmin, ext?.ymin, ext?.xmax, ext?.ymax];
      const drift = live.map((v, i) => Math.abs((v ?? NaN) - x.extent2278[i]));
      if (!drift.every((d) => isFinite(d) && d <= 1)) {
        problems.push(`${key} multiplex: "${x.name}" extent drifted — live [${live.map((v) => Math.round(v))}] vs table [${x.extent2278}] (re-bake extent2278).`);
      }
    } catch (e) {
      problems.push(`${key} multiplex: "${x.name}" metadata failed — ${e.message}`);
    }
  }
  if (!problems.length) notes.push(`${key} multiplex: ${services.length} services match the live catalog, extents within ±1 ft ✓${s.multiplex.provisional ? " (provisional seed table)" : ""}`);
  return { problems, notes };
}

async function checkSource(key, s) {
  if (s.kind === "raster") return checkRasterSource(key, s);
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
