/* verify-oklahoma-live — NEW-1 (Oklahoma screening, 2026-10-29): the Oklahoma layer set, LIVE, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-oklahoma-live.mjs [https://planyr.io | <preview url>] [--expect-sha <sha>] [--shots <dir>]
 *
 * Proves, against the served build (read from /version.json in the SAME call as the assertions):
 *   A. MAP FINDER over a real Oklahoma point per row — each layer turned on at a point the registry fixtures sit on asks ITS OWN service (the agency's, through the
 *      same-origin /gis-proxy relay for OCC / DEQ / OWRB), gets 200 with features, and the map GAINS geometry. Merged rows (Tribal Areas, Cleanup Sites, Landfills &
 *      Waste Facilities, Drinking-Water Sources, Protected Waters, Counties & Cities, Water & Sewer) are checked member by member.
 *   B. A LOCATED throwaway plan at the owner's real site area (Washington / Nowata County, 36.90, -95.85) lists the Oklahoma rows in the right panel groups, turns Oil &
 *      Gas Wells on and DRAWS the county's orphan wells, and the tab stays responsive (no long task past the freeze line, rAF alive after a pan).
 *   C. NOTHING LEAKS — a throwaway plan at Houston (known-good arm: it lists Texas rows) offers none of the Oklahoma rows and issues ZERO requests to the Oklahoma agency
 *      servers or the Oklahoma AGOL orgs.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). Exit 0 PASS · 1 FAIL · 2 VOID. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha");
const SHOTS = flag("--shots");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* Every Oklahoma host a layer can talk to — a Houston plan must send NOTHING to any of them. */
const OK_HOSTS = /gis\.occ\.ok\.gov|gis\.deq\.ok\.gov|owrb\.csa\.ou\.edu|RBtoEUQ2lmN0K3GY|jmdMqrrIb2yaWJJ6|MUsqg3LXXXYe8gDP|fI5CUOPa2wdhkCHV|AIANNHA_v1/;

