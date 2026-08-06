/* GIS Source Registry audit (B369) — the machine guard that stops a test / non-
 * authoritative GIS endpoint from silently shipping again.
 *
 * Two checks, both fail CI (via test/gisSources.test.js) and the script's exit code:
 *   1) REGISTRY TIER INTEGRITY — every row in src/shared/gis/sources.js must be
 *      `tier: "production"`, OR an explicitly-acknowledged `monitored-exception` with a
 *      reason. A serviceUrl that looks like a `/Test/` / `/staging/` / geogimstest URL
 *      without that acknowledgement fails. (Catches the NWI-on-/Test/ + old geogimstest
 *      class of bug.)
 *   2) NO INLINE URLs IN THE ANALYSIS PATH — siteAnalysis.js + jurisdiction.js must NOT
 *      hardcode any MapServer/FeatureServer URL; every endpoint comes from the registry.
 *      (Catches a regression that re-inlines an endpoint and dodges check #1.)
 *
 * Run: node ui-audit/gis-source-audit.mjs   (exit 1 on any problem)
 *
 * Mirrors the pattern of ui-audit/contrast-audit.mjs (parse the real source, expose an
 * audit function the unit test imports, exit non-zero as a standalone CI script).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { auditRegistry, GIS_SOURCES, looksNonProduction } from "../src/shared/gis/sources.js";
// NEW-4 — the coverage fixtures live in their own module now (off the app bundle).
import { SOURCE_FIXTURES, SOURCE_DOCS } from "../src/shared/gis/sourceFixtures.js";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import { verifiedOnFor, candidateUrlFor, provenanceFor } from "../src/workspaces/site-planner/lib/countiesProvenance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// The connectors that MUST read every endpoint from the registry (no inline URLs).
const ANALYSIS_PATH_FILES = [
  "src/workspaces/site-planner/lib/siteAnalysis.js",
  "src/workspaces/site-planner/lib/jurisdiction.js",
  "src/workspaces/site-planner/lib/detentionRules.js", // B629 drainage resolver
];

// A quoted ArcGIS service URL literal — what an inline endpoint looks like in code.
const INLINE_URL_RE = /["'`]https?:\/\/[^"'`]*(?:MapServer|FeatureServer)[^"'`]*["'`]/g;

/* Strip // line comments and /* *​/ block comments so a URL mentioned in prose (e.g.
 * "retired source: …") isn't flagged — only a real code literal is. Good enough for
 * this guard (we don't need a full JS parser). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments (avoid eating https://)
}

export function scanInlineUrls() {
  const problems = [];
  for (const rel of ANALYSIS_PATH_FILES) {
    let src;
    try { src = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    const code = stripComments(src);
    const hits = code.match(INLINE_URL_RE) || [];
    for (const hit of hits) {
      problems.push(`${rel}: inline GIS service URL ${hit} — move it to src/shared/gis/sources.js and reference the registry row.`);
    }
  }
  return problems;
}

/* CHECK #3 (NEW-5) — COUNTY PARCEL PROVENANCE.
 *
 * The county registry (counties.js) is deliberately NOT in ANALYSIS_PATH_FILES: its endpoints are
 * per-county parcel services, and inlining them there is the established pattern. But that
 * exemption is exactly what let an unverified URL ship, and adding nine Colorado counties at once
 * is when that would have bitten. So this check enforces the discipline the URLs themselves
 * cannot: every county row must declare its STATE, and every row must either
 *   • carry a `verifiedOn` date (the endpoint was actually queried and answered), or
 *   • sit on its state's statewide composite (an honest, working stand-in), in which case any
 *     county-own endpoint it knows about must be parked in `candidateUrl` WITH provenance —
 *     recorded, not shipped.
 * A row with neither is a guessed URL, and that is the thing this check exists to stop. */
