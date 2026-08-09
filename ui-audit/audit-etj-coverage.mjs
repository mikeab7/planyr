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

if (asJson) console.log(JSON.stringify({ drift, rows }, null, 2));
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
}
process.exit(drift > 0 ? 1 : 0);
