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
  if (!TN_HOSTS.test(u) && !/services\d?\.arcgis\.com|nationalmap\.gov/.test(u)) return;
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
  await panel.getByTestId("layer-group-nav").waitFor({ timeout: 20000 }).catch(() => {});
  const btn = panel.getByTestId(`layer-group-${group}`);
  if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(group);
  await sleep(250);
  return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
};
const stateOf = (panel, id) => panel.locator(`[data-testid="layer-row-${id}"]`).first().getAttribute("data-layer-state").catch(() => null);
/* the merged rows the panel shows in place of the individual ids */
const SHOWN_AS = { tn_county: "counties_cities", tn_city: "counties_cities", tn_pws: "water_sewer" };

try {
  /* ── A. the finder, one row at a time, at that row's OWN first-drawing zoom ─────────────────────────────────────────────
   * The draw budget trips at the zoom a row FIRST draws (z9–z12), not at the zoom 15 an earlier version of this script turned everything on at, and a row with no
   * assertion on its feature count passes while drawing nothing. So: every row, alone, centred on Nashville at its own minZoom → "loaded" (never "empty"/"failed"/over-budget),
   * with real features in the /query answers it actually received. The budget-prone rows are repeated around Johnson City / Greeneville (a 112,589-vertex water system, whole
   * mussel reaches) at minZoom and +2. */
  const rowRe = (id) => {
    const u = TN_LAYERS[id].url;
    return u ? new RegExp(u.replace(/^https:\/\//, "").replace(/^\/gis-proxy\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/query") : null;
  };
  const JOHNSON = { lat: 36.38, lng: -82.9, label: "Greeneville / Johnson City" };
  const BUDGET_ROWS = ["tn_pws", "tn_crit_habitat", "tn_wqa", "tn_ms4"];
  const HATCHIE = { lat: 35.05, lng: -88.785, label: "Hatchie Scenic River (west TN)" };      // one 143,521-vertex MultiPolygon, returned whole
  const HOLSTON = { lat: 36.463, lng: -83.318, label: "Holston mussel reaches (Hawkins / Hancock)" };   // critical habitat: the worst Tennessee cell (reviewed: 258–382k vertices at z17 unsimplified)
  /* the row's data-layer-state is the ZOOM-GATE state ("drawing" = on and past its gate); the load/refusal wording lives in the ▾ dropdown's status line */
  const statusText = async (panel, id) => {
    const row = panel.locator(`[data-testid="layer-row-${id}"]`).first();
    if (!(await row.locator(`[data-testid="layer-row-${id}-menu"]`).count())) await panel.locator(`[data-testid="layer-caret-${id}"]`).first().click().catch(() => {});
    await sleep(400);
    return row.innerText().catch(() => "");
  };
  async function oneRow(id, place, zoom) {
    log = [];
    const fp = await openFinder(place, zoom);
    const want = SHOWN_AS[id] || id, g = PANEL[TN_LAYERS[id].group];
    const listed = await rowsIn(fp, g);
    check(`A · ${place.label}: ${g} lists "${want}"`, listed.includes(want));
    const cb = fp.locator(`[data-testid="layer-row-${want}"] input[type="checkbox"]`).first();
    if (!(await cb.count())) { check(`A · "${want}" has a checkbox`, false); return; }
    if (!(await cb.isChecked())) await cb.check();
    await sleep(id === "tn_stream_buffers" ? 12000 : 9000);
    const st = await stateOf(fp, want), txt = await statusText(fp, want);
    const re = rowRe(id), n = re ? featuresFrom(re) : null;
    console.log(`   ${id.padEnd(18)} ${place.label.padEnd(26)} z${zoom}  state=${st}  features=${n}`);
    check(`A · ${id} @ ${place.label} z${zoom}: drawing (not dormant-blank / empty)`, st === "drawing", `state=${st}`);
    check(`A · ${id} @ ${place.label} z${zoom}: not refused as too detailed`, !/too detailed/i.test(txt));
    check(`A · ${id} @ ${place.label} z${zoom}: status line is not a failure`, !/not responding|couldn't load|hiccup/i.test(txt), JSON.stringify(txt.slice(0, 140)));
    if (re) check(`A · ${id} @ ${place.label} z${zoom}: real features came back`, n > 0, `${n}`);
    const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400 && TN_HOSTS.test(e.url));
    check(`A · ${id} @ ${place.label}: no Tennessee-server request failed`, bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-${id}-${place === PLACES.nashville ? "nashville" : "other"}-z${zoom}.png` });
  }
  for (const id of TN_LAYER_IDS) {
    const z = Math.min(17, Math.max(Number(TN_LAYERS[id].minZoom) || 12, 9));
    // the stream buffers draw off the NHD streams — judged on Christiana's creeks; the others on Nashville, where each has data
    await oneRow(id, id === "tn_stream_buffers" ? PLACES.christiana : PLACES.nashville, id === "tn_stream_buffers" ? 14 : z);
  }
  for (const id of BUDGET_ROWS) for (const dz of [0, 2]) await oneRow(id, JOHNSON, Math.min(17, Math.max(Number(TN_LAYERS[id].minZoom) || 12, 9) + dz));
  for (const dz of [0, 2]) await oneRow("tn_scenic", HATCHIE, Math.max(Number(TN_LAYERS.tn_scenic.minZoom) || 9, 9) + dz);
  await oneRow("tn_crit_habitat", HOLSTON, 17.25);   // the deepest zoom the row is sized to draw
  { // closer in it must REFUSE honestly ("too detailed"), never read "empty"/"loaded"
    log = [];
    const fp = await openFinder(HOLSTON, 19);
    await rowsIn(fp, "env");
    const cb = fp.locator('[data-testid="layer-row-tn_crit_habitat"] input[type="checkbox"]').first();
    if (await cb.count() && !(await cb.isChecked())) await cb.check();
    await sleep(9000);
    const st = await stateOf(fp, "tn_crit_habitat");
    const txt19 = await statusText(fp, "tn_crit_habitat");
    check("A · tn_crit_habitat @ Holston z19: refused as too detailed, never 'no features here'", /too detailed/i.test(txt19) && !/no features/i.test(txt19), `state=${st}`);
    console.log("   z19 row text:", JSON.stringify(txt19.slice(0, 160)), "(the refusal wording lives in the row's status line)");
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
  const polys = await page.evaluate(() => document.querySelectorAll(".leaflet-pane path").length);
  const sbState = await stateOf(tnPanel, "tn_stream_buffers");
  console.log(`   stream buffers: row state=${sbState}, ${polys} map paths`);
  const sbText = await (async () => { await tnPanel.locator('[data-testid="layer-caret-tn_stream_buffers"]').first().click().catch(() => {}); await sleep(400); return tnPanel.locator('[data-testid="layer-row-tn_stream_buffers"]').first().innerText().catch(() => ""); })();
  console.log("   stream buffers status line:", JSON.stringify(sbText.slice(0, 200)));
  check("B · Stream Buffers draws (state drawing) and says what it drew", sbState === "drawing" && /30 ft/.test(sbText) && !/No streams in this view/.test(sbText), `state=${sbState}`);
  check("B · …and real buffer polygons are on the map", polys > 0, `${polys} paths`);
  check("B · the NHD stream lines were asked and answered", answered(/hydro\.nationalmap\.gov|nhd/i).length > 0, `NHD ${answered(/hydro\.nationalmap\.gov|nhd/i).length}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-christiana-buffers.png` });

  // C · Houston and Atlanta offer none of it, and — with their own rows switched ON — send nothing to Tennessee
  for (const [name, plan] of [["Houston", plans.tx], ["Atlanta", plans.ga]]) {
    log = [];
    const panel = await openPanel(plan.id);
    const rows = {};
    for (const g of Object.values(PANEL)) rows[g] = await rowsIn(panel, g);
    const all = Object.values(rows).flat();
    console.log(`${name} plan · rows:`, JSON.stringify(rows));
    check(`C · KNOWN-GOOD arm: ${name} lists its own rows (so an empty answer is not an empty registry)`, name === "Houston" ? all.includes("water_sewer") && all.includes("counties_cities") : all.includes("ga_stream_buffers") || all.includes("counties_cities"), `${all.length} rows`);
    const leaked = all.filter((id) => /^tn_/.test(id));
    check(`C · ${name} offers no Tennessee row`, leaked.length === 0, leaked.join(", "));
    // switch the merged rows (Counties & Cities, Water & Sewer — where tn_city / tn_county / tn_pws would hide) and the Environmental rows ON
    for (const [g, ids] of [["jur", ["counties_cities"]], ["util", ["water_sewer"]], ["env", rows.env.slice(0, 6)]]) {
      await rowsIn(panel, g);
      for (const id of ids) { const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first(); if (await cb.count() && !(await cb.isChecked())) await cb.check().catch(() => {}); }
    }
    await sleep(9000);
    const sent = log.filter((e) => e.req);
    check(`C · ${name} plan (own layers ON) issues ZERO requests to the Tennessee servers`, sent.length === 0, `${sent.length} sent: ${sent.slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
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
