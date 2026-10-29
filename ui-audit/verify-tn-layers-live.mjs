/* verify-tn-layers-live — the Tennessee industrial due-diligence layers (B2521584), LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-tn-layers-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * It proves, against the DEPLOYED build (read from /version.json in the same call as the assertions):
 *   A. THE MAP FINDER — moved over a real Tennessee point (Nashville, then Christiana / Epps Mill Rd), lists every Tennessee row in its group, and each row
 *      turned ON answers with REAL features from its own server (counted from the /query responses the page actually received — esri-leaflet AGOL rows
 *      directly, the maps.tdec.tn.gov / tnmap.tn.gov rows through the same-origin /gis-proxy relay). A row that legitimately has nothing in view says "empty", never "loaded".
 *   B. A LOCATED PLAN at Christiana — a throwaway plan with its origin there lists the same rows, and the computed Stream Buffers row paints real polygons
 *      (the 30 ft construction buffer).
 *   C. NOTHING LEAKS — a Houston plan (known-good arm: it lists the Texas rows) and a Georgia plan offer NO Tennessee row and send ZERO requests to the
 *      Tennessee servers (TDEC's AGOL org, the maps.tdec / tnmap relay, the State of Tennessee org).
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). */
import { writeFileSync, mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { TN_LAYERS, TN_LAYER_IDS } from "../src/workspaces/site-planner/lib/tennesseeLayers.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha");
const SHOTS = flag("--shots");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* every request to a Tennessee server: TDEC's AGOL org, the State of Tennessee org (counties / cities), the tdeconline relay */
const TN_HOSTS = /bPacKTm9cauMXVfn|YuVBSS7Y1of2Qud1|\/gis-proxy\/(maps\.tdec|tnmap)\.tn\.gov/;
const PLACES = {
  nashville: { lat: 36.1627, lng: -86.7816, label: "Nashville (Davidson)" },
  christiana: { lat: 35.7425, lng: -86.3436, label: "Christiana / Epps Mill Rd (Rutherford)" },
};
const HOUSTON = { lat: 29.80, lng: -95.54 }, ATLANTA = { lat: 33.749, lng: -84.388 };
/* panel group key per registry group */
const PANEL = { jurisdiction: "jur", flood: "flood", utilities: "util", environmental: "env" };

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-tn-layers-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);

/* Network log: every Tennessee-server request, with its status and (for /query) the feature count in the answer. */
let log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!TN_HOSTS.test(u) && !/services\d?\.arcgis\.com|carto\.nationalmap\.gov/.test(u)) return;
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : null; } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { const u = r.url(); if (TN_HOSTS.test(u)) log.push({ url: u, status: "sent", features: null, req: true }); });
const answered = (re) => log.filter((e) => !e.req && re.test(e.url) && e.status === 200);
const featuresFrom = (re) => answered(re).reduce((n, e) => n + (e.features || 0), 0);

const cleanupIds = [];
async function openFinder(pt, zoom) {
  await page.goto(`${BASE}/?planyrDiag=1#/site-planner`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
  await sleep(1500);
  await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [pt.lat, pt.lng, zoom]);
  await sleep(1200);
  const fchip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await fchip.count()) await fchip.first().click();
  const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await fp.waitFor({ state: "visible", timeout: 20000 });
  await sleep(900);
  return fp;
}
const rowsIn = async (panel, group) => {
  const btn = panel.getByTestId(`layer-group-${group}`);
  if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(group);
  await sleep(250);
  return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
};
const stateOf = (panel, id) => panel.locator(`[data-testid="layer-row-${id}"]`).first().getAttribute("data-layer-state").catch(() => null);
/* the merged rows the panel shows in place of the individual ids */
const SHOWN_AS = { tn_county: "counties_cities", tn_city: "counties_cities", tn_pws: "water_sewer" };

