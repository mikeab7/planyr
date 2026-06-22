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
import { auditRegistry, GIS_SOURCES } from "../src/shared/gis/sources.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// The connectors that MUST read every endpoint from the registry (no inline URLs).
const ANALYSIS_PATH_FILES = [
  "src/workspaces/site-planner/lib/siteAnalysis.js",
  "src/workspaces/site-planner/lib/jurisdiction.js",
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

export function auditSources() {
  const registryProblems = auditRegistry(GIS_SOURCES).problems;
  const inlineUrlProblems = scanInlineUrls();
  return {
    registryProblems,
    inlineUrlProblems,
    ok: registryProblems.length === 0 && inlineUrlProblems.length === 0,
  };
}

// Run as a script → print + exit non-zero on any problem.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { registryProblems, inlineUrlProblems, ok } = auditSources();
  if (registryProblems.length) {
    console.error("✗ Registry tier problems:");
    for (const p of registryProblems) console.error("  - " + p);
  }
  if (inlineUrlProblems.length) {
    console.error("✗ Inline-URL problems (endpoints must come from the registry):");
    for (const p of inlineUrlProblems) console.error("  - " + p);
  }
  if (ok) {
    const n = Object.keys(GIS_SOURCES).length;
    console.log(`✓ GIS source registry OK — ${n} sources, all production or acknowledged exceptions, no inline URLs in the analysis path.`);
  }
  process.exit(ok ? 0 : 1);
}
