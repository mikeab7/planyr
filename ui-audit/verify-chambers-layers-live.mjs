#!/usr/bin/env node
/* verify-chambers-layers-live — B2671240. Chambers County's layers, LIVE: the City of Mont Belvieu's zoning, water, sewer, storm and Master Drainage Plan, and the City of Baytown's zoning.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-chambers-layers-live.mjs https://planyr.io [--expect-sha <sha>] [--shots <dir>]    signed in as the test account (throwaway cloud plans, deleted at the end)
 *   node ui-audit/verify-chambers-layers-live.mjs https://<branch>.planyr.pages.dev --local                                a SIGNED-OUT run for a PR preview (no key there): plans are seeded into the
 *                                                                                                                           browser's own store, nothing touches the cloud
 *
 * Against the DEPLOYED build (/version.json read in the same call as the assertions):
 *   A. A throwaway LOCATED plan at the Targa plant (Mont Belvieu) lists every Mont Belvieu row and the two Master Drainage Plan rows, and NOT Baytown's; nothing is requested before a row is on.
 *   B. With the rows on, the city's server (through /gis-proxy) ANSWERS, the layers PAINT the features they were sent (window.__plannerLayers().features — esri-leaflet drops features if a `fields` list omits the
 *      object-id field, which no unit test can see), a click card at a point ON a known feature carries real values, the zoning card says "Hill Mixed Use" and the 2017 vintage, the legend is headed "Mont Belvieu",
 *      and a canvas click opens the zoning card.
 *   C. A plan on Baytown's heavy-industrial ground (its Chambers side): Baytown's zoning is listed and answers (the first page of a 24,849-parcel table), the card reads "HI · Heavy Industrial" and says the layer
 *      predates the 2025 code, the legend is headed "Baytown", and Mont Belvieu's CITY rows are not offered there (the plan rows are — its watersheds reach it).
 *   D. NOTHING LEAKS — throwaway plans in Houston (known-good arm: it lists Texas rows), Katy, Anahuac and Dallas offer none of the Chambers rows and issue ZERO requests to either host.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha");
const SHOTS = flag("--shots");
const LOCAL = args.includes("--local");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const HOSTS = /cmbgis\.com|2iaYWEMdQLPv0ZUw/;
const TARGA = { lat: 29.8405, lng: -94.9019 };
const BAYTOWN_HI = { lat: 29.80, lng: -94.873 };
const OTHER = { houston: { lat: 29.7604, lng: -95.3698 }, katy: { lat: 29.79, lng: -95.82 }, anahuac: { lat: 29.77, lng: -94.68 }, dallas: { lat: 32.7767, lng: -96.797 } };
/* Points ON real features (a vertex / interior point of a live feature, measured 2026-11-12 through the relay). */
const AT = {
  tx_mb_zoning: TARGA, tx_mb_water_main: { lat: 29.8464, lng: -94.89124 }, tx_mb_hydrants: { lat: 29.84642, lng: -94.89131 }, tx_mb_sewer_gravity: { lat: 29.85063, lng: -94.88127 },
  tx_mb_lift_stations: { lat: 29.84746, lng: -94.89441 }, tx_mb_storm_main: { lat: 29.85358, lng: -94.88411 }, tx_mb_plan_ponds: { lat: 29.83958, lng: -94.87692 },
  tx_mb_plan_culverts: { lat: 29.85339, lng: -94.87343 }, tx_mb_plan_watershed_cotton: { lat: 29.80908, lng: -94.84284 }, tx_baytown_zoning: BAYTOWN_HI, tx_mb_storm_culverts: { lat: 29.84909, lng: -94.88434 },
};

