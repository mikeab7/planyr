#!/usr/bin/env node
/* sweep-tn-counties.mjs — NEW-1 (all 95 Tennessee counties): parcel CLICK (A), OUTLINES (B) and PARCEL-ID SEARCH (C), county by county, through the
 * app's own routing. The engine is ui-audit/lib/tnCountySweep.mjs; the recorded points are test/fixtures/tnSweepPoints.json (so a re-run asks the same
 * lots and a county that moved shows as a diff). The same file feeds test/tnSweepRouting.test.js, which pins the 95-county list offline.
 *
 *   node ui-audit/sweep-tn-counties.mjs                       # all 95 counties, checks A B C, writes tn-sweep.json
 *   node ui-audit/sweep-tn-counties.mjs --counties=Sullivan,Dyer --checks=A,B
 *   node ui-audit/sweep-tn-counties.mjs --repick              # choose fresh lots and rewrite the points fixture
 *   node ui-audit/sweep-tn-counties.mjs --markdown            # print the docs/STATEWIDE-PARCELS.md table
 *
 * Exit 0 = every county passed every check it ran. 1 = a county failed. 2 = VOID: a control county (Davidson, Rutherford) did not pass, so the
 * instrument is not trusted (a clean number from an instrument that could not see the effect is not evidence — STANDING RULE #2). */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadApp, tennesseeCounties, expectedSource, pickLot, pickDenseLot, interiorCandidates, checkA, checkB, checkC } from "./lib/tnCountySweep.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = resolve(ROOT, "test/fixtures/tnSweepPoints.json");
const args = process.argv.slice(2);
const flag = (n, d = null) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : args.includes(`--${n}`) ? true : d; };
const CHECKS = new Set(String(flag("checks", "A,B,C")).toUpperCase().split(","));
const ONLY = flag("counties") ? new Set(String(flag("counties")).split(",").map((s) => s.trim().toLowerCase())) : null;
const OUT = flag("out", "tn-sweep.json");
const CONC = Number(flag("concurrency", 3));
const CONTROLS = ["Davidson", "Rutherford"];

const app = await loadApp();
const all = tennesseeCounties(app);
if (all.length !== 95) { console.error(`VOID — the bundled polygons hold ${all.length} Tennessee counties, not 95`); process.exit(2); }
const bareName = (n) => n.replace(/\s+County$/i, "");
const recorded = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : { counties: [] };
const recordedBy = new Map(recorded.counties.map((c) => [c.name, c]));

const todo = all.filter((c) => !ONLY || ONLY.has(bareName(c.name).toLowerCase()));
const rows = [];
const log = (s) => console.log(s);

/* Two sites per county: a lot near the middle of the county (what a rural site looks like) and a lot in its DENSEST named place (what a town centre looks like — the record cap and the
 * slow-answer limit only show there). A county passes only if every check passes at both. */
async function runSite(county, route, pt) {
  const site = { point: { lat: +pt.lat.toFixed(6), lng: +pt.lng.toFixed(6) } };
  if (pt.town) { site.town = pt.town; site.lotsInCell = pt.lotsInCell; }
  if (CHECKS.has("A")) site.A = await checkA(app, county, route, pt);
  if (CHECKS.has("B")) site.B = await checkB(app, county, route, pt, site.A);
  if (CHECKS.has("C")) site.C = await checkC(app, county, route, site.A);
  return site;
}
async function one(county) {
  const name = bareName(county.name);
  const route = expectedSource(app, county);
  const row = { county: name, fips: county.fips, source: route.key || "(none)", kind: route.kind };
  try {
    const rec = !flag("repick") && recordedBy.get(name);
    if (route.kind === "none") {
      /* Knox: a point inside the county from the polygons, no lot to pick */
      const c = interiorCandidates(app, county)[0];
      row.sites = [await runSite(county, route, rec && rec.lat ? rec : { lat: c.lat, lng: c.lng })];
      return row;
    }
    let mid = rec && rec.lat ? { lat: rec.lat, lng: rec.lng } : await pickLot(app, county, route);
    if (!mid) { row.pick = "no lot found inside the county"; row.sites = [{ A: { pass: false, reason: "could not pick a test lot: the source returned no lot inside the county polygon" } }]; return row; }
    const dense = rec && rec.dense && rec.dense.lat ? rec.dense : await pickDenseLot(app, county, route);
    row.sites = [await runSite(county, route, mid)];
    if (dense) row.sites.push(await runSite(county, route, dense));
    else row.sites.push({ note: "no named place with lots found — dense site not tested" });
  } catch (e) { row.error = String(e && e.stack || e).split("\n").slice(0, 3).join(" | "); }
  return row;
}

