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
 * NOTE on the sandbox: outbound HTTPS is allow-listed, so some hosts report "unreachable"
 * HERE (HTTP 403 at the egress proxy) purely because of the sandbox's policy, not because the
 * service is down. As of 2026-08-05 that is: gisclient.quiddity.com (the whole BKDD family),
 * txgeo.usgs.gov (femaEbfe) and — separately, and this one IS genuinely dead —
 * fximgservices.hcfcd.org. This script is meant to run in CI / GitHub Actions (open internet).
 * To probe a sandbox-blocked-but-allow-listed host from here, route it through the app's own
 * same-origin GIS proxy: https://planyr.io/api/gis-cache/svc/<b64url(serviceUrl)>/<op>?<query>
 * (that is how femaEbfe's 20/24 layer ids and its live values were confirmed).
 * A sandbox run still verifies every ArcGIS-Online row, incl. all fourteen Colorado rows.
 */
import { GIS_SOURCES, outFieldsFor, auditRegistry, availabilityOf, fixtureCount } from "../src/shared/gis/sources.js";
// NEW-4 — the coverage fixtures live beside the registry but OFF the app bundle (they are
// assertions, not endpoint facts, and sources.js is on the Site route's critical path).
import { SOURCE_FIXTURES, SOURCE_DOCS, fixturesFor } from "../src/shared/gis/sourceFixtures.js";

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
  for (const fx of fixturesFor(key).sampleFixtures || []) {
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

/* B882 — reachability + layer-presence check for a MapServer whose sublayers are RASTERS
 * read via /identify (FEMA InFRM EBFE): confirm the service root answers and that each
 * identifyLayer id still exists in the live layer list (a renamed/renumbered raster would
 * silently break the point sampler).
 *
 * NEW-1 — it now also RUNS THE IDENTIFY and checks the VALUE, because the shape check alone
 * passed for weeks while the sampler returned a permanent silent null. The layer ids were
 * "present" (17/21 exist) — they were just the wrong KIND of layer (mosaic GROUPS, whose ids
 * identify never reports back), and no shape check can see that. Only a real value probe can.
 * The probe is deliberately the same request the app makes, folded the same way. */
function identifyUrlFor(s, lng, lat, boxDeg = 0.005) {
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const mapExtent = [lng - boxDeg, lat - boxDeg, lng + boxDeg, lat + boxDeg].join(",");
  const ids = Object.values(s.identifyLayers || {}).join(",");
  return `${s.serviceUrl}/identify?geometry=${encodeURIComponent(geometry)}` +
    `&geometryType=esriGeometryPoint&sr=4326&layers=${encodeURIComponent(`all:${ids}`)}` +
    `&tolerance=1&mapExtent=${encodeURIComponent(mapExtent)}&imageDisplay=101,101,96` +
    `&returnGeometry=false&f=json`;
}

// The pixel value out of one identify result, using the row's declared attribute names.
function identifyPixelValue(result, attrNames) {
  if (!result) return null;
  const a = result.attributes || {};
  for (const n of attrNames) {
    const raw = a[n];
    if (raw == null) continue;
    const str = String(raw).trim();
    if (!str || /^nodata$/i.test(str)) continue;
    const v = parseFloat(str);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

async function checkIdentifySource(key, s) {
  const problems = [];
  const notes = [];
  let meta;
  try {
    meta = await getJson(`${s.serviceUrl}?f=json`);
  } catch (e) {
    return { problems: [`${key}: identify MapServer UNREACHABLE — ${e.message}`], notes };
  }
  const liveIds = new Set((meta.layers || []).map((l) => l.id));
  const byId = new Map((meta.layers || []).map((l) => [l.id, l]));
  for (const [role, id] of Object.entries(s.identifyLayers || {})) {
    if (!liveIds.has(id)) {
      problems.push(`${key}: identify layer ${id} (${role}) not in the live service — renamed/renumbered? (re-map identifyLayers)`);
      continue;
    }
    // NEW-1 — a MOSAIC/GROUP layer id is the exact trap that made this source silent: identify
    // reports its SUBLAYERS, never the group, so the fold never matched. Refuse one outright.
    const t = String((byId.get(id) || {}).type || "");
    if (/Mosaic Layer|Group Layer/i.test(t)) {
      problems.push(`${key}: identify layer ${id} (${role}) is a "${t}" — identify NEVER reports a group/mosaic id back, so the fold can never match it. Point identifyLayers at the "… Image" RASTER sublayer.`);
    }
  }
  const attrs = s.pixelAttributes || ["Pixel Value", "Stretched.Pixel Value"];
  for (const fx of fixturesFor(key).sampleFixtures || []) {
    try {
      const j = await getJson(identifyUrlFor(s, fx.point[0], fx.point[1]));
      const wanted = new Set(Object.values(s.identifyLayers || {}));
      let v = null;
      for (const r of j.results || []) {
        if (!wanted.has(r.layerId)) continue;
        const pv = identifyPixelValue(r, attrs);
        if (pv != null) { v = pv; break; }
      }
      if (fx.expectNoData) {
        if (v != null) problems.push(`${key} fixture "${fx.label}": expected no-data, got ${v} — coverage extent changed?`);
        else notes.push(`${key} fixture "${fx.label}": no-data as expected ✓`);
      } else if (v == null) {
        problems.push(`${key} fixture "${fx.label}": identify returned NO value. Either coverage moved, or the identifyLayers / pixelAttributes no longer match what this service reports.`);
      } else if (fx.expectValueRange && (v < fx.expectValueRange[0] || v > fx.expectValueRange[1])) {
        problems.push(`${key} fixture "${fx.label}": ${v} outside expected ${fx.expectValueRange.join("–")} — datum/units/model change?`);
      } else {
        notes.push(`${key} fixture "${fx.label}": ${v} ✓`);
      }
    } catch (e) {
      problems.push(`${key} fixture "${fx.label}": identify failed — ${e.message}`);
    }
  }
  if (!problems.length) notes.push(`${key}: identify MapServer reachable; layers ${Object.values(s.identifyLayers || {}).join(", ")} present ✓`);
  return { problems, notes };
}

async function checkSource(key, s) {
  if (s.kind === "raster") return checkRasterSource(key, s);
  if (s.kind === "raster-identify") return checkIdentifySource(key, s);
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
  for (const fx of fixturesFor(key).fixtures || []) {
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

/* NEW-1 — an ACKNOWLEDGED-OUTAGE row is checked the other way round.
 *
 * `hcfcdMaapnext` is genuinely dead (its whole ImageServer host hangs), and there is no
 * replacement to repoint at. Two bad options and one good one:
 *   • leave it "production" and let the weekly job stay green — that is precisely the state
 *     that let it rot unnoticed, and the reason this task exists;
 *   • let it fail every week — a permanently red guard is a guard nobody reads.
 * So a row declared `availability: "down"` INVERTS: the check asserts it is STILL down, and a
 * row that starts answering again is reported as a PROBLEM — "recovered, flip it back to live"
 * — which is the one message we actually want on the day it comes back. `degraded` is softer:
 * a failure is reported as a note (we already know it is flaky) but a recovery is not, because
 * a degraded row is expected to answer some of the time. */
async function checkWithAvailability(key, s) {
  const av = availabilityOf(s);
  const r = await checkSource(key, s);
  if (av === "live") return r;
  const reachFailed = r.problems.length > 0;
  if (av === "down") {
    if (reachFailed) {
      return {
        problems: [],
        notes: [`${key}: STILL DOWN as declared (since ${s.outage.since}) — ${s.outage.symptom}. Falls through to: ${s.outage.replacement}.`],
      };
    }
    return {
      problems: [
        `${key}: RECOVERED — the registry declares it down (since ${s.outage.since}) but every check now passes. ` +
        `Set availability back to "live", drop the outage record, and re-enable the sampler.`,
      ],
      notes: r.notes,
    };
  }
  // degraded — a failure is expected-ish; keep it visible but don't fail the build on it.
  return {
    problems: [],
    notes: reachFailed
      ? [`${key}: DEGRADED as declared (since ${s.outage.since}) — ${s.outage.symptom}. This run: ${r.problems.join(" | ")}`]
      : [...r.notes, `${key}: degraded row answered cleanly this run (declared flaky since ${s.outage.since}).`],
  };
}

const allProblems = [];
const allNotes = [];

/* NEW-1 — the STRUCTURAL guard, run before a single request goes out. `auditRegistry` now fails
 * a row that carries no coverage fixture at all, which is the hole that hid both dead flood
 * layers: a fixture-less row has nothing for this script to assert, so it can never go red. */
const audit = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS);
allProblems.push(...audit.problems.map((p) => `registry: ${p}`));
const noFixture = Object.keys(GIS_SOURCES).filter((k) => fixtureCount(null, fixturesFor(k)) === 0);
allNotes.push(`registry: ${Object.keys(GIS_SOURCES).length} rows, ${noFixture.length} without a coverage fixture (must be 0).`);

for (const [key, s] of Object.entries(GIS_SOURCES)) {
  const { problems, notes } = await checkWithAvailability(key, s);
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