const TAG = Math.random().toString(36).slice(2, 7);
const localPlan = (key, p, label) => ({
  schemaVersion: 12, id: `zz-chm-${key}-${TAG}`, groupId: `zz-chm-${key}-${TAG}`, site: `ZZ Live Check — ${label}`, name: "Plan 1",
  origin: { lat: p.lat, lon: p.lng }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: -660, y: -660 }, { x: 660, y: -660 }, { x: 660, y: 660 }, { x: -660, y: 660 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [], updatedAt: Date.now(), data: { status: "active" },
});
const CLUSTER = { mainst: { lat: 29.84694, lng: -94.89286 }, storm: { lat: 29.8513, lng: -94.8842 }, pond: { lat: 29.83958, lng: -94.87692 }, pculv: { lat: 29.85339, lng: -94.87343 } };
const PLACES = { targa: [TARGA, "Targa"], mainst: [CLUSTER.mainst, "Main St water"], storm: [CLUSTER.storm, "Storm + sewer"], pond: [CLUSTER.pond, "Plan pond"], pculv: [CLUSTER.pculv, "Plan culvert"], bt: [BAYTOWN_HI, "Baytown HI"], houston: [OTHER.houston, "Houston"], katy: [OTHER.katy, "Katy"], anahuac: [OTHER.anahuac, "Anahuac"], dallas: [OTHER.dallas, "Dallas"] };
const PLANS = Object.fromEntries(Object.entries(PLACES).map(([k, [p, l]]) => [k, LOCAL ? localPlan(k, p, l) : { ...throwawayPlan(`${LIVE_PREFIX}chambers-${k}-${Date.now().toString(36)}`), site: `ZZ Live Check — ${l}`, origin: { lat: p.lat, lon: p.lng } }]));

let s = null, browser = null, page;
if (LOCAL) {
  const { chromium } = await import("@playwright/test");
  browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  page = await ctx.newPage();
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(Object.fromEntries(Object.values(PLANS).map((pl) => [pl.id, pl]))));
  s = { proof: { email: "(signed out — local plans)" }, close: () => browser.close() };
} else {
  for (let attempt = 1; attempt <= 6 && !s; attempt++) {
    try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
    catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
  }
  page = s.page;
}
await assertMeasurable(page, "verify-chambers-layers-live");
await page.setViewportSize({ width: 1500, height: 950 });
if (LOCAL) await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
page.on("response", async (res) => {
  const u = res.url(); if (!HOSTS.test(u)) return;
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : (typeof j.count === "number" ? j.count : null); } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { if (HOSTS.test(r.url())) log.push({ url: r.url(), status: "sent", features: null, req: true }); });
const answered = (re) => log.filter((e) => !e.req && re.test(e.url) && /\/query/.test(e.url));
const sent = () => log.filter((e) => e.req);
const layerSent = () => sent().filter((e) => !/AdministrativeArea_v2/.test(e.url));   // the header pill's ETJ lookup (NEW-1, B2671239) reads the same server by design
const ans = (re) => answered(re).filter((e) => e.status === 200).reduce((n, e) => n + (e.features || 0), 0);

const cleanupIds = [];
const insert = async (plan) => {
  if (LOCAL) return;
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  cleanupIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
};
const openPanel = async (id) => {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
  if (!LOCAL) await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(2500);
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await sleep(1200); // service-area geometry arrives by a dynamic import
  return panel;
};
const rowsIn = async (panel, group) => {
  const btn = panel.getByTestId(`layer-group-${group}`);
  if (await btn.count()) await btn.click();
  else if (await panel.getByTestId("layer-group-select").count()) await panel.getByTestId("layer-group-select").selectOption(group).catch(() => {});
  else return [];
  await sleep(300);
  return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
};
const turnOn = async (panel, group, id) => {
  await panel.getByTestId(`layer-group-${group}`).click(); await sleep(250);
  const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
  if (!(await cb.count())) { check(`row "${id}" has a checkbox to switch on`, false, "row not in this group"); return; }
  if (!(await cb.isChecked())) await cb.check();
};
const layers = () => page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers() : null)).then((h) => h && { on: h.on, live: h.live, features: h.features });
const identify = (id, at) => page.evaluate(([i, a]) => { const h = window.__plannerLayers && window.__plannerLayers(); const c = h && h.identify ? h.identify(i, a) : null; return c ? { title: c.title, rows: (c.rows || []).map((r) => ({ label: r.label, text: r.text })) } : null; }, [id, at]);
const txtOf = (c) => JSON.stringify(c || {});

