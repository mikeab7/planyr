/* NEW-1 — LIVE: every state-plane zone fix, driven through the DEPLOYED runtime, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-state-plane-zones-live.mjs [https://planyr.io] [expectedBuildSha]
 *
 * WHY THIS EXISTS (owner standard 2026-10-29): `verify-state-plane-live.mjs` only proves the zone TABLE STRING is somewhere in the
 * served chunk graph. That is "the deployed code contains the right table", not "the app resolves the right zone". This harness imports
 * the SERVED modules (the same URLs, hence the same module instances, the app itself holds), runs the app's real
 * county-polygon load (`loadCountyPolygons` → installs the point→county locator), and then for every case on the brief asks the live
 * code the question three ways, the shapes real callers use:
 *   A. a BARE map point            — `zoneForPoint(lat, lon)`          (Map/Comps overlay anchors carry no state or county)
 *   B. a SITE (state + county)     — `zoneForCounty(state, county, {lat, lon})` with the county as the polygon asset names it AND as
 *                                    the plan persists it (routing key `ga_lanier`, `co_denver`, TX bare slug) AND with no county
 *   C. the DEED path               — `gridConvergenceDeg(lat, lon, { state, county })`, whose body runs the full `resolveZone`
 *                                    (`resolveZone` itself is tree-shaken out of the production bundle: only this path reaches it).
 *                                    It must equal the convergence computed in the EXPECTED zone, and — where a wrong zone is the
 *                                    interesting alternative — must DIFFER from the convergence in that wrong zone.
 * Controls (the CLAUDE.md "positive control" rule): known-answer arms (Katy/Houston stay South Central, Denver/Boulder unchanged) and a
 * self-test that the comparison REJECTS a deliberately wrong expectation. Texas South Central is also pinned bit-for-bit to numbers
 * produced by the PRE-#2583 code (index.js `projectToGrid`, deedAlign `gridConvergenceDeg`, computed at 56bb1d56^ — see GOLDEN).
 *
 * The build id (/version.json) is read in the SAME page call as every assertion (AGENT-RULES: a verdict is only valid for the build it
 * was read from). Emits one JSON line `RESULT {...}` for the ledger.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { readFileSync } from "node:fs";
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const wantSha = process.argv[3] || null;

/* id = zone id in SP_ZONES; epsg is cross-checked against the live zone object. */
const CASES = [
  { n: "Katy TX",                 lat: 29.7858, lon: -95.8245,  exp: "tx_sc",            epsg: 2278 },
  { n: "Downtown Houston TX",     lat: 29.7604, lon: -95.3698,  exp: "tx_sc",            epsg: 2278 },
  { n: "Conroe TX (Montgomery)",  lat: 30.3119, lon: -95.4561,  exp: "tx_central",       epsg: 2277, wrong: "tx_sc" },
  { n: "Liberty TX",              lat: 30.0580, lon: -94.7955,  exp: "tx_central",       epsg: 2277, wrong: "tx_sc" },
  { n: "Dallas TX",               lat: 32.7767, lon: -96.7970,  exp: "tx_north_central", epsg: 2276 },
  { n: "Austin TX (Travis)",      lat: 30.2672, lon: -97.7431,  exp: "tx_central",       epsg: 2277 },
  { n: "Nashville TN",            lat: 36.1627, lon: -86.7816,  exp: "tn",               epsg: 2274 },
  { n: "Lakeland GA (Lanier)",    lat: 31.0410, lon: -83.0751,  exp: "ga_west",          epsg: 2240, wrong: "ga_east" },
  { n: "Valdosta GA (Lowndes)",   lat: 30.8327, lon: -83.2785,  exp: "ga_west",          epsg: 2240 },
  { n: "Waycross GA (Ware)",      lat: 31.2135, lon: -82.3540,  exp: "ga_east",          epsg: 2239 },
  { n: "Little Rock AR (Pulaski)",lat: 34.7465, lon: -92.2896,  exp: "ar_north",         epsg: 3433, wrong: "ar_south" },
  { n: "Benton AR (Saline)",      lat: 34.5645, lon: -92.5868,  exp: "ar_south",         epsg: 3434 },
  { n: "Avalon, Catalina CA",     lat: 33.3428, lon: -118.3278, exp: "ca_6",             epsg: 2230, wrong: "ca_5" },
  { n: "Long Beach CA",           lat: 33.7701, lon: -118.1937, exp: "ca_5",             epsg: 2229 },
  { n: "Belfield ND (brief point)",lat: 46.8853, lon: -103.1996, exp: "nd_south",         epsg: 2266, decided: false },   // the brief's point is Stark County, not Billings — measured live
  { n: "Medora ND (Billings Co)", lat: 46.9142, lon: -103.5252, exp: "nd_south",         epsg: 2266, decided: true, county: "Billings" },
  { n: "Carson City NV",          lat: 39.1638, lon: -119.7674, exp: "nv_west",          epsg: 3423, decided: false },
  { n: "Juneau AK",               lat: 58.3019, lon: -134.4197, exp: "ak_1",             epsg: 26931 },
  { n: "Boulder CO",              lat: 40.0150, lon: -105.2705, exp: "co_north",         epsg: 2231 },
  { n: "Denver CO",               lat: 39.7392, lon: -104.9903, exp: "co_central",       epsg: 2232 },
];