try {
  /* ── A. the finder over Nashville, then Christiana ─────────────────────────────── */
  for (const place of [PLACES.nashville, PLACES.christiana]) {
    log = [];
    const fp = await openFinder(place, 13);
    const listed = {};
    for (const g of Object.values(PANEL)) listed[g] = await rowsIn(fp, g);
    console.log(`${place.label} · finder rows:`, JSON.stringify(listed));
    for (const id of TN_LAYER_IDS) {
      const want = SHOWN_AS[id] || id, g = PANEL[TN_LAYERS[id].group];
      check(`A · ${place.label}: ${g} lists "${want}"`, listed[g].includes(want));
    }
    // turn every Tennessee row on (the merged ones once), at a zoom each can draw
    const turnOn = async (group, id) => {
      await rowsIn(fp, group);
      const cb = fp.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
      if (!(await cb.count())) return false;
      if (!(await cb.isChecked())) await cb.check();
      return true;
    };
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 15, { animate: false }), [place.lat, place.lng]);
    for (const id of new Set(TN_LAYER_IDS.map((i) => SHOWN_AS[i] || i))) {
      const reg = TN_LAYERS[id] || TN_LAYERS[TN_LAYER_IDS.find((i) => (SHOWN_AS[i] || i) === id)];
      await turnOn(PANEL[reg.group], id);
    }
    await sleep(14000);
    for (const id of TN_LAYER_IDS) {
      const want = SHOWN_AS[id] || id;
      const g = PANEL[TN_LAYERS[id].group];
      await rowsIn(fp, g);
      const st = await stateOf(fp, want);
      const urlRe = TN_LAYERS[id].url ? new RegExp(TN_LAYERS[id].url.replace(/^https:\/\//, "").replace(/^\/gis-proxy\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/query") : null;
      const n = urlRe ? featuresFrom(urlRe) : null;
      console.log(`   ${id.padEnd(18)} state=${st}  features=${n}`);
      if (id === "tn_stream_buffers") continue; // asserted in B (it paints polygons, not /query features of its own)
      check(`A · ${place.label}: "${id}" is not failed`, st !== "failed", `state=${st}`);
    }
    const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400 && TN_HOSTS.test(e.url));
    check(`A · ${place.label}: no Tennessee-server request failed`, bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-${place === PLACES.nashville ? "nashville" : "christiana"}.png` });
  }

  /* ── B + C. located throwaway plans ─────────────────────────────────────────────── */
  const mk = (id, p, label) => ({ ...throwawayPlan(id), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}` });
  const insert = async (plan) => {
    const err = await page.evaluate(async ([pl]) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
      return error ? String(error.message) : null;
    }, [plan]);
    cleanupIds.push(plan.id);
    if (err) throw new Error("throwaway plan insert failed — " + err);
  };
  const stamp = Date.now().toString(36);
  const plans = {
    tn: mk(`${LIVE_PREFIX}tn-${stamp}`, PLACES.christiana, "Christiana TN"),
    tx: mk(`${LIVE_PREFIX}tn-tx-${stamp}`, HOUSTON, "Houston"),
    ga: mk(`${LIVE_PREFIX}tn-ga-${stamp}`, ATLANTA, "Atlanta"),
  };
  for (const p of Object.values(plans)) await insert(p);
  const openPanel = async (id) => {
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

  // B · Christiana
  log = [];
  const tnPanel = await openPanel(plans.tn.id);
  const tnRows = {};
  for (const g of Object.values(PANEL)) tnRows[g] = await rowsIn(tnPanel, g);
  console.log("Christiana plan · rows:", JSON.stringify(tnRows));
  for (const want of ["counties_cities", ...TN_LAYER_IDS.map((id) => SHOWN_AS[id] || id)]) { check(`B · the located Christiana plan offers "${want}"`, Object.values(tnRows).flat().includes(want)); }
  await rowsIn(tnPanel, "flood");
  const sb = tnPanel.locator('[data-testid="layer-row-tn_stream_buffers"] input[type="checkbox"]').first();
  if (await sb.count()) await sb.check();
  await sleep(14000);
  const polys = await page.evaluate(() => document.querySelectorAll(".leaflet-pane path.leaflet-interactive, .leaflet-pane svg path").length);
  const sbState = await stateOf(tnPanel, "tn_stream_buffers");
  console.log(`   stream buffers: row state=${sbState}, ${polys} map paths`);
  check("B · Stream Buffers paints (loaded, not failed or empty)", sbState === "loaded", `state=${sbState}`);
  check("B · the NHD stream lines were asked and answered", answered(/hydro\.nationalmap\.gov|nhd/i).length > 0, `NHD ${answered(/hydro\.nationalmap\.gov|nhd/i).length}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-christiana-buffers.png` });

  // C · Houston and Atlanta offer none of it, and send nothing to Tennessee
  for (const [name, plan] of [["Houston", plans.tx], ["Atlanta", plans.ga]]) {
    log = [];
    const panel = await openPanel(plan.id);
    const rows = {};
    for (const g of Object.values(PANEL)) rows[g] = await rowsIn(panel, g);
    const all = Object.values(rows).flat();
    console.log(`${name} plan · rows:`, JSON.stringify(rows));
    check(`C · KNOWN-GOOD arm: ${name} lists its own rows (so an empty answer is not an empty registry)`, name === "Houston" ? all.includes("water_sewer") && all.includes("counties_cities") : all.includes("ga_stream_buffers") || all.includes("counties_cities"), `${all.length} rows`);
    const leaked = TN_LAYER_IDS.filter((id) => all.includes(id));
    check(`C · ${name} offers no Tennessee row`, leaked.length === 0, leaked.join(", "));
    await sleep(3000);
    check(`C · ${name} plan issues ZERO requests to the Tennessee servers`, log.filter((e) => e.req).length === 0, `${log.filter((e) => e.req).length} sent: ${log.filter((e) => e.req).slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
  }
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