try {
  for (const pl of Object.values(PLANS)) await insert(pl);

  /* ── A. Targa: the rows are listed ──────────────────────────────────────────────────────── */
  log = [];
  let panel = await openPanel(PLANS.targa.id);
  const jur = await rowsIn(panel, "jur"), util = await rowsIn(panel, "util"), flood = await rowsIn(panel, "flood");
  console.log("Targa · Jurisdictions:", jur.join(", ")); console.log("Targa · Utilities:", util.join(", ")); console.log("Targa · Flood & Drainage:", flood.join(", "));
  check("A · Jurisdictions offers Mont Belvieu zoning", jur.includes("tx_mb_zoning"));
  check("A · Jurisdictions does NOT offer Baytown's zoning at Mont Belvieu", !jur.includes("tx_baytown_zoning"));
  for (const id of ["water_sewer", "fire_hydrants", "tx_mb_storm"]) check(`A · Utilities offers "${id}"`, util.includes(id));
  for (const id of ["tx_mb_plan_basins", "tx_mb_plan_projects"]) check(`A · Flood & Drainage offers "${id}" (the Master Drainage Plan)`, flood.includes(id));
  check("A · no LAYER is requested before a row is switched on (the header's ETJ lookup excepted)", layerSent().length === 0, `${layerSent().length} sent: ${layerSent().slice(0, 3).map((e) => e.url.slice(-70)).join(" | ")}`);

  /* ── B. Targa: rows on, answers, paint, cards ───────────────────────────────────────────── */
  await turnOn(panel, "jur", "tx_mb_zoning");
  await sleep(9000);
  const L = await layers(), F = (L && L.features) || {};
  console.log("Targa painted features:", JSON.stringify(Object.fromEntries(Object.entries(F).filter(([k]) => k.startsWith("tx_")))));
  const Q = (path) => new RegExp(path.replace(/\//g, "\\/") + "\\/query");
  check("B · zoning answered with polygons", ans(Q("LandUsePlanning_v2/MapServer/0")) > 0, String(ans(Q("LandUsePlanning_v2/MapServer/0"))));
  const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
  check("B · no request to the city's server failed", bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
  check("B · tx_mb_zoning: painted ≥ 1 feature at the Targa view", (F.tx_mb_zoning || 0) >= 1, String(F.tx_mb_zoning));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-targa-zoning.png` });
  const zc = await identify("tx_mb_zoning", AT.tx_mb_zoning);
  console.log("card tx_mb_zoning:", JSON.stringify(zc));
  check('B · zoning card at the Targa plant: "Hill Mixed Use" and the 2017 vintage line', /Hill Mixed Use/.test(txtOf(zc)) && /2017 layer — confirm with Planning/.test(txtOf(zc)), "");
  check("B · the zoning card prints no raw field name, zero or empty row", !/ZONEDESC|ZONECLASS|:\s*"?0"?\b|null/.test(txtOf(zc)), txtOf(zc).slice(0, 120));

  await panel.getByTestId("layer-group-jur").click(); await sleep(300);
  await panel.getByTestId("layer-caret-tx_mb_zoning").click(); await sleep(1500);
  const lg = await panel.locator('[data-testid="layer-row-tx_mb_zoning-menu"] [data-part="legend"]').first().innerText().catch(() => "");
  console.log("zoning legend:\n" + lg.split("\n").map((l) => "   " + l).join("\n"));
  check('B · the zoning legend is headed "Mont Belvieu"', /^Mont Belvieu/.test(lg.trim()), lg.split("\n")[0]);
  check("B · and lists Hill Mixed Use, one per row, no city suffix", /Hill Mixed Use/.test(lg) && !/\(Mont Belvieu\)/.test(lg), "");

  const canvas = page.getByTestId("planner-canvas");
  const box = await canvas.boundingBox();
  let cardText = "", tried = 0;
  for (const [dx, dy] of [[0, 0], [150, 60], [-150, 60], [200, -80], [-200, -80], [0, 180]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy); await sleep(2500);
    cardText = await page.getByTestId("gis-identify").first().innerText().catch(() => ""); tried++;
    if (/Zoning/.test(cardText)) break;
  }
  console.log(`(zoning card found after ${tried} tap(s))\n` + cardText.split("\n").map((l) => "   " + l).join("\n"));
  check("B · a canvas click opens a card that includes the Mont Belvieu zoning card", /Zoning · Mont Belvieu/.test(cardText), "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-canvas-click-card.png` });

  /* ── B2. Plans centred ON each utility / drainage cluster: the layers answer, paint, and open a clean card ── */
  const CLUSTERS = [
    ["mainst", [["util", "water_sewer"], ["util", "fire_hydrants"]], ["tx_mb_water_main", "tx_mb_hydrants", "tx_mb_lift_stations"]],
    ["storm", [["util", "water_sewer"], ["util", "tx_mb_storm"]], ["tx_mb_sewer_gravity", "tx_mb_storm_main", "tx_mb_storm_culverts"]],
    ["pond", [["flood", "tx_mb_plan_projects"], ["flood", "tx_mb_plan_basins"]], ["tx_mb_plan_ponds"]],
    ["pculv", [["flood", "tx_mb_plan_projects"]], ["tx_mb_plan_culverts"]],
  ];
  const cards = {};
  for (const [key, ons, ids] of CLUSTERS) {
    log = [];
    const pn = await openPanel(PLANS[key].id);
    for (const [g, id] of ons) await turnOn(pn, g, id);
    await sleep(12000);
    const Lc = await layers(), Fc = (Lc && Lc.features) || {};
    console.log(`${key} painted:`, JSON.stringify(Object.fromEntries(Object.entries(Fc).filter(([k]) => k.startsWith("tx_") && Fc[k] > 0))));
    for (const id of ids) {
      check(`B2 · ${key}: ${id} painted ≥ 1 feature`, (Fc[id] || 0) >= 1, String(Fc[id]));
      const c = await identify(id, AT[id]); cards[id] = c;
      console.log(`card ${id}:`, JSON.stringify(c && { title: c.title, rows: (c.rows || []).map((r) => `${r.label}: ${r.text}`) }));
      check(`B2 · ${id}: a click card opens at a known feature, with a title`, !!(c && c.title), c ? c.title : "no card");
    }
    const badc = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
    check(`B2 · ${key}: no request to the city's server failed`, badc.length === 0, badc.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
    if (key === "pond") check("B2 · pond: the plan's watersheds painted too (at least one basin row)", Object.keys(Fc).some((k) => /^tx_mb_plan_(watershed|grand|subbasins)/.test(k) && Fc[k] > 0), "");
  }
  const everyCard = Object.values(cards).map(txtOf).join("");
  check("B2 · no utility card prints a raw field name, a placeholder size (0 / -1 / -9) or an owner code", !/DIAMETER|OWNEDBY|MATERIAL|"-1|"-9|:\s*"?-?0"?(\b|")/.test(everyCard.replace(/"label":"[^"]*"/g, "")), everyCard.slice(0, 200));
  check("B2 · the plan's pond card shows no depth, volume or market value (#4)", !/Depth|Volume|Market|Vol_/i.test(txtOf(cards.tx_mb_plan_ponds)), txtOf(cards.tx_mb_plan_ponds).slice(0, 160));

  /* ── C. Baytown's industrial ground (its Chambers side) ─────────────────────────────────── */
  log = [];
  panel = await openPanel(PLANS.bt.id);
  const jur2 = await rowsIn(panel, "jur"), util2 = await rowsIn(panel, "util"), flood2 = await rowsIn(panel, "flood");
  check("C · Baytown's zoning is offered on its Chambers-side ground", jur2.includes("tx_baytown_zoning"), jur2.join(", "));
  check("C · Mont Belvieu's zoning is NOT offered there", !jur2.includes("tx_mb_zoning"));
  check("C · the Master Drainage Plan IS offered (its watersheds reach this ground)", flood2.includes("tx_mb_plan_basins"), flood2.join(", "));
  await turnOn(panel, "jur", "tx_baytown_zoning");
  await turnOn(panel, "util", "water_sewer");     // the shared Water & Sewer row exists everywhere; its Mont Belvieu members must stay silent HERE
  await sleep(14000);
  check("C · switching Water & Sewer on at Baytown issues ZERO requests to Mont Belvieu's water or sewer services", sent().filter((e) => /WaterDistribution_v2|SewerStormwater_v2|Stormwater_v2/.test(e.url)).length === 0, "");
  const L2 = await layers(), F2 = (L2 && L2.features) || {};
  check("C · Baytown's zoning answered with parcels (first page of the 24,849-polygon table)", ans(/FeatureServer\/10\/query/) > 0, String(ans(/FeatureServer\/10\/query/)));
  check("C · Baytown's zoning PAINTED ≥ 2 features at the Baytown view", (F2.tx_baytown_zoning || 0) >= 2, String(F2.tx_baytown_zoning));
  const bt = await identify("tx_baytown_zoning", AT.tx_baytown_zoning);
  console.log("card tx_baytown_zoning:", JSON.stringify(bt));
  check('C · card at the industrial ground: "HI · Heavy Industrial"', /HI · Heavy Industrial/.test(txtOf(bt)), "");
  check("C · the card says the layer predates Baytown's new code (2023-02-16 → 2025-01-01)", /2023-02-16/.test(txtOf(bt)) && /2025-01-01/.test(txtOf(bt)), "");
  await panel.getByTestId("layer-group-jur").click(); await sleep(300);
  await panel.getByTestId("layer-caret-tx_baytown_zoning").click(); await sleep(1500);
  const lg2 = await panel.locator('[data-testid="layer-row-tx_baytown_zoning-menu"] [data-part="legend"]').first().innerText().catch(() => "");
  console.log("baytown legend:\n" + lg2.split("\n").map((l) => "   " + l).join("\n"));
  check('C · the zoning legend is headed "Baytown" with one code per row', /^Baytown/.test(lg2.trim()) && /HI · Heavy Industrial/.test(lg2), lg2.split("\n")[0]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/C-baytown.png` });

  /* ── D. Nothing leaks ─────────────────────────────────────────────────────────────────────── */
  for (const k of ["houston", "katy", "anahuac", "dallas"]) {
    log = [];
    const pn = await openPanel(PLANS[k].id);
    const all = [...await rowsIn(pn, "jur"), ...await rowsIn(pn, "util"), ...await rowsIn(pn, "flood")];
    if (k === "houston") check("D · Houston (known-good arm) lists Texas rows", all.length > 0 && all.some((id) => /jur_|coh_|fema|hcfcd/.test(id)), all.slice(0, 6).join(", "));
    check(`D · ${k}: none of the Chambers rows is offered`, !all.some((id) => /^tx_mb_|^tx_baytown_/.test(id)), all.filter((id) => /^tx_/.test(id)).join(", "));
    await sleep(3000);
    check(`D · ${k}: ZERO requests to the Mont Belvieu server or Baytown's org (header ETJ lookups included — their boxes are tight)`, sent().length === 0, `${sent().length} sent: ${sent().slice(0, 2).map((e) => e.url.slice(-70)).join(" | ")}`);
  }
} finally {
  if (LOCAL) check("(local run) nothing was written to the cloud — plans lived only in this browser", true, "");
  else {
    const gone = await page.evaluate(async (ids) => {
      let left = 0;
      for (const id of ids) {
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await window.pfSupabase.from("sites").delete().eq("id", id);
        const q = await window.pfSupabase.from("sites").select("id").eq("id", id); left += (q.data || []).length;
      }
      return { left };
    }, cleanupIds).catch((e) => ({ left: -1, err: String(e) }));
    check("every throwaway plan deleted and verified gone from the cloud", gone.left === 0, JSON.stringify(gone));
  }
  await s.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