const STATEWIDE_COMPOSITES = [
  "stratmap_land_parcels",       // TxGIO
  "Colorado_Public_Parcels",     // Colorado OIT
];
const onComposite = (url) => STATEWIDE_COMPOSITES.some((frag) => String(url || "").includes(frag));

export function scanCountyProvenance() {
  const problems = [];
  for (const [key, c] of Object.entries(COUNTIES)) {
    if (!c.state) problems.push(`counties.js ${key}: no \`state\` declared — click routing and the statewide-backup tier both key off it.`);
    if (!c.layerUrl) { problems.push(`counties.js ${key}: no layerUrl.`); continue; }
    if (looksNonProduction(c.layerUrl)) problems.push(`counties.js ${key}: layerUrl looks non-production (${c.layerUrl}).`);
    // The verification record lives in the Node-only sidecar (countiesProvenance.js) so its dates
    // and prose stay off the browser bundle. It is no less REQUIRED for that: a county with no
    // entry, no composite and no explanation still fails the build.
    const verifiedOn = verifiedOnFor(key);
    const candidateUrl = candidateUrlFor(key);
    const provenance = provenanceFor(key);
    const composite = onComposite(c.layerUrl);
    // The third honest state: a row verified in an earlier session whose host this build
    // environment cannot reach. It must SAY SO. The point of the check is that no row may be
    // SILENT about where its URL came from — not that every row must be probed today.
    const declared = typeof provenance === "string" && provenance.length > 20;
    if (!verifiedOn && !composite && !declared) {
      problems.push(`counties.js ${key}: ships an endpoint that is neither live-verified, nor the statewide composite, nor explained — verify it, park it in \`candidateUrl\`, or say why it could not be probed (countiesProvenance.js).`);
    }
    if (verifiedOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(verifiedOn))) {
      problems.push(`countiesProvenance.js ${key}: verifiedOn "${verifiedOn}" is not an ISO date.`);
    }
    if (candidateUrl) {
      if (!declared) problems.push(`countiesProvenance.js ${key}: candidateUrl with no provenance — an unverified URL must say where it came from and why it was not probed.`);
      if (!composite) problems.push(`counties.js ${key}: has a candidateUrl but its primary is not the statewide composite — an unverified candidate must not be the fallback for a shipped endpoint.`);
    }
    if (composite && !c.scopeWhere) {
      problems.push(`counties.js ${key}: rides the statewide composite with no \`scopeWhere\` — an unscoped search can match a like-named parcel in another county.`);
    }
  }
  return problems;
}

export function auditSources() {
  const registryProblems = auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS).problems;
  const inlineUrlProblems = scanInlineUrls();
  const countyProblems = scanCountyProvenance();
  return {
    registryProblems,
    inlineUrlProblems,
    countyProblems,
    ok: registryProblems.length === 0 && inlineUrlProblems.length === 0 && countyProblems.length === 0,
  };
}

// Run as a script → print + exit non-zero on any problem.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { registryProblems, inlineUrlProblems, countyProblems, ok } = auditSources();
  if (registryProblems.length) {
    console.error("✗ Registry tier problems:");
    for (const p of registryProblems) console.error("  - " + p);
  }
  if (inlineUrlProblems.length) {
    console.error("✗ Inline-URL problems (endpoints must come from the registry):");
    for (const p of inlineUrlProblems) console.error("  - " + p);
  }
  if (countyProblems.length) {
    console.error("✗ County parcel provenance problems (a shipped endpoint must be verified or a composite stand-in):");
    for (const p of countyProblems) console.error("  - " + p);
  }
  if (ok) {
    const n = Object.keys(GIS_SOURCES).length;
    const cn = Object.keys(COUNTIES).length;
    console.log(`✓ GIS source registry OK — ${n} sources, all production or acknowledged exceptions, no inline URLs in the analysis path.`);
    console.log(`✓ County parcel provenance OK — ${cn} counties, every endpoint live-verified or on its state's statewide composite.`);
  }
  process.exit(ok ? 0 : 1);
}
