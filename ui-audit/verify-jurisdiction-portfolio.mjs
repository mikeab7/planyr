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
 *   ETJ          → the badge LEADS with "City of <X> ETJ" and does NOT also print "Unincorporated"
 *                  (NEW-1: an ETJ is the unincorporated band outside a city's limits, so the pair
 *                  was redundant — and the same separator also carried merely-adjacent cities)
 *   no-ETJ       → the badge reads "Unincorporated"; any nearby city sits behind the em dash
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

/* The verdict for ONE site: does the badge agree with the recorded ground truth?
 *
 * ⛔ RE-STATED BY NEW-1 (B367296). This used to split `jur` on " / " and classify each part by the
 * qualifier glued to it ("· ETJ", "· edge only", "· touches"). That parse WAS the defect it was
 * auditing: one separator carried both "this city governs you" and "this city is next door", so the
 * judge had to reconstruct a distinction the label never made. It now reads the STRUCTURED badge —
 * `shape`, `governingCities`, `etjLabels`, `tail` — exactly as NEW-2 requires of every consumer, and
 * checks the STRING only for the property the owner actually asked for: no city that governs nothing
 * may appear anywhere in the governing chain. */
function judge(site, badge) {
  if (!badge) return { ok: false, problems: ["no badge produced"] };
  const problems = [];
  if (badge.unresolvedRoles && badge.unresolvedRoles.length) {
    return { unresolved: true, problems: [`lookup failed: ${badge.unresolvedRoles.join(", ")}`] };
  }
  const jur = badge.jur || "";
  const gov = badge.governingCities || [];
  const etjs = badge.etjLabels || [];

  /* `truth` is the containment answer at the site's ORIGIN — one point. That is the right check for
   * "did the app claim a city where the ground says none", and it is NOT a whole-site answer: a
   * drawn assemblage can genuinely straddle a city limit its origin sits outside of (Goose Creek and
   * Tsakiris both do). So a SPLIT is always acceptable; only a bare whole-site city claim is a
   * mislabel. */
  if (site.truth.city) {
    if (badge.shape === "unincorporated") problems.push(`in ${site.truth.city} city limits but the badge reads "Unincorporated"`);
    if (!jur.toLowerCase().includes(norm(site.truth.city))) problems.push(`does not name ${site.truth.city}`);
  } else {
    if (gov.length) problems.push(`names "${gov[0]}" as holding the whole site — the land at the origin is in no city`);
    else if (!["unincorporated", "etj", "split"].includes(badge.shape)) problems.push(`UNINCORPORATED but the badge reads "${jur}"`);
    // The ETJ has to be named AS an ETJ — a city that happens to touch the edge is not the ETJ
    // answer, and on 16 of these sites the ETJ is the governing floodplain rule.
    if (site.truth.etj && !etjs.some((e) => norm(e) === norm(site.truth.etj)))
      problems.push(`in the ${site.truth.etj} ETJ but the badge does not name it as an ETJ`);
  }

  /* ⛔ NEW-1, THE ITEM ITSELF, checked on EVERY site rather than only the ones with a known touch.
   * (a) a city that governs nothing may not appear in the governing chain — it belongs behind the
   * em dash; (b) once an ETJ is named, "Unincorporated" is redundant and must not be printed. */
  /* ⚠ An edge city that is ALSO the named ETJ is not a violation — it is the Kennedy Greens shape,
   * and it was the whole point of B276754: Houston clips the parcel edge AND Houston's ETJ governs
   * the land. The name in the chain is the ETJ (which governs), not the sliver (which does not), and
   * the formatter already drops the duplicate tail. Only a city with NO governing role may not
   * appear. Four of the owner's sites are this shape — checking it naively reports all four as
   * mislabels, which is how a judge manufactures its own failure. */
  const adjacentOnly = (badge.edgeOnlyCities || []).filter(
    (c) => !etjs.some((e) => norm(e) === norm(c)) && !gov.some((g) => norm(g) === norm(c)),
  );
  for (const c of adjacentOnly)
    if (jur.toLowerCase().includes(norm(c))) problems.push(`"${c}" merely touches the site but sits in the GOVERNING chain: "${jur}"`);
  if (etjs.length && /Unincorporated/i.test(badge.text || ""))
    problems.push(`names an ETJ and still prints "Unincorporated" — an ETJ is unincorporated land by definition`);
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
  /* ⛔ NEW-2 — THE AREA FRACTION BEHIND THE BADGE, on every row. A portfolio pass that reports only
   * the STRING cannot tell "a third of this site is in the city" from "a lot line clips it", which
   * is the difference this whole item is about — and it is what let Grand Port read as plain
   * unincorporated land through a previous full-portfolio sweep. */
  const areas = badge && badge.cityAreas ? badge.cityAreas : null;
  rows.push({
    site: site.site, truth: site.truth,
    badge: badge ? badge.text : null, shape: badge ? badge.shape : null,
    shareMethod: badge ? badge.cityShareMethod : null,
    siteAcres: areas ? Math.round(areas.totalAcres * 10) / 10 : null,
    shares: areas ? areas.rows.filter((r) => r.share > 0).map((r) => ({
      name: r.name, class: r.class, pct: Math.round(r.share * 1000) / 10, acres: Math.round(r.insideAcres * 10) / 10,
      uniqueIds: r.uniqueIds && r.uniqueIds.length ? r.uniqueIds : undefined,
    })) : null,
    limited: badge ? (badge.cityLimitedAreas || []).map((a) => `${a.name} ${a.class} ${Math.round(a.share * 100)}%`) : null,
    verdict,
  });
  // Pace the sweep. Twenty-eight sites is ~110 queries at three agencies; fired back to back they
  // throttle, and a throttled run reads as a wall of "couldn't check" that says nothing about the
  // labels. Slower and honest beats fast and unreadable.
  await new Promise((res) => setTimeout(res, 400));
  if (!asJson) {
    const mark = verdict.skipped ? "–" : verdict.unresolved ? "?" : verdict.ok ? "✅" : "❌";
    console.log(`${mark} ${site.site.padEnd(19)} ${(badge ? badge.shape : "-").padEnd(15)} ${badge ? badge.text : "(no badge)"}`);
    const last = rows[rows.length - 1];
    if (last.shares && last.shares.length) {
      console.log(`   ↳ by area (${last.siteAcres} ac): ` + last.shares.map((x) => `${x.name} ${x.class} ${x.pct}%`).join(" · "));
    }
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
