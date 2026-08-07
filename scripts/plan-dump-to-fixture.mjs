#!/usr/bin/env node
/* plan-dump-to-fixture — turn a SUPABASE dump of a real plan into a committable harness fixture.
 *
 *   node scripts/plan-dump-to-fixture.mjs <dump.json> <out.json> [--census]
 *
 * ⛔ THERE IS NO `--keep-names` PASSTHROUGH, ON PURPOSE. `redactPlan`'s `keepNames` controls the
 * plan's DISPLAY NAME and its CALLOUT TEXT with one switch, and on these plans those two are not
 * remotely comparable: the display name is "Concept D - Sylvestri Retail" and the callout text
 * names real people and what they would and would not pay. A flag that trades one for the other is
 * a flag that will eventually be passed for the harmless reason and commit the harmful thing. So
 * this script always redacts the text, and re-attaches the plan/site name afterwards — the fixture
 * is a NAMED artefact of a named plan, and there is nothing to protect in its title.
 *
 * ⛔ THE GAP THIS CLOSES, and it is a different gap from the one `scripts/extract-plan.mjs` closes.
 *
 * `extract-plan.mjs` produces a snippet the OWNER pastes into his own signed-in browser. That path
 * works and stays. But it needs him, and a session that can reach Supabase directly does not — the
 * plan is two SELECTs away. The trap on that route is stated once, here, because getting it wrong
 * is what made a real plan read as an empty one:
 *
 *   ⚠ THE ELEMENTS ARE NOT IN THE SITE ROW. `public.sites.data.els` is an EMPTY ARRAY on both of
 *   the owner's plans, and `data.elementsInRows` is true. Every element, parcel, markup, measure
 *   and callout lives in `public.site_elements`, one row each, keyed by `site_id` and discriminated
 *   by `kind` ('el' | 'parcel' | 'markup' | 'measure' | 'callout'), with `deleted_at IS NULL` as the
 *   liveness filter. Read only the site row and you will report a 47-element plan as zero elements.
 *
 * THE DUMP SHAPE this script consumes is exactly that join, already assembled:
 *
 *   { siteId, site, name, county, schemaVersion, origin, settings, elevation, layerOverrides,
 *     layerAbove, parcelDrawings, constraints, underlay, sheetOverlays,
 *     els: [...], parcels: [...], markups: [...], measures: [...], callouts: [...] }
 *
 * ⛔ THE DUMP IS AN INPUT, NEVER AN ARTEFACT. It holds the owner's raw plan — county appraisal
 * records with third-party owner names, and callout text naming real people and real deal terms.
 * Write it to a scratch directory OUTSIDE the repository and delete it when you are done. This
 * script is the boundary: what comes out of it is safe to commit, what goes into it is not.
 *
 * ⚠ AND THERE IS DELIBERATELY NO `--check` REGENERATION GUARD, which is a departure from
 * `build-bain-fixture.mjs` and is the right call. A `--check` guard needs its INPUT committed, and
 * this input is the very thing that must not be. The guard on these fixtures is
 * `test/realPlanFixtures.test.js`, which asserts each file against the owner's MEASURED CENSUS —
 * a stronger check anyway, because it catches a fixture that regenerates cleanly from a dump that
 * was itself wrong.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { redactPlan, fixtureCensus, rasterSpecOf } from "../ui-audit/lib/planFixture.mjs";

const [, , IN, OUT] = process.argv;
const CENSUS_ONLY = process.argv.includes("--census");

if (!IN) {
  console.error("usage: node scripts/plan-dump-to-fixture.mjs <dump.json> <out.json> [--census]");
  process.exit(2);
}

const dump = JSON.parse(readFileSync(IN, "utf8"));

/* `redactPlan` speaks the SAVED-PLAN shape, so the dump is presented to it as one — rasters
 * included, so that its own raster walk (the one that reports a stripped `storageKey` instead of
 * silently dropping it) runs over them rather than being bypassed. */
const asPlan = {
  schemaVersion: dump.schemaVersion,
  origin: dump.origin || null,
  county: dump.county || null,
  name: dump.name,
  site: dump.site,
  parcels: dump.parcels || [],
  parcelDrawings: dump.parcelDrawings || [],
  els: dump.els || [],
  markups: dump.markups || [],
  measures: dump.measures || [],
  callouts: dump.callouts || [],
  elevation: dump.elevation || null,
  settings: dump.settings || {},
  layerOverrides: dump.layerOverrides || {},
  layerAbove: dump.layerAbove || {},
  underlay: dump.underlay || null,
  sheetOverlays: dump.sheetOverlays || [],
};

const { fixture, stripped } = redactPlan(asPlan, { keepNames: false });
fixture.name = dump.name;
fixture.site = dump.site;

/* ⚠ `fromIdb` IS A FACT ABOUT THE ROW, NOT A DEFAULT. `rasterSpecOf` reads it from `idbKey ||
 * fromIdb`, and a `fromMap` underlay carrying a live ArcGIS `export` URL has NEITHER — it is
 * FETCHED, not read out of IndexedDB. Preserving that distinction is the whole reason the spec
 * carries the flag; overwriting it here would re-introduce the claim it exists to correct. */
fixture.rasters = [
  ...(dump.underlay ? [rasterSpecOf(dump.underlay, "underlay")] : []),
  ...(dump.sheetOverlays || []).map((o) => rasterSpecOf(o, "sheetOverlay")),
];

/* Anything the DUMP already removed before this script ever saw it — a SELECT that dropped
 * `attrs` and `storageKey` at the database is still a redaction, and a `_redacted` list that
 * silently omits it would understate what is missing from the file. Same rule as `redactPlan`'s:
 * never remove anything without naming it. */
if (dump.redactedUpstream) fixture._redacted = [...(dump.redactedUpstream || []), ...fixture._redacted];
if (dump.note) fixture._note = dump.note;

const census = fixtureCensus(fixture);
fixture._source = {
  siteId: dump.siteId,
  table: "public.sites JOIN public.site_elements ON site_id, deleted_at IS NULL",
  pulledAt: dump.pulledAt || null,
  schemaVersion: dump.schemaVersion,
};
fixture._census = {
  note: "Counted from this file by fixtureCensus at build time, and asserted against the owner's measured values in test/realPlanFixtures.test.js.",
  elements: census.elements,
  parcels: census.parcels,
  byType: census.byType,
  markups: census.markups,
  measures: census.measures,
  callouts: census.callouts,
  crossSections: census.crossSections,
};

if (CENSUS_ONLY || !OUT) {
  console.log(JSON.stringify({ census, stripped }, null, 2));
  process.exit(0);
}

writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${OUT}`);
console.log(`  ${census.elements} elements · ${census.parcels} parcels · ${census.markups} markups · ${census.measures} measures · ${census.callouts} callouts`);
console.log(`  rasters: ${census.rasters.map((r) => `${r.role} ${r.imgW}×${r.imgH} @${r.opacity}`).join(", ") || "none"}`);
console.log("  REDACTED:");
for (const s of stripped) console.log(`    · ${s}`);