/* Texas South Central BEFORE #2583 — produced by the pre-change code (git 56bb1d56^): deedAlign.gridConvergenceDeg(lat, lon, {state:"TX",
 * county}) and index.js projectToGrid(lat, lon). Convergence tolerance 1e-9 deg (the generalised engine differs at the 1e-11 level in the
 * last digits); projection must be exactly equal. */
const GOLDEN = [
  { n: "Katy",     lat: 29.7858, lon: -95.8245, county: "harris", conv: 1.5479061438390647, x: 2975642.996252015, y: 13846936.790958049 },
  { n: "Houston",  lat: 29.7604, lon: -95.3698, county: "harris", conv: 1.7695476748160095, x: 3120099.087755959, y: 13841900.85847395 },
  { n: "Fort Bend",lat: 29.58,   lon: -95.76,   county: "fortbend", conv: 1.5793140688086227, x: 2998167.6103382884, y: 13772691.944873828 },
];

const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const log = (...a) => console.log(...a);

async function open() {
  let last;
  for (let i = 0; i < 5; i++) {
    try { return await openSignedIn({ base }); } catch (e) { last = e; console.error(`openSignedIn attempt ${i + 1} failed: ${e.message.split("\n")[0]}`); await new Promise((r) => setTimeout(r, 8000)); }
  }
  throw last;
}

