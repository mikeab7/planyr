#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * verify-jurisdiction-portfolio — RUN THE WHOLE PORTFOLIO, not one site.
 *
 * The owner's report (2026-08-08): "Go and check every site I have, the labels are generally hit
 * or miss on accuracy." Every prior jurisdiction item in this repo was argued from ONE site —
 * B793 from a Katy sliver, B209506 from Bain — and each fixed the shape it was shown. This is the
 * instrument that asks the question of all of them at once, because the portfolio SHAPE is the
 * finding: 20 of his 28 Texas sites are UNINCORPORATED, and 17 of those have a city polygon
 * within a kilometre, so the sliver trap is loaded almost everywhere.
 *
 * WHAT IT DOES. For each site in the fixture it drives the REAL `identifyJurisdiction` +
 * `formatJurisdictionBadge` — the same two functions the header pill calls — against the REAL,
 * LIVE agency services (TxDOT counties · TxGIO city limits · H-GAC ETJ), using each site's REAL
 * active parcel rings, and prints the badge string the app would show. It then checks that string
 * against the fixture's recorded ground truth:
 *
 *   in-city      → the badge NAMES that city and does not read "Unincorporated"
 *   ETJ          → the badge reads "Unincorporated" and NAMES the ETJ city
 *   no-ETJ       → the badge reads "Unincorporated"; any nearby city is DEMOTED, never the lead
 *
 * ⛔ IT IS A LIVE-NETWORK HARNESS AND IS NOT PART OF `npm test`. The agency services are exactly
 * the flaky dependency this whole item is about, so a network failure here is reported as
 * UNRESOLVED — never as a pass and never as a label failure. The CI-runnable half is
 * `test/jurisdictionShapes.test.js`, which pins the same four shapes against recorded fixtures.
 *
 * Usage:  node ui-audit/verify-jurisdiction-portfolio.mjs [--json] [--site <name>]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const { identifyJurisdiction, formatJurisdictionBadge } =
  await import(path.join(ROOT, "src/workspaces/site-planner/lib/jurisdiction.js"));
const { feetToLatLngPair } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/mapLock.js"));
const { representativeRing, ringCentroid } =
  await import(path.join(ROOT, "src/workspaces/site-planner/lib/siteAnalysis.js"));

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const onlySite = args.includes("--site") ? args[args.indexOf("--site") + 1] : null;

/* A Node-safe stand-in for the browser SWR cache. `identifySource` only needs `.swr(key, fetcher,
 * {ttl})` → `{cached, stale, fresh}`; the real one persists to IndexedDB, which does not exist
 * here. Keeping it in-memory per run is also what makes the run HONEST: nothing is served from a
 * copy an earlier run left behind. */
function memoryCache() {
  const store = new Map();
  return {
    swr(key, fetcher, _opts) {
      const hit = store.get(key);
      if (hit) return { cached: { data: hit, ageMs: 0, ts: Date.now() }, stale: false, fresh: Promise.resolve({ data: hit, ageMs: 0, ts: Date.now() }) };
      const fresh = fetcher()
        .then((data) => { store.set(key, data); return { data, ageMs: 0, ts: Date.now(), updated: true }; })
        .catch((error) => ({ data: [], ageMs: null, ts: null, error }));
      return { cached: null, stale: false, fresh };
    },
  };
}

/* The agency fetch. `fetchArcgisJson`'s browser default is fine in Node, but it retries against a
 * global AbortController the sandbox does not always honour, so this is the same contract done
 * plainly: a JSON error payload is an ERROR (ArcGIS answers 200 with `{error}`), not empty data. */
const fetchJson = async (url) => {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (j && j.error) { last = new Error(j.error.message || "ArcGIS error"); }
      else return j;
    } catch (e) { last = e; }
    // The agency hosts throttle a tight sweep; back off hard so a slow answer is not read as a
    // dead one. A wall of "couldn't check" says nothing about the labels.
    await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
  }
  throw last || new Error("unreachable");
};

const FIXTURE = path.join(ROOT, "ui-audit/fixtures/jurisdiction-portfolio.json");
const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

const norm = (s) => String(s || "").toLowerCase().replace(/^city of\s+/, "").trim();

/* The verdict for ONE site: does the badge string agree with the recorded ground truth?
 * Three shapes, and the third is the one this whole item exists for. */