/* a small pool: the Comptroller layer takes up to ~25 s, so the pool paces itself by the slowest */
let next = 0;
async function worker() {
  while (next < todo.length) {
    const c = todo[next++];
    const r = await one(c);
    rows.push(r);
    const v = (k) => { const xs = (r.sites || []).map((x) => x[k]).filter(Boolean); return xs.length ? (xs.every((x) => x.pass) ? "pass" : "FAIL") : "-"; };
    const why = (r.sites || []).flatMap((x, i) => ["A", "B", "C"].filter((k) => x[k] && !x[k].pass).map((k) => `${i ? "town" : "mid"} ${k}: ${x[k].reason}`));
    log(`  ${r.county.padEnd(11)} ${String(r.source).padEnd(14)} A ${v("A").padEnd(4)} B ${v("B").padEnd(4)} C ${v("C").padEnd(4)} ${r.error ? "ERROR " + r.error : why.join(" · ").slice(0, 260)}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
rows.sort((a, b) => a.county.localeCompare(b.county));

const siteOf = (r, i) => (r.sites && r.sites[i]) || {};
if (flag("repick") || !existsSync(FIXTURE)) {
  const fx = {
    recordedOn: new Date().toISOString().slice(0, 10),
    note: "Two real lots per Tennessee county — one near the middle, one in the densest named place — each picked INSIDE the county by the bundled polygons (not near the edge). Scaffolding for ui-audit/sweep-tn-counties.mjs and test/tnSweepRouting.test.js; the verdicts come from the app's routing, not from these points.",
    counties: rows.map((r) => ({
      name: r.county, fips: r.fips, source: r.source, kind: r.kind,
      lat: siteOf(r, 0).point && siteOf(r, 0).point.lat, lng: siteOf(r, 0).point && siteOf(r, 0).point.lng,
      id: siteOf(r, 0).A && siteOf(r, 0).A.id || null, matchAttrs: siteOf(r, 0).A && siteOf(r, 0).A.matchAttrs || null,
      dense: siteOf(r, 1).point ? { lat: siteOf(r, 1).point.lat, lng: siteOf(r, 1).point.lng, town: siteOf(r, 1).town, id: siteOf(r, 1).A && siteOf(r, 1).A.id || null, matchAttrs: siteOf(r, 1).A && siteOf(r, 1).A.matchAttrs || null } : null,
    })),
  };
  if (!ONLY) { writeFileSync(FIXTURE, JSON.stringify(fx, null, 1) + "\n"); log(`points → ${FIXTURE}`); }
}

const strip = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === "feature" || k === "attrKeys" ? undefined : v)));
writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), checks: [...CHECKS], rows: rows.map(strip) }, null, 1));

const checkVerdict = (r, k) => {
  const xs = (r.sites || []).map((x) => x[k]).filter(Boolean);
  if (!xs.length) return "—";
  if (xs.every((x) => x.gap)) return "gap";
  return xs.every((x) => x.pass) ? "pass" : "FAIL";
};
if (flag("markdown")) {
  console.log("| County | Source | A click | B outlines | C id search | Lots tested | Note |\n|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const mid = siteOf(r, 0), town = siteOf(r, 1);
    const lots = [mid.A && mid.A.id ? `${mid.A.id.trim().replace(/\s+/g, " ")}` : null, town.town && town.A && town.A.id ? `${town.town}: ${town.A.id.trim().replace(/\s+/g, " ")}` : null].filter(Boolean).join(" · ");
    const notes = [];
    (r.sites || []).forEach((x, i) => ["A", "B", "C"].forEach((k) => { if (x[k] && !x[k].pass) notes.push(`${i ? "town" : "mid"} ${k}: ${x[k].reason}`); }));
    const blank = [...new Set((r.sites || []).flatMap((x) => (x.A && x.A.blank) || []))];
    if (blank.length) notes.push(`blank: ${blank.join(", ")}`);
    if (r.kind === "none" && mid.A) notes.push(mid.A.note);
    console.log(`| ${r.county} | ${r.source} | ${checkVerdict(r, "A")} | ${checkVerdict(r, "B")} | ${checkVerdict(r, "C")} | ${lots.replace(/\|/g, "/")} | ${notes.join(" · ").replace(/\|/g, "/")} |`);
  }
}

const failed = rows.filter((r) => r.error || r.pick || ["A", "B", "C"].some((k) => CHECKS.has(k) && checkVerdict(r, k) === "FAIL"));
const voidControls = rows.filter((r) => CONTROLS.includes(r.county) && ["A", "B", "C"].some((k) => CHECKS.has(k) && checkVerdict(r, k) === "FAIL"));
const allThree = rows.filter((r) => !failed.includes(r)).length;
log(`\n${allThree} of ${rows.length} counties pass every check run (${[...CHECKS].join("")}); results → ${OUT}`);
if (failed.length) log("not passing: " + failed.map((r) => r.county).join(", "));
if (voidControls.length) { log(`VOID — control county ${voidControls.map((r) => r.county).join(", ")} did not pass; the instrument is not trusted.`); process.exit(2); }
process.exit(failed.length ? 1 : 0);
