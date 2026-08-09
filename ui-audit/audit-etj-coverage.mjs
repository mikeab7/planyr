#!/usr/bin/env node
/* audit-etj-coverage — what the ETJ layers ACTUALLY carry, versus what the registry claims.
 *
 * B280705. The H-GAC row described itself as covering the "13-county Houston-Galveston region (all
 * cities)". It carries 34. Baytown, Katy, Humble, La Porte, Deer Park, Friendswood, League City,
 * Galveston and Tomball are not among them — and because a missing city's ETJ query SUCCEEDS and
 * returns nothing, the app read it as "this site is in no ETJ", which is a different and much more
 * consequential statement. The owner's Goose Creek is the repro: 8 of its 14 lots sit in Baytown's
 * ETJ and the app saw none of it.
 *
 * This is the check that keeps the declared `roster` honest. It queries each roster-bearing ETJ
 * source for its distinct city values and diffs them against what the registry has written down —
 * so a roster that silently grows or shrinks is caught here rather than by a mislabelled site.
 *
 * ⛔ LIVE-NETWORK, not part of `npm test`. Exits non-zero only on a real DRIFT; an unreachable
 * service is reported as unresolved, never as drift (H-GAC's org is metered and 429s under load).
 *
 * Usage: node ui-audit/audit-etj-coverage.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ETJ_SOURCES } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/jurisdiction.js"));

const asJson = process.argv.includes("--json");

async function distinctNames(source) {
  const field = source.fields && source.fields.name;
  if (!field) return null; // single-jurisdiction layer: its roster IS its nameConst
  const u = new URL(source.url + "/query");
  u.searchParams.set("f", "json");
  u.searchParams.set("where", "1=1");
  u.searchParams.set("outFields", field);
  u.searchParams.set("returnDistinctValues", "true");
  u.searchParams.set("returnGeometry", "false");
  u.searchParams.set("resultRecordCount", "1000");
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (!j.error) return [...new Set((j.features || []).map((f) => f.attributes[field]).filter(Boolean).map(String))].sort();
    } catch (_) { /* retry */ }
    await new Promise((res) => setTimeout(res, 2000 * (a + 1)));
  }
  return "unreachable";
}

const rows = [];
let drift = 0;
for (const src of ETJ_SOURCES) {
  const live = await distinctNames(src);
  if (live === null) { rows.push({ id: src.id, kind: "single-jurisdiction", declares: src.nameConst }); continue; }
  if (live === "unreachable") { rows.push({ id: src.id, unresolved: true }); continue; }
  const declared = Array.isArray(src.roster) ? src.roster : null;
  if (!declared) { rows.push({ id: src.id, liveCount: live.length, declares: "(no roster — assumed to cover its bbox)", live }); continue; }
  const norm = (a) => a.map((n) => n.trim().toUpperCase()).sort();
  const L = norm(live), D = norm(declared);
  const added = L.filter((n) => !D.includes(n));
  const removed = D.filter((n) => !L.includes(n));
  if (added.length || removed.length) drift++;
  rows.push({ id: src.id, liveCount: L.length, declaredCount: D.length, added, removed });
}

/* ⛔ NEW-1b — AUDIT THE AGGREGATOR AGAINST THE OWNER'S ACTUAL FOOTPRINT.
 *
 * "HGAC missing Baytown means it may be missing others." It does. Roster drift (above) only catches
 * a layer changing under us; this catches the layer never having carried a city we DEPEND ON. The
 * footprint is every city that holds or touches one of his sites, taken from the portfolio fixture's
 * recorded ground truth — so this asks the question of the places his work actually lands, not of an
 * abstract city list. For each city the aggregator does NOT carry, it searches ArcGIS Online for a
 * layer that city publishes itself, so the gap comes with a lead rather than just a complaint. */
const PORTFOLIO = JSON.parse(fs.readFileSync(path.join(ROOT, "ui-audit/fixtures/jurisdiction-portfolio.json"), "utf8"));
const footprint = [...new Set(PORTFOLIO.sites.flatMap((s) => [s.truth.city, ...(s.truth.near1km || [])]).filter(Boolean))].sort();
const covered = [];
const missing = [];
for (const city of footprint) {
  // A city is covered if ANY routed ETJ source declares it (roster or nameConst).
  const anySource = ETJ_SOURCES.some((src) =>
    (src.nameConst && src.nameConst.toLowerCase() === city.toLowerCase())
    || (Array.isArray(src.roster) && src.roster.some((n) => n.trim().toUpperCase() === city.trim().toUpperCase())));
  (anySource ? covered : missing).push(city);
}

async function findOwnLayer(city) {
  const q = encodeURIComponent(`${city} AND (ETJ OR "extraterritorial")`);
  try {
    const j = await (await fetch(`https://www.arcgis.com/sharing/rest/search?f=json&num=10&q=${q}`, { signal: AbortSignal.timeout(25000) })).json();
    const hit = (j.results || []).find((r) => r.url && new RegExp(city.replace(/\s+/g, ".?"), "i").test(`${r.title} ${r.owner}`));
    return hit ? { title: hit.title, owner: hit.owner, url: hit.url } : null;
  } catch (_) { return null; }
}

const leads = {};
for (const city of missing) leads[city] = await findOwnLayer(city);

if (asJson) console.log(JSON.stringify({ drift, rows, footprint: { covered, missing, leads } }, null, 2));
else {
  for (const r of rows) {
    if (r.unresolved) { console.log(`?  ${r.id} — service unreachable (reported, NOT counted as drift)`); continue; }
    if (r.kind === "single-jurisdiction") { console.log(`•  ${r.id} — single jurisdiction (${r.declares}); nothing to roster`); continue; }
    if (!r.declaredCount) { console.log(`•  ${r.id} — ${r.liveCount} cities live, ${r.declares}`); continue; }
    const ok = !r.added.length && !r.removed.length;
    console.log(`${ok ? "✅" : "❌"} ${r.id} — live ${r.liveCount} vs declared ${r.declaredCount}`);
    if (r.added.length) console.log(`   + now carried, not in the roster: ${r.added.join(", ")}`);
    if (r.removed.length) console.log(`   − in the roster, no longer carried: ${r.removed.join(", ")}`);
  }
  console.log(drift ? `\n${drift} source(s) DRIFTED — update the roster in src/shared/gis/sources.js.` : "\nNo roster drift.");
  console.log(`\n── The owner's footprint: ${footprint.length} cities hold or touch one of his sites ──`);
  console.log(`✅ carried by a routed ETJ source (${covered.length}): ${covered.join(", ") || "(none)"}`);
  console.log(`❌ NOT carried — an ETJ here reads as "no ETJ" (${missing.length}):`);
  for (const city of missing) {
    const l = leads[city];
    console.log(`   ${city}${l ? `  → publishes its own: ${l.owner} | ${l.title}\n        ${l.url}` : "  → no self-published layer found"}`);
  }
}
process.exit(drift > 0 ? 1 : 0);