const s = await open();
try {
  await assertMeasurable(s.page, "verify-state-plane-zones-live");
  const errors = [];
  s.page.on("pageerror", (e) => errors.push(String(e.message || e)));

  // PHASE A — natural boot: does the app itself install the county locator on the routes that need it? (information, not a gate)
  const natural = {};
  for (const route of ["#/site", "#/map"]) {
    await s.page.goto(`${base}/${route}`, { waitUntil: "load" }).catch(() => {});
    await s.page.waitForTimeout(6000);
    natural[route] = await s.page.evaluate(async () => {
      const m = await (await fetch("/.vite/manifest.json", { cache: "no-store" })).json();
      const f = (re) => "/" + Object.entries(m).find(([k]) => re.test(k))[1].file;
      const core = await import(f(/statePlaneCore-/)), poly = await import(f(/countyPolygons\.js$/));
      const z = core.z(30.3119, -95.4561); // Conroe, bare
      return { polygonsReady: poly.countyPolygonsReady(), conroe: z ? `${z.id}/${z.via}${z.coarse ? "*coarse" : ""}` : null };
    }).catch((e) => ({ error: String(e.message).slice(0, 120) }));
    log(`natural boot ${route}:`, JSON.stringify(natural[route]));
  }

  // PHASE B — the drive. Fresh navigation so module state starts as a real user's would.
  await s.page.goto(`${base}/?zl=${Date.now()}#/site`, { waitUntil: "load" }).catch(() => {});
  await s.page.waitForTimeout(4000);
  const REF_SRC = readFileSync(new URL("../src/shared/coordinates/index.js", import.meta.url), "utf8")
    .replace(/^import .*SQFT_PER_ACRE.*$/m, "const SQFT_PER_ACRE = 43560;").replace(/^export \{ SQFT_PER_ACRE \};?$/m, "");
  const CASES_IN = CASES.map((c) => ({ ...c, appState: siteState({ lat: c.lat, lng: c.lon }) }));
  const out = await s.page.evaluate(async ({ CASES, GOLDEN, REF_SRC }) => {
    const build = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json());
    const m = await (await fetch("/.vite/manifest.json", { cache: "no-store" })).json();
    const f = (re) => "/" + Object.entries(m).find(([k]) => re.test(k))[1].file;
    const core = await import(f(/statePlaneCore-/)), sp = await import(f(/statePlane-/)), poly = await import(f(/countyPolygons\.js$/));
    // Minified export names → roles, proven by behaviour (a positive control on the mapping itself):
    const zoneForPoint = core.z, zoneForCounty = sp.z, gridConv = sp.g, projectToZone = core.p, ZONES = core.e;
    const mapping = {
      zoneForPoint: zoneForPoint(29.7858, -95.8245)?.id === "tx_sc" || zoneForPoint(29.7858, -95.8245)?.id === "tx_sc",
      zoneForCounty: zoneForCounty("TX", "harris", { lat: 29.78 })?.id === "tx_sc",
      gridConv: typeof gridConv(29.7858, -95.8245) === "number",
      projectToZone: Math.abs(projectToZone(ZONES.tx_sc, 29.7858, -95.8245).x - 2975642.99) < 1,
      zones: Object.keys(ZONES).length,
    };
    const before = { conroe: (() => { const z = zoneForPoint(30.3119, -95.4561); return z ? `${z.id}/${z.via}` : null; })() };
    await poly.loadCountyPolygons();
    const after = (() => { const z = zoneForPoint(30.3119, -95.4561); return z ? `${z.id}/${z.via}` : null; })();
    const slug = (c) => String(c || "").normalize("NFKD").toLowerCase().replace(/\b(city|and|county|parish|borough|census area|municipality|of)\b/g, "").replace(/[^a-z]/g, "");
    const rows = [];
    for (const c of CASES) {
      const cp = poly.resolveCounty(c.lat, c.lon);
      const appState = c.appState;   // what SitePlanner passes as siteStateId: siteRegion.siteState(), evaluated Node-side from the repo source (siteRegion is bundled into the planner chunk, so it cannot be imported alone from the served build)
      const st = appState || (cp.status === "ok" ? cp.state : null);
      const key = cp.status === "ok" && cp.state === st ? (st === "TX" ? slug(cp.name) : `${st.toLowerCase()}_${slug(cp.name)}`) : null;
      const sum = (z) => z ? { id: z.id, epsg: z.epsg, via: z.via, decided: !!z.decided, coarse: !!z.coarse, note: z.decisionNote || null } : null;
      const bare = sum(zoneForPoint(c.lat, c.lon));
      const bareInState = st ? sum(zoneForPoint(c.lat, c.lon, st)) : null;
      const byName = st && cp.status === "ok" ? sum(zoneForCounty(st, cp.name, { lat: c.lat, lon: c.lon })) : null;
      const byKey = st ? sum(zoneForCounty(st, key, { lat: c.lat, lon: c.lon })) : null;
      const convExp = gridConv(c.lat, c.lon, { zone: ZONES[c.exp] });
      const convSiteKey = st ? gridConv(c.lat, c.lon, { state: st, county: key }) : null;
      const convSiteName = st ? gridConv(c.lat, c.lon, { state: st, county: cp.name }) : null;
      const convSiteNoCounty = st ? gridConv(c.lat, c.lon, { state: st, county: null }) : null;
      const convBare = gridConv(c.lat, c.lon);
      const convWrong = c.wrong ? gridConv(c.lat, c.lon, { zone: ZONES[c.wrong] }) : null;
      rows.push({ c, appState, county: cp.status === "ok" ? { name: cp.name, state: cp.state, nearEdge: !!cp.nearEdge } : { status: cp.status }, key, bare, bareInState, byName, byKey, convExp, convSiteKey, convSiteName, convSiteNoCounty, convBare, convWrong, expEpsg: ZONES[c.exp]?.epsg });
    }
    const refSrc = REF_SRC;
    const ref = await import(URL.createObjectURL(new Blob([refSrc], { type: "text/javascript" })));
    const gold = GOLDEN.map((g) => {
      const p = projectToZone(ZONES.tx_sc, g.lat, g.lon), q = ref.projectToGrid(g.lat, g.lon);
      return { n: g.n, projX: p.x, projY: p.y, refX: q.x, refY: q.y, projExactSameEngine: Object.is(p.x, q.x) && Object.is(p.y, q.y), dX: p.x - g.x, dY: p.y - g.y, projExact: Object.is(p.x, g.x) && Object.is(p.y, g.y), convSite: gridConv(g.lat, g.lon, { state: "TX", county: g.county }), convBare: gridConv(g.lat, g.lon), convGold: g.conv };
    });
    const scripts = performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /statePlane/.test(n)).map((n) => n.split("/").pop());
    return { build, mapping, before, after, rows, gold, scripts };
  }, { CASES: CASES_IN, GOLDEN, REF_SRC });

  // ---- judge (Node side) ----
  log("build:", JSON.stringify(out.build), "| signed in as", s.proof.email, "| fixture visible:", s.proof.fixtureVisible);
  log("served statePlane chunks:", out.scripts.join(", ") || "(from manifest)");
  if (wantSha && !String(out.build.build || "").startsWith(wantSha.slice(0, 7))) fail(`served build ${JSON.stringify(out.build)} is not ${wantSha}`);
  if (!Object.values(out.mapping).every((v) => v === true || typeof v === "number") || out.mapping.zones < 120) fail("export-role mapping not proven: " + JSON.stringify(out.mapping) + " — VOID, the instrument did not find the functions");
  log("pre-load Conroe bare point:", out.before.conroe, " → after loadCountyPolygons():", out.after);
  if (out.after !== "tx_central/county-point") fail(`after the real county load, Conroe bare point resolves ${out.after}, expected tx_central/county-point`);

  const TOL = 1e-9;
  const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < TOL;
  // the comparison itself must be able to FAIL: Conroe judged against South Central has to be rejected
  const conroe = out.rows.find((r) => r.c.exp === "tx_central" && /Conroe/.test(r.c.n));
  const selfTestRejects = !near(conroe.convExp, conroe.convWrong) && conroe.bare.id !== "tx_sc";
  if (!selfTestRejects) fail("self-test: the checker would accept Conroe as South Central — instrument is vacuous (VOID)");
  log("self-test: checker rejects a deliberately wrong expectation (Conroe vs tx_sc): conv Central", conroe.convExp.toFixed(6), "vs South Central", conroe.convWrong.toFixed(6));

  let bad = 0; const report = [];
  for (const r of out.rows) {
    const c = r.c, why = [];
    const idOf = (z) => (z ? z.id : null);
    if (r.expEpsg !== c.epsg) why.push(`epsg table ${r.expEpsg} != brief ${c.epsg}`);
    if (c.exp.startsWith("ak_")) {
      // Alaska is positional: the county table has no answer; the zone comes from the meridian band (resolveZone, state AK) or, with no
      // state, from the coarse point envelope. Both are asked.
      if (r.appState !== "AK") why.push(`the app's siteState() says ${r.appState}, not AK`);
      if (!near(r.convSiteNoCounty, r.convExp)) why.push(`AK site path (state AK, no county) convergence ${r.convSiteNoCounty} != expected-zone ${r.convExp}`);
      if (idOf(r.bare) !== c.exp) why.push(`bare point zone ${idOf(r.bare)} != ${c.exp}`);
    } else {
      if (r.appState !== r.county.state) why.push(`the app's siteState() ${r.appState} disagrees with the county polygon state ${r.county.state}`);
      if (c.county && !String(r.county.name || "").toLowerCase().startsWith(c.county.toLowerCase())) why.push(`point is in ${r.county.name}, not ${c.county} — the case does not exercise the county it names`);
      if (idOf(r.bare) !== c.exp) why.push(`bare point zone ${idOf(r.bare)} (${r.bare && r.bare.via}) != ${c.exp}`);
      if (idOf(r.bareInState) !== c.exp) why.push(`bare point in state ${idOf(r.bareInState)} != ${c.exp}`);
      if (idOf(r.byName) !== c.exp) why.push(`site county-by-name zone ${idOf(r.byName)} != ${c.exp}`);
      if (idOf(r.byKey) !== c.exp) why.push(`site routing-key zone ${idOf(r.byKey)} != ${c.exp}`);
      if (!near(r.convSiteKey, r.convExp)) why.push(`deed path (key) convergence ${r.convSiteKey} != expected-zone ${r.convExp}`);
      if (!near(r.convSiteName, r.convExp)) why.push(`deed path (name) convergence ${r.convSiteName} != expected-zone ${r.convExp}`);
      if (!near(r.convSiteNoCounty, r.convExp)) why.push(`deed path (no county) convergence ${r.convSiteNoCounty} != expected-zone ${r.convExp}`);
    }
    if (!near(r.convBare, r.convExp)) why.push(`deed path (bare point) convergence ${r.convBare} != expected-zone ${r.convExp}`);
    if (c.wrong && near(r.convExp, r.convWrong)) why.push(`vacuous: wrong zone ${c.wrong} gives the same convergence`);
    if (typeof c.decided === "boolean") {
      const flags = [r.byName, r.byKey].filter(Boolean).map((z) => z.decided);
      if (!flags.length || flags.some((d) => d !== c.decided)) why.push(`decided flag ${JSON.stringify(flags)} != ${c.decided}`);
    } else {
      const d = [r.byName, r.byKey].filter(Boolean).some((z) => z.decided);
      if (d) why.push("flagged decided but should be statute-backed");
    }
    const ok = why.length === 0; if (!ok) bad++;
    report.push({ case: c.n, county: r.county.name ? `${r.county.name}, ${r.county.state}${r.county.nearEdge ? " (near edge)" : ""}` : r.county.status, expected: `${c.exp} (EPSG:${c.epsg})`, bare: r.bare && `${r.bare.id}/${r.bare.via}${r.bare.coarse ? "*coarse" : ""}`, site: r.byKey ? `${r.byKey.id}/${r.byKey.via}${r.byKey.decided ? "/decided" : ""}` : "(AK: by position)", conv: r.convSiteNoCounty != null ? +r.convSiteNoCounty.toFixed(6) : null, result: ok ? "PASS" : "FAIL", why });
  }
  for (const g of out.gold) {
    const why = [];
    if (!g.projExactSameEngine) why.push(`live tx_sc projection (${g.projX}, ${g.projY}) is not bit-identical to the repo's hard-coded EPSG:2278 projectToGrid run in the SAME browser (${g.refX}, ${g.refY})`);
    if (Math.abs(g.dX) > 1e-6 || Math.abs(g.dY) > 1e-6) why.push(`projection moved ${g.dX.toExponential(2)} / ${g.dY.toExponential(2)} ft vs the pre-#2583 numbers computed in Node`);
    if (!near(g.convSite, g.convGold)) why.push(`site convergence ${g.convSite} != pre-#2583 ${g.convGold}`);
    if (!near(g.convBare, g.convGold)) why.push(`bare convergence ${g.convBare} != pre-#2583 ${g.convGold}`);
    if (why.length) bad++;
    report.push({ case: `UNCHANGED vs pre-#2583: ${g.n}`, expected: "same-engine bit-identical projection (Node-vs-Chromium last-digit drift reported: " + g.dX.toExponential(1) + " / " + g.dY.toExponential(1) + " ft), convergence within 1e-9°", result: why.length ? "FAIL" : "PASS", why });
  }
  if (errors.length) { bad++; report.push({ case: "page errors", result: "FAIL", why: errors.slice(0, 3) }); }

  for (const r of report) log(`${r.result}  ${r.case}${r.county ? "  [" + r.county + "]" : ""}${r.expected ? "  expect " + r.expected : ""}${r.bare ? "  bare=" + r.bare : ""}${r.site ? "  site=" + r.site : ""}${r.conv != null ? "  γ=" + r.conv + "°" : ""}${r.why && r.why.length ? "\n      ↳ " + r.why.join("\n      ↳ ") : ""}`);
  console.log("RESULT " + JSON.stringify({ build: out.build.build, signedInAs: s.proof.email, natural, total: report.length, passed: report.length - bad, failed: bad, cases: report.map((r) => ({ case: r.case, result: r.result })) }));
  await s.close();
  process.exit(bad ? 1 : 0);
} catch (e) { await s.close().catch(() => {}); fail(e.message); }
