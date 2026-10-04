#!/usr/bin/env node
/* audit-dfw-etj-gaps — the second DFW ETJ sweep (NEW-2), asked of the LIVE endpoints, plus the county report.
 *
 *   1. every fixture point of every ETJ row that covers DFW (the new publishers AND Fort Worth's fresher copy)
 *      run through the REAL identify: it must name the ETJ, in no city, and NOT read "unavailable";
 *   2. Dallas County's withheld polygons: the filtered layer must return exactly (all − withheld);
 *   3. the county table (ui-audit/lib/dfwEtjCounties.mjs) printed — source, publisher date, or
 *      "no published ETJ data found" with the mechanisms tried.
 *
 * The spatial-join tool that derived the withheld list and the city names for the layers that publish none is
 * `ui-audit/tools/dfw-etj-spatial-join.py` (needs `pip install shapely`; run it to re-derive).
 *
 * ⛔ LIVE-NETWORK, not part of `npm test`.  NODE_USE_ENV_PROXY=1 node ui-audit/audit-dfw-etj-gaps.mjs
 * Exits non-zero on a real failure; an unreachable service fails too (a coverage audit that cannot see coverage
 * has proved nothing).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const J = await import(path.join(ROOT, "src/workspaces/site-planner/lib/jurisdiction.js"));
const { createGisCache } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/gisCache.js"));
const { GIS_SOURCES } = await import(path.join(ROOT, "src/shared/gis/sources.js"));
const { SOURCE_FIXTURES } = await import(path.join(ROOT, "src/shared/gis/sourceFixtures.js"));
const { DFW_ETJ_COUNTIES, DFW_ETJ_COUNTIES_OUTSIDE_CIRCLE } = await import(path.join(ROOT, "ui-audit/lib/dfwEtjCounties.mjs"));

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; };
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const ident = (lng, lat) => J.identifyJurisdiction(lng, lat, { cache: createGisCache({ store: memStore(), now: () => Date.now() }), roles: ["county", "city", "etj"] });

// Hosts the build sandbox's egress policy denies; asserted from a browser by verify-dfw-etj-browser-hosts.mjs.
const BROWSER_ONLY = new Set(["etj_fortworth", "etj_denton", "etj_release_fortworth"]);
const IDS = ["etj_fortworth", "etj_dallasco", "etj_ellis", "etj_waxahachie", "etj_johnson", "etj_grayson", "etj_corsicana", "etj_bloominggrove", "etj_forney", "etj_talty", "etj_mansfield", "etj_sunnyvale"];
for (const id of IDS) {
  const row = J.ETJ_SOURCES.find((s) => s.id === id);
  const names = new Set([...(row.roster || []), row.nameConst].filter(Boolean).map((n) => n.toLowerCase()));
  for (const f of SOURCE_FIXTURES[id].fixtures) {
    if (BROWSER_ONLY.has(id)) { console.log(`⏭  ${id} · ${f.label} — SKIPPED: host unreachable from this environment (browser harness asserts it)`); continue; }
    const [lng, lat] = f.point;
    const j = await ident(lng, lat);
    const named = j.etj.some((e) => names.has(e.toLowerCase()) || id === "etj_fortworth" && /fort worth/i.test(e));
    check(`${id} · ${f.label}`, named && j.city.length === 0 && !j.etjUnavailable, `etj=${JSON.stringify(j.etj)} city=${JSON.stringify(j.city)} unavailable=${j.etjUnavailable}`);
  }
}

// 2 — the withheld filter, live
{
  const base = GIS_SOURCES.etj_dallasco.serviceUrl + "/query?returnCountOnly=true&f=json&where=";
  const get = async (w) => (await (await fetch(base + encodeURIComponent(w), { signal: AbortSignal.timeout(40000) })).json()).count;
  const all = await get("1=1"), kept = await get(GIS_SOURCES.etj_dallasco.where);
  check("Dallas County: filtered layer = all − withheld", all - GIS_SOURCES.etj_dallasco.withheld.objectIds.length === kept, `${all} − ${GIS_SOURCES.etj_dallasco.withheld.objectIds.length} = ${kept} (filtered returns ${kept})`);
}

// 3 — the report
console.log("\n── DFW ETJ coverage by county (the 50-mile circle touches these 19; share of the circle) ──");
for (const c of DFW_ETJ_COUNTIES) {
  const src = c.sources.map((s) => `${s}${GIS_SOURCES[s].dataLastEdited ? " (" + GIS_SOURCES[s].dataLastEdited + ")" : ""}`).join(", ");
  console.log(`• ${c.county} County [${c.share}%] — ${c.status.toUpperCase()}${c.date ? " · newest publisher date " + c.date : ""}`);
  if (src) console.log(`    sources: ${src}`);
  console.log(`    ${c.note}`);
  if (c.tried) for (const t of c.tried) console.log(`    tried: ${t}`);
}
console.log(`\nOn the brief's list but NOT reached by the circle: ${DFW_ETJ_COUNTIES_OUTSIDE_CIRCLE.join(", ")}.`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED.` : `\nAll ${results.length} DFW gap checks passed.`);
process.exit(failed.length ? 1 : 0);