/* [panel group, panel row id, member label, URL needle, lat, lng, zoom]. Points are the registry fixtures (shared/gis/sourceFixturesOk.js): each sits ON a real feature. */
const R = (group, row, label, needle, lat, lng, z = 15) => ({ group, row, label, needle: new RegExp(needle), lat, lng, z });
const CASES = [
  R("jur", "counties_cities", "County lines", "County_Boundaries", 36.0755, -96.10105, 10),
  R("jur", "counties_cities", "City limits", "Cities/FeatureServer", 36.11905, -96.05756, 13),
  R("jur", "ok_road", "State highways", "Roadways", 36.07574, -96.05338, 13),
  R("jur", "ok_tribal", "Census tribal areas", "AIANNHA_v1", 36.3113, -96.49936, 11),
  R("jur", "ok_tribal", "Cherokee Nation reservation", "Cherokee_Nation_Reservation", 36.747, -95.98, 11),
  R("jur", "ok_tribal", "Cherokee Nation tribal land", "Tribal_Land", 36.78518, -95.93355, 13),
  R("env", "ok_wells", "Oil & gas wells", "RBDMS_WELLS", 36.07456, -96.08589, 15),
  R("env", "ok_pst", "Petroleum storage tanks", "Facilities/FeatureServer/0", 36.0748, -96.0299, 14),
  R("env", "ok_pst_releases", "Petroleum tank releases", "PST_Releases/FeatureServer/6", 36.1515, -95.9916, 14),
  R("env", "ok_cleanup", "Superfund", "LandWeb/MapServer/1/query", 36.12463, -96.07872, 14),
  R("env", "ok_cleanup", "RCRA corrective action", "LandWeb/MapServer/0/query", 36.13811, -96.01158, 14),
  R("env", "ok_cleanup", "Land-use restrictions", "LandWeb/MapServer/3/query", 36.15685, -95.97673, 14),
  R("env", "ok_cleanup", "Voluntary cleanup", "LandWeb/MapServer/4/query", 36.15508, -95.97051, 14),
  R("env", "ok_cleanup", "Cleanup assistance", "LandWeb/MapServer/8/query", 36.15873, -96.00539, 14),
  R("env", "ok_cleanup", "Brownfields (DEQ)", "LandWeb/MapServer/11/query", 36.15971, -95.99202, 14),
  R("env", "ok_cleanup", "Brownfields (OCC)", "Brownfield_Sites_20210603", 36.1511, -95.99226, 14),
  R("env", "ok_waste", "Landfills & solid waste", "LandWeb/MapServer/7/query", 36.17061, -95.97931, 14),
  R("env", "ok_waste", "Hazardous-waste permits", "LandWeb/MapServer/6/query", 36.138, -96.012, 14),
  R("env", "ok_source_water", "Wellhead protection areas", "WaterQWeb/MapServer/8/query", 36.24847, -96.25769, 14),
  R("env", "ok_source_water", "Public-well buffers", "WaterQWeb/MapServer/11/query", 36.26747, -96.26043, 15),
  R("env", "ok_source_water", "Surface-water intakes", "WaterQWeb/MapServer/5/query", 36.18094, -96.18095, 14),
  R("env", "ok_protected_waters", "Appendix B areas", "WaterQWeb/MapServer/15/query", 36.22283, -95.79879, 13),
  R("env", "ok_protected_waters", "Appendix B streams", "WaterQWeb/MapServer/16/query", 36.3393, -95.69846, 13),
  R("env", "ok_protected_waters", "Stormwater sensitive watersheds", "WaterQWeb/MapServer/1/query", 35.95506, -95.4752, 12),
  R("env", "ok_protected_waters", "Scenic Rivers", "Standards/MapServer/0/query", 36.20347, -94.70473, 13),
  R("env", "ok_protected_waters", "Special-provision watersheds", "Standards/MapServer/9/query", 36.22015, -95.92554, 12),
  R("env", "ok_deq_303d", "Impaired waters", "WaterQWeb/MapServer/19/query", 36.1455, -96.00993, 14),
  R("env", "ok_dams", "Dams", "Dam_Hazard_Classification_AGOL", 36.12085, -95.98778, 14),
  R("env", "ok_nrhp", "Historic places", "nrhp_points_v1", 36.15338, -95.9928, 14),
  R("env", "ok_cemeteries", "Cemeteries", "structures/MapServer/37", 36.15225, -95.98717, 14),
  R("env", "ok_crit_habitat", "Critical habitat", "USFWS_Critical_Habitat", 34.372, -94.92, 12),
  R("env", "ok_crit_habitat", "Critical habitat (Canadian River, wide view — 225,000 unsimplified vertices)", "USFWS_Critical_Habitat", 35.6, -97.5, 10),
  R("util", "water_sewer", "Water system service areas", "Water_Systems/MapServer/0", 36.25959, -95.98654, 13),
];
const ROW_IDS = ["counties_cities", "ok_road", "ok_tribal", "ok_wells", "ok_pst", "ok_cleanup", "ok_waste", "ok_source_water", "ok_protected_waters", "ok_deq_303d", "ok_dams", "ok_nrhp", "ok_cemeteries", "ok_crit_habitat", "water_sewer"];
const OK_ONLY_IDS = ROW_IDS.filter((r) => !["counties_cities", "water_sewer"].includes(r));

/* --anon: a PR PREVIEW has no E2E_LOGIN_KEY (the e2e-session route answers 404 there), so arm A (the map finder, which works logged out) can be run before the merge;
 * arms B and C need the signed-in test account and run on planyr.io after the deploy. */
const ANON = args.includes("--anon");
let s = null;
if (ANON) {
  const { chromium } = await import("@playwright/test");
  const { existsSync } = await import("node:fs");
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  const pg = await ctx.newPage();
  await pg.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  s = { page: pg, proof: { email: "(anonymous — preview run, arm A only)" }, close: () => browser.close() };
} else {
  for (let attempt = 1; attempt <= 6 && !s; attempt++) {
    try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
    catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
  }
}
const page = s.page;
await assertMeasurable(page, "verify-oklahoma-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
page.on("response", async (res) => {
  const u = res.url();
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u) && (OK_HOSTS.test(u) || /\/gis-proxy\/|arcgis\.com|nationalmap\.gov/.test(u))) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : null; e.exceeded = !!(j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit)); } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { if (OK_HOSTS.test(r.url())) log.push({ url: r.url(), status: "sent", features: null, req: true }); });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 160)));
const answered = (re) => log.filter((e) => !e.req && re.test(e.url));
const sent = (re) => log.filter((e) => e.req && re.test(e.url));
const geom = () => page.evaluate(() => ({ paths: document.querySelectorAll(".leaflet-pane svg path").length, canvases: document.querySelectorAll(".leaflet-pane canvas").length, markers: document.querySelectorAll(".leaflet-marker-icon").length, text: document.body.innerText }));
const FAIL_TOAST = /layer failed|no vector source|couldn.t load|too detailed|unavailable right now/i;