function judge(site, badge) {
  const jur = badge ? badge.jur : "";
  const leadsUninc = /^Unincorporated/.test(jur);
  const problems = [];
  if (!badge) return { ok: false, problems: ["no badge produced"] };
  if (badge.unresolvedRoles && badge.unresolvedRoles.length) {
    return { unresolved: true, problems: [`lookup failed: ${badge.unresolvedRoles.join(", ")}`] };
  }
  /* The rule being checked is the owner's, stated verbatim on NEW-1: a site whose land is in no
   * city reads UNINCORPORATED, and any city that merely touches it "appears only after the
   * governing answer, clearly marked as a touch and never as the site's jurisdiction."
   *
   * `truth` is the containment answer at the site's ORIGIN — one point. That is the right check for
   * "did the app claim a city where the ground says none", and it is NOT a whole-site answer: a
   * drawn assemblage can genuinely straddle a city limit that its origin sits outside of (Goose
   * Creek and Tsakiris both do). So a QUALIFIED city — "part in", an ETJ, an edge-only touch — is
   * always acceptable; only a BARE city lead is a mislabel. */
  const bare = jur.split(" / ").filter((p) => /^City of /.test(p) && !/· ETJ|· edge only|· touches/.test(p));
  if (site.truth.city) {
    if (leadsUninc) problems.push(`in ${site.truth.city} city limits but the badge leads "Unincorporated"`);
    if (!jur.toLowerCase().includes(norm(site.truth.city))) problems.push(`does not name ${site.truth.city}`);
  } else {
    if (bare.length) problems.push(`names "${bare[0]}" as the site's jurisdiction — the land at the origin is in no city`);
    else if (!leadsUninc && !/^Part in City of/.test(jur)) problems.push(`UNINCORPORATED but the badge leads "${jur.split(" / ")[0]}"`);
    // The ETJ has to be named AS an ETJ — a city that happens to appear as an edge-only sliver is
    // not the ETJ answer, and on 16 of these sites the ETJ is the governing floodplain rule.
    if (site.truth.etj) {
      const named = jur.split(" / ").some((p) => /· ETJ$/.test(p) && norm(p.replace(/ · ETJ$/, "")) === norm(site.truth.etj));
      if (!named) problems.push(`in the ${site.truth.etj} ETJ but the badge does not name it as an ETJ`);
    }
  }
  return { ok: problems.length === 0, problems };
}

const rows = [];
for (const site of fixture.sites) {
  if (onlySite && site.site !== onlySite) continue;
  const rings = (site.rings || [])
    .filter((r) => r.length >= 3)
    // The fixture stores each vertex as a bare [x, y] pair; the projection reads `.x`/`.y` and
    // silently answers 0 for a missing field, so a pair handed over raw collapses the whole ring
    // onto the origin and every query comes back empty. Convert explicitly.
    .map((r) => r.map(([x, y]) => { const [lat, lng] = feetToLatLngPair({ x, y }, site.lat, site.lon); return [lng, lat]; }));
  if (!rings.length) { rows.push({ site: site.site, badge: null, verdict: { skipped: true, problems: ["no active parcel geometry — the app shows no badge"] } }); continue; }
  const rep = representativeRing(rings);
  const c = ringCentroid(rep);
  let badge = null, err = null;
  try {
    const j = await identifyJurisdiction(c.lng, c.lat, {
      // `rings` is the whole assemblage; `ring` stays the representative lot the boundary tests use.
      ring: rep, rings, roles: ["county", "city", "etj"], cache: memoryCache(), fetchJson,
    });
    badge = formatJurisdictionBadge(j);
  } catch (e) { err = String(e && e.message || e); }
  const verdict = err ? { unresolved: true, problems: [err] } : judge(site, badge);
  rows.push({ site: site.site, truth: site.truth, badge: badge ? badge.text : null, verdict });
  // Pace the sweep. Twenty-eight sites is ~110 queries at three agencies; fired back to back they
  // throttle, and a throttled run reads as a wall of "couldn't check" that says nothing about the
  // labels. Slower and honest beats fast and unreadable.
  await new Promise((res) => setTimeout(res, 400));
  if (!asJson) {
    const mark = verdict.skipped ? "–" : verdict.unresolved ? "?" : verdict.ok ? "✅" : "❌";
    console.log(`${mark} ${site.site.padEnd(19)} ${badge ? badge.text : "(no badge)"}`);
    for (const p of verdict.problems || []) console.log(`   ↳ ${p}`);
  }
}

const pass = rows.filter((r) => r.verdict.ok).length;
const fail = rows.filter((r) => r.verdict.problems && r.verdict.problems.length && !r.verdict.skipped && !r.verdict.unresolved).length;
const unresolved = rows.filter((r) => r.verdict.unresolved).length;
const skipped = rows.filter((r) => r.verdict.skipped).length;

if (asJson) console.log(JSON.stringify({ pass, fail, unresolved, skipped, rows }, null, 2));
else {
  console.log(`\n${pass} correct · ${fail} mislabelled · ${unresolved} unresolved (agency lookup failed) · ${skipped} no geometry`);
  if (unresolved) console.log("An unresolved row is a NETWORK result, not a label result — re-run before reading anything into it.");
}
process.exit(fail > 0 ? 1 : 0);