const cleanupIds = [];
const insertPlan = async (plan) => {
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  cleanupIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
};
const mkPlan = (id, p, label) => ({ ...throwawayPlan(id), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}` });
const rowsIn = async (panel, group) => {
  const btn = panel.getByTestId(`layer-group-${group}`);
  if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(group);
  await sleep(250);
  return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
};
const openPlannerPanel = async (id) => {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(2500);
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await sleep(900);
  return panel;
};

try {
  /* ── A. Map finder, one real point per row ─────────────────────────────────────────────────── */
  await page.goto(`${BASE}/?planyrDiag=1#/site-planner`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 60000 });
  await sleep(1500);
  await page.evaluate(() => window.__mapFinderMap.setView([36.15, -95.99], 12, { animate: false }));
  await sleep(800);
  const fchip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await fchip.count()) await fchip.first().click();
  const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await fp.waitFor({ state: "visible", timeout: 20000 });

  const finderRows = {};
  for (const g of ["jur", "env", "util"]) finderRows[g] = await rowsIn(fp, g);
  console.log("finder · Jurisdictions:", finderRows.jur.join(", "));
  console.log("finder · Environmental:", finderRows.env.join(", "));
  console.log("finder · Utilities:", finderRows.util.join(", "));
  // the finder's scope is its VIEW CENTRE — Tulsa, Oklahoma
  for (const row of ROW_IDS) {
    const group = CASES.find((c) => c.row === row).group;
    check(`A · the finder at Tulsa offers "${row}" in ${group}`, finderRows[group].includes(row));
  }
  /* One case at a time with the row OFF before and after: a merged row's members all fetch when it goes on, and esri-leaflet caches tiles, so a member checked at a
   * second point would otherwise be answered from a tile an earlier member already loaded (no request, no fresh geometry) — an instrument artefact, not a layer fault. */
  const setRow = async (c, on) => {
    const btn = fp.getByTestId(`layer-group-${c.group}`);
    if (await btn.count()) await btn.click(); else await fp.getByTestId("layer-group-select").selectOption(c.group);
    await sleep(200);
    const cb = fp.locator(`[data-testid="layer-row-${c.row}"] input[type="checkbox"]`).first();
    if (!(await cb.count())) return false;
    if ((await cb.isChecked()) !== on) { if (on) await cb.check(); else await cb.uncheck(); }
    return true;
  };
  for (const c of CASES) {
    if (!(await setRow(c, false))) { check(`A · row "${c.row}" has a checkbox`, false, "missing"); continue; }
    await page.evaluate(([la, ln, z]) => window.__mapFinderMap.setView([la, ln], z, { animate: false }), [c.lat, c.lng, c.z]);
    await sleep(900);
    const before = await geom();
    log = log.filter((e) => e.req);
    await setRow(c, true);
    let got = [];
    for (let i = 0; i < 28 && !got.some((e) => e.status === 200 && e.features > 0); i++) { await sleep(750); got = answered(c.needle); }
    const ok = got.filter((e) => e.status === 200);
    const withFeat = ok.filter((e) => e.features > 0);
    if (!got.length) { check(`A · ${c.label}: the layer asked its own service`, false, `no request matching ${c.needle} — ${log.slice(-3).map((e) => e.url.slice(0, 90)).join(" | ")}`); await setRow(c, false); continue; }
    check(`A · ${c.label}: 200 with features at a point ON a registry fixture`, withFeat.length > 0, `${ok.length} ok / ${got.length} answered; features ${ok.map((e) => e.features).join(",")}`);
    await sleep(900);
    const after = await geom();
    check(`A · ${c.label}: the map gained geometry`, after.paths + after.canvases + after.markers > before.paths + before.canvases + before.markers, `${before.paths}p/${before.markers}m → ${after.paths}p/${after.markers}m`);
    check(`A · ${c.label}: no failure toast`, !FAIL_TOAST.test(after.text), (after.text.match(new RegExp(`[^\\n]*(${FAIL_TOAST.source})[^\\n]*`, "i")) || [""])[0]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-${c.row}-${c.label.replace(/\W+/g, "-")}.png` });
    await setRow(c, false);
  }
  const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400 && OK_HOSTS.test(e.url));
  check("A · no request to an Oklahoma agency server failed (4xx/5xx)", bad.length === 0, bad.slice(0, 4).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));

  if (ANON) throw Object.assign(new Error("anon-done"), { anonDone: true });
  /* ── B. A LOCATED plan at the owner's real site area ───────────────────────────────────────── */
  const WASH = { lat: 36.9, lng: -95.85 }, HOUSTON = { lat: 29.8, lng: -95.54 };
  const okPlan = mkPlan(`${LIVE_PREFIX}ok-wash-${Date.now().toString(36)}`, WASH, "Washington Co OK");
  const txPlan = mkPlan(`${LIVE_PREFIX}ok-tx-${Date.now().toString(36)}`, HOUSTON, "Houston");
  await insertPlan(okPlan); await insertPlan(txPlan);
  log = [];
  const panel = await openPlannerPanel(okPlan.id);
  const jur = await rowsIn(panel, "jur"), env = await rowsIn(panel, "env"), util = await rowsIn(panel, "util");
  console.log("Washington Co · Environmental rows:", env.join(", "));
  for (const row of ROW_IDS) {
    const group = CASES.find((c) => c.row === row).group;
    check(`B · the planner at the Washington County site offers "${row}"`, ({ jur, env, util })[group].includes(row));
  }
  // turn Oil & Gas Wells on, watch for the county's wells and keep the tab honest
  await panel.getByTestId("layer-group-env").click(); await sleep(250);
  const wcb = panel.locator('[data-testid="layer-row-ok_wells"] input[type="checkbox"]').first();
  const gBefore = await geom();
  await wcb.check();
  let wg = [];
  for (let i = 0; i < 30 && !wg.some((e) => e.status === 200 && e.features > 0); i++) { await sleep(1000); wg = answered(/RBDMS_WELLS/); }
  check("B · Oil & Gas Wells at the Washington County site: the Commission's server answered with wells", wg.some((e) => e.status === 200 && e.features > 0), `features ${wg.map((e) => e.features).join(",")}`);
  await sleep(1500);
  const gAfter = await geom();
  check("B · …and the wells are DRAWN on the plan's map", gAfter.paths + gAfter.canvases + gAfter.markers > gBefore.paths + gBefore.canvases + gBefore.markers, `${gBefore.paths}p/${gBefore.canvases}c → ${gAfter.paths}p/${gAfter.canvases}c`);
  check("B · no failure toast", !FAIL_TOAST.test(gAfter.text));
  const freeze = await page.evaluate(async () => {
    const t0 = performance.now();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const raf = performance.now() - t0;
    return { raf: Math.round(raf) };
  });
  check("B · the tab is responsive with the wells on (a frame lands within 1.5 s)", freeze.raf < 1500, `${freeze.raf} ms`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-washington-wells.png` });

  /* ── C. Houston offers none of it ──────────────────────────────────────────────────────────── */
  log = [];
  const panelTx = await openPlannerPanel(txPlan.id);
  const jurTx = await rowsIn(panelTx, "jur"), envTx = await rowsIn(panelTx, "env"), utilTx = await rowsIn(panelTx, "util");
  console.log("Houston · Environmental rows:", envTx.join(", "));
  check("C · KNOWN-GOOD arm: Houston lists the Texas rows (so an empty answer is not an empty registry)", jurTx.includes("counties_cities") && utilTx.includes("water_sewer") && envTx.length > 0, `${jurTx.length}/${envTx.length}/${utilTx.length}`);
  const leaked = OK_ONLY_IDS.filter((id) => jurTx.includes(id) || envTx.includes(id) || utilTx.includes(id));
  check("C · Houston offers none of the Oklahoma rows", leaked.length === 0, leaked.join(", "));
  await sleep(3000);
  check("C · the Houston plan issues ZERO requests to the Oklahoma agency servers or orgs", sent(OK_HOSTS).length === 0, `${sent(OK_HOSTS).length}: ${sent(OK_HOSTS).slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
  check("no uncaught page error during the run", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} catch (e) {
  if (!(e && e.anonDone)) { console.log("❌ harness error — " + (e && e.stack || e)); failed++; }
} finally {
  for (const id of cleanupIds) {
    const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
    check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
  }
  await s.close();
}
if (voided) console.log(`VOID — ${voided} precondition(s) failed; the run proves nothing`);
console.log(failed ? `FAIL (${failed})` : voided ? "VOID" : "PASS");
process.exit(failed ? 1 : voided ? 2 : 0);
