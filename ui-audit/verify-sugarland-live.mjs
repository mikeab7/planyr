/* verify-sugarland-live — City of Sugar Land layers (B2638208), LIVE on planyr.io (or a preview), signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-sugarland-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * It proves, against the DEPLOYED build (read from /version.json in the same call as the assertions):
 *   A. A throwaway LOCATED plan at the Academy point (29.6122, −95.6693 — inside the city, beside Sugar Land Regional Airport) lists every Sugar Land row
 *      (Access: Thoroughfare Plan, Capital Projects · Jurisdictions: Zoning, Airport Zoning, Future Land Use, Zoning Cases, Public Right-of-Way & Land, Tax Increment Zones,
 *      Available Sites, Development Projects · Utilities: the Fire Hydrants row) and the Utilities group carries "Sugar Land does not publish water or sewer lines."
 *   B. With the rows on, the city's server (through /gis-proxy) and the city's org each ANSWER, the layers PAINT the features they were sent (window.__plannerLayers().features —
 *      esri-leaflet drops features if a `fields` list omits the object-id field, which no unit test can see), a click card carries real values (the layer's own identify at a point
 *      ON a known feature), the zoning legend is headed "Sugar Land" with one code per row, and a canvas click opens the zoning card.
 *   C. A second plan at Town Square (the case, TIRZ, available-site and development-project layers have features there).
 *   D. NOTHING LEAKS — a throwaway plan in Houston (known-good arm: it lists Texas rows) offers none of the Sugar Land rows and issues ZERO requests to the city's server
 *      or its org.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). */
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

const HOSTS = /interactivemaps\.sugarlandtx\.gov|SVtsrBXEiBhI5L5n/;
const ACADEMY = { lat: 29.6122, lng: -95.6693 };
const TOWN_SQUARE = { lat: 29.6197, lng: -95.6349 };
const HOUSTON = { lat: 29.80, lng: -95.54 };
const AZ02 = { lat: 29.61, lng: -95.6554 };    // inside the AZ-02 polygon (the city's service answers AZ-02 alone here)
const ANID = { lat: 29.635, lng: -95.668 };    // inside the ANID polygon and inside the city+ETJ area (ANID alone; the ANID north of ~29.64 lies outside the area, so the layer is not offered there)

/* --local: a SIGNED-OUT run for a PR preview (the preview has no E2E_LOGIN_KEY, so it cannot sign in): the three located plans are seeded into the browser's own plan store, nothing touches the
 * cloud, nothing needs cleaning up. The layers, requests, cards and legend are identical; only "signed in as the test account" is not proved. */
const LOCAL = args.includes("--local");
const TAG = Math.random().toString(36).slice(2, 7);
const localPlan = (key, p, label) => ({
  schemaVersion: 12, id: `zz-sl-${key}-${TAG}`, groupId: `zz-sl-${key}-${TAG}`, site: `ZZ Live Check — ${label}`, name: "Plan 1",
  origin: { lat: p.lat, lon: p.lng }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [], updatedAt: Date.now(), data: { status: "active" },
});
const LOCAL_PLANS = {};
let s = null, browser = null, page;
if (LOCAL) {
  const { chromium } = await import("@playwright/test");
  browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  page = await ctx.newPage();
  LOCAL_PLANS.ac = localPlan("ac", { lat: 29.6122, lng: -95.6693 }, "Academy"); LOCAL_PLANS.ts = localPlan("ts", { lat: 29.6197, lng: -95.6349 }, "Town Square"); LOCAL_PLANS.hou = localPlan("hou", { lat: 29.80, lng: -95.54 }, "Houston");
  LOCAL_PLANS.az02 = localPlan("az02", { lat: 29.61, lng: -95.6554 }, "AZ-02"); LOCAL_PLANS.anid = localPlan("anid", { lat: 29.635, lng: -95.668 }, "ANID");
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(Object.fromEntries(Object.values(LOCAL_PLANS).map((pl) => [pl.id, pl]))));
  s = { proof: { email: "(signed out — local plans)" }, close: () => browser.close() };
} else {
  for (let attempt = 1; attempt <= 6 && !s; attempt++) {
    try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
    catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
  }
  page = s.page;
}
await assertMeasurable(page, "verify-sugarland-live");
await page.setViewportSize({ width: 1500, height: 950 });
if (LOCAL) await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!HOSTS.test(u)) return;
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : (typeof j.count === "number" ? j.count : null); } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { if (HOSTS.test(r.url())) log.push({ url: r.url(), status: "sent", features: null, req: true }); });
const answered = (re) => log.filter((e) => !e.req && re.test(e.url) && /\/query/.test(e.url));
const sent = () => log.filter((e) => e.req);

const mk = (id, p, label) => (LOCAL ? LOCAL_PLANS[id.includes("-ac-") ? "ac" : id.includes("-ts-") ? "ts" : id.includes("-az02-") ? "az02" : id.includes("-anid-") ? "anid" : "hou"] : { ...throwawayPlan(id), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}` });
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
  else return []; // the group is not offered at this site (a group with no rows is hidden)
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
/* the layer's own identify at a point, reduced to what is printed (the raw item holds Leaflet objects — not serialisable) */
const identify = (id, at) => page.evaluate(([i, a]) => { const h = window.__plannerLayers && window.__plannerLayers(); const c = h && h.identify ? h.identify(i, a) : null; return c ? { title: c.title, rows: (c.rows || []).map((r) => ({ label: r.label, text: r.text, href: r.href })) } : null; }, [id, at]);

/* Points ON known features (vertices of real features, found 2026-11-02 — the same points as the registry fixtures). */
const AT = {
  sl_thoroughfare: { lat: 29.61977, lng: -95.6352 }, sl_zoning: ACADEMY, sl_airport_zoning: ACADEMY, sl_flu: ACADEMY, sl_capital_projects: { lat: 29.61655, lng: -95.66944 },
  sl_public_land: { lat: 29.61071, lng: -95.674 }, sl_hydrants: { lat: 29.61988, lng: -95.63498 },
  sl_zoning_cup: { lat: 29.61948, lng: -95.63528 }, sl_zoning_exception: { lat: 29.61637, lng: -95.63265 }, sl_zoning_variance: { lat: 29.6193, lng: -95.63435 },
  sl_tirz: { lat: 29.6197, lng: -95.63512 }, sl_available_sites: { lat: 29.62192, lng: -95.63849 }, sl_dev_projects: { lat: 29.61584, lng: -95.64191 },
};

try {
  const acPlan = mk(`${LIVE_PREFIX}sugarland-ac-${Date.now().toString(36)}`, ACADEMY, "Academy"), tsPlan = mk(`${LIVE_PREFIX}sugarland-ts-${Date.now().toString(36)}`, TOWN_SQUARE, "Town Square");
  const txPlan = mk(`${LIVE_PREFIX}sugarland-hou-${Date.now().toString(36)}`, HOUSTON, "Houston");
  await insert(acPlan); await insert(tsPlan); await insert(txPlan);

  /* ── A. Academy: the rows are listed ─────────────────────────────────────────────────────── */
  log = [];
  let panel = await openPanel(acPlan.id);
  const access = await rowsIn(panel, "access"), jur = await rowsIn(panel, "jur"), util = await rowsIn(panel, "util");
  console.log("Academy · Access rows:", access.join(", ")); console.log("Academy · Jurisdictions rows:", jur.join(", ")); console.log("Academy · Utilities rows:", util.join(", "));
  for (const id of ["sl_thoroughfare", "sl_capital_projects"]) check(`A · Access offers "${id}"`, access.includes(id));
  for (const id of ["sl_zoning", "sl_airport_zoning", "sl_flu", "sl_zoning_cases", "sl_public_land", "sl_tirz", "sl_available_sites", "sl_dev_projects"]) check(`A · Jurisdictions offers "${id}"`, jur.includes(id));
  check('A · Utilities offers the Fire Hydrants row', util.includes("fire_hydrants"));
  const note = await page.getByTestId("layer-group-note").first().innerText().catch(() => "");
  check('A · Utilities says "Sugar Land does not publish water or sewer lines."', /Sugar Land does not publish water or sewer lines\./.test(note), note.replace(/\n/g, " "));
  const href = await page.getByTestId("layer-group-note").locator("a").first().getAttribute("href").catch(() => null);
  check("A · and links the city's Utility Map Request form", href === "https://survey123.arcgis.com/share/a9755767526546b5a9509d1648399862", String(href));
  const early = sent();
  console.log("requests before any layer is on:", early.map((e) => e.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 100)).join(" | ") || "(none)");
  check("A · nothing from the city is requested before a layer is switched on", early.length === 0, `${early.length} sent`);

  /* ── B. Academy: rows on, answers, paint, cards ──────────────────────────────────────────── */
  for (const id of ["sl_thoroughfare", "sl_capital_projects"]) await turnOn(panel, "access", id);
  for (const id of ["sl_zoning", "sl_airport_zoning", "sl_flu", "sl_zoning_cases", "sl_public_land", "sl_tirz", "sl_available_sites", "sl_dev_projects"]) await turnOn(panel, "jur", id);
  await turnOn(panel, "util", "fire_hydrants");
  await sleep(14000);
  const L = await layers();
  console.log("painted features:", JSON.stringify(Object.fromEntries(Object.entries((L && L.features) || {}).filter(([k]) => k.startsWith("sl_")))));
  const ans = (re) => answered(re).filter((e) => e.status === 200).reduce((n, e) => n + (e.features || 0), 0);
  const asked = (re) => answered(re).some((e) => e.status === 200);
  check("B · Thoroughfare Plan: the city server answered with segments", ans(/Master_Thoroughfare_Plan\/MapServer\/0\/query/) > 0, String(ans(/Master_Thoroughfare_Plan\/MapServer\/0\/query/)));
  check("B · Zoning: the city server answered with polygons (the Zoning_GWNT copy, which carries geometry)", ans(/Zoning_GWNT\/MapServer\/0\/query/) > 0, String(ans(/Zoning_GWNT\/MapServer\/0\/query/)));
  check("B · Airport Zoning answered", ans(/Airport_Zoning\/MapServer\/0\/query/) > 0, String(ans(/Airport_Zoning\/MapServer\/0\/query/)));
  check("B · Public land answered", ans(/ROW_and_Property_Public_Entities\/MapServer\/0\/query/) > 0, String(ans(/ROW_and_Property_Public_Entities\/MapServer\/0\/query/)));
  check("B · Future Land Use (org) answered", ans(/Future_Land_Use_Map_2022_WFL1\/FeatureServer\/8\/query/) > 0, String(ans(/Future_Land_Use_Map_2022_WFL1\/FeatureServer\/8\/query/)));
  check("B · Hydrants (org) was asked and answered 200 (the Academy tract is undeveloped: the nearest mapped hydrant is ~775 m away, so 0 features here is the true answer)", asked(/COSLHydrantInspections_FeatureService\/FeatureServer\/0\/query/));
  check("B · Capital Projects (org) answered", ans(/CIPDatabase2024_Public\/FeatureServer\/6\/query/) > 0, String(ans(/CIPDatabase2024_Public\/FeatureServer\/6\/query/)));
  for (const n of [0, 1, 2]) check(`B · Overlays layer ${n} (zoning cases) was asked and answered 200`, asked(new RegExp(`Overlays/FeatureServer/${n}/query`)));
  for (const [re, nm] of [[/TIRZ\/FeatureServer\/0\/query/, "TIRZ"], [/EcoDev_Available_Sites_VIEW\/FeatureServer\/0\/query/, "Available Sites"], [/Development_Projects_\(City_Wide\)_view_layer\/FeatureServer\/0\/query|Development_Projects_%28City_Wide%29_view_layer\/FeatureServer\/0\/query/, "Development Projects"]]) check(`B · ${nm} was asked and answered 200`, asked(re));
  const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
  check("B · no request to the city's server or org failed", bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
  const F = (L && L.features) || {};
  /* the paint arm: a layer that was SENT features must have PAINTED them (a `fields` list without the object-id collapses a layer to one feature) */
  for (const id of ["sl_thoroughfare", "sl_zoning", "sl_airport_zoning", "sl_flu", "sl_capital_projects", "sl_public_land"]) check(`B · ${id}: painted ≥ 1 feature at the Academy view`, (F[id] || 0) >= 1, String(F[id]));
  for (const id of ["sl_zoning", "sl_flu", "sl_capital_projects", "sl_public_land"]) check(`B · ${id}: painted ≥ 2 features (the layer is not collapsed to one)`, (F[id] || 0) >= 2, String(F[id]));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-academy-all-layers.png` });

  /* cards at points ON real features */
  const card = {};
  for (const id of ["sl_zoning", "sl_airport_zoning", "sl_flu", "sl_capital_projects", "sl_public_land"]) {
    card[id] = await identify(id, AT[id]);
    console.log(`card ${id}:`, JSON.stringify(card[id] && { title: card[id].title, rows: (card[id].rows || []).map((r) => `${r.label}: ${r.text}`) }));
    check(`B · ${id}: a click card opens at a known feature, with a title`, !!(card[id] && card[id].title), card[id] ? card[id].title : "no card");
  }
  const rowsOf = (id) => (card[id] && card[id].rows) || [];
  const txt = (id) => JSON.stringify(card[id] || {});
  check("B · zoning card at the Academy point: R-1Z with the city's name", /R-1Z · Zero Lot Line Single-Family Residential/.test(txt("sl_zoning")), "");
  const az1 = (card.sl_airport_zoning && card.sl_airport_zoning.rows) || [];
  check("B · airport zoning at the Academy point is AZ-01 and LEADS with the industrial line (warehouse & distribution permitted, subject to the base zoning)", /AZ-01/.test(card.sl_airport_zoning && card.sl_airport_zoning.title) && az1[0] && az1[0].label === "Warehouse & distribution" && /Permitted here, subject to the base zoning \(Sec\. 9-17, Table 9-17\.1\)/.test(az1[0].text), JSON.stringify(az1[0]));
  check("B · AZ-01 card: residential prohibited (Sec. 9-16), 'both the base zoning and AZ-01 apply', a link to the Municode Chapter 9 page", /Sec\. 9-16/.test(txt("sl_airport_zoning")) && /both the base zoning and AZ-01 apply/.test(txt("sl_airport_zoning")) && az1.some((r) => /municode\.com.*CH9SULAREAIZORE/.test(r.href || "")), "");
  check("B · AZ-01 card states no height or distance, and no 'not read' hedge", !/\b\d+\s*(ft|feet)/i.test(txt("sl_airport_zoning")) && !/height limit|has not read/i.test(txt("sl_airport_zoning")), "");
  check("B · future land use at the Academy point: Light Industrial", /Light Industrial/.test(txt("sl_flu")), "");
  check("B · capital project card: phase and (when the city states one) budget", rowsOf("sl_capital_projects").some((r) => r.label === "Phase"), "");
  check("B · public land card: owner as title, address", !!(card.sl_public_land && card.sl_public_land.title) && rowsOf("sl_public_land").some((r) => r.label === "Address"), "");

  /* the zoning legend: headed by the jurisdiction, one code per row */
  await panel.getByTestId("layer-group-jur").click(); await sleep(300);
  await panel.getByTestId("layer-caret-sl_zoning").click(); await sleep(1500);
  const lg = await panel.locator('[data-testid="layer-row-sl_zoning-menu"] [data-part="legend"]').first().innerText().catch(() => "");
  console.log("zoning legend:\n" + lg.split("\n").map((l) => "   " + l).join("\n"));
  check('B · the zoning legend is headed "Sugar Land"', /^Sugar Land/.test(lg.trim()), lg.split("\n")[0]);
  check("B · and lists the Academy district, with the city's name, one per row", /R-1Z · Zero Lot Line Single-Family Residential/.test(lg), "");
  check("B · no legend row carries the city as a suffix", !/\(Sugar Land\)/.test(lg), "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-zoning-legend.png` });

  /* a real canvas click on empty ground opens the zoning card */
  const canvas = page.getByTestId("planner-canvas");
  const box = await canvas.boundingBox();
  let cardText = "", tried = 0;
  for (const [dx, dy] of [[260, 40], [-300, 60], [280, 200], [-280, 200], [320, -60], [0, 230], [-120, -150]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await sleep(2500);
    cardText = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
    tried++;
    if (/Zoning/.test(cardText)) break;
  }
  console.log(`(zoning card found after ${tried} tap(s))\n` + cardText.split("\n").map((l) => "   " + l).join("\n"));
  check("B · a canvas click opens a card that includes the Sugar Land zoning card", /Zoning · Sugar Land/.test(cardText), "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-canvas-click-card.png` });

  /* ── C. Town Square: the case / incentive / project layers have features ─────────────────── */
  log = [];
  panel = await openPanel(tsPlan.id);
  for (const id of ["sl_tirz", "sl_available_sites", "sl_dev_projects", "sl_zoning_cases"]) await turnOn(panel, "jur", id);
  await turnOn(panel, "access", "sl_thoroughfare");
  await turnOn(panel, "util", "fire_hydrants");
  await page.getByTestId("layers-collapse").click().catch(() => {});
  // the throwaway plan frames a small area (its parcel is small); the nearest tracked development project is ~600 m from Town Square, so zoom out three notches (each layer is re-asked for the larger view)
  const cbox = await page.getByTestId("planner-canvas").boundingBox();
  for (let i = 0; i < 3; i++) { await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2); await page.mouse.wheel(0, 400); await sleep(700); }
  await sleep(14000);
  const L2 = await layers(); const F2 = (L2 && L2.features) || {};
  console.log("Town Square painted features:", JSON.stringify(Object.fromEntries(Object.entries(F2).filter(([k]) => k.startsWith("sl_")))));
  const C_IDS = ["sl_tirz", "sl_available_sites", "sl_dev_projects", "sl_zoning_cup", "sl_zoning_exception", "sl_zoning_variance", "sl_thoroughfare", "sl_hydrants"];
  for (const id of C_IDS) check(`C · ${id}: painted ≥ 1 feature at Town Square`, (F2[id] || 0) >= 1, String(F2[id]));
  for (const id of C_IDS) {
    const c = await identify(id, AT[id]);
    console.log(`card ${id}:`, JSON.stringify(c && { title: c.title, rows: (c.rows || []).map((r) => `${r.label}: ${r.text}`) }));
    check(`C · ${id}: a click card opens at a known feature, with a title${id === "sl_hydrants" ? "" : " and at least one value"}`, !!(c && c.title && (id === "sl_hydrants" || (c.rows || []).length >= 1)), c ? `${c.title} · ${(c.rows || []).length} rows` : "no card");
    if (id === "sl_thoroughfare" && c) {
      const t = JSON.stringify(c);
      const cur = (c.rows || []).find((r) => r.label === "Current section"), rec = (c.rows || []).find((r) => r.label === "Plan's recommended section");
      check("C · section-code card: the legend's classification on a legend code (Brooks St C4U → Major Collector), and a code not on the legend (CSD) shown bare", !!cur && cur.text === "C4U · Major Collector" && !!rec && rec.text === "CSD", JSON.stringify([cur, rec]));
      check("C · thoroughfare card: a class and a section code, and no width / right-of-way", (c.rows || []).some((r) => r.label === "Class") && (c.rows || []).some((r) => /section/i.test(r.label)) && !/width|right-of-way/i.test(t), t.slice(0, 200));
    }
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/C-town-square.png` });

  /* ── C2. AZ-02 and ANID cards (B2638209) — a throwaway plan at a point inside each ─────────────── */
  for (const [key, pt, id] of [["az02", AZ02, "az02"], ["anid", ANID, "anid"]]) {
    const pl = mk(`${LIVE_PREFIX}sugarland-${id}-${Date.now().toString(36)}`, pt, key.toUpperCase());
    await insert(pl);
    const pn = await openPanel(pl.id);
    await turnOn(pn, "jur", "sl_airport_zoning");
    await sleep(9000);
    const c = await identify("sl_airport_zoning", pt);
    console.log(`card ${key}:`, JSON.stringify(c));
    if (key === "az02") {
      check("C · AZ-02 card: warehouse & distribution NOT permitted (Sec. 9-17, Table 9-17.1), first row", !!c && /AZ-02/.test(c.title) && c.rows[0] && c.rows[0].label === "Warehouse & distribution" && /Not permitted here \(Sec\. 9-17, Table 9-17\.1\)/.test(c.rows[0].text), JSON.stringify(c && c.rows[0]));
      check("C · AZ-02 card: manufacturing and wholesale not permitted; no full permitted list; no height", !!c && /Light and heavy manufacturing and wholesale/.test(JSON.stringify(c)) && /Table 9-17\.1 has the full schedule/.test(JSON.stringify(c)) && !/height limit|\b\d+\s*(ft|feet)/i.test(JSON.stringify(c)), "");
    } else {
      check("C · ANID card: Airport Noise Impact District (Sec. 9-15), no land use restrictions, consider the noise, Sec. 9-16 plat statement", !!c && /ANID/.test(c.title) && /Airport Noise Impact District \(Sec\. 9-15\)/.test(JSON.stringify(c)) && /No land use restrictions are imposed/.test(JSON.stringify(c)) && /Sec\. 9-16 requires a statement on the plat/.test(JSON.stringify(c)), "");
    }
  }

  /* ── D. Houston offers none of it ─────────────────────────────────────────────────────────── */
  log = [];
  const panelTx = await openPanel(txPlan.id);
  const accessTx = await rowsIn(panelTx, "access"), jurTx = await rowsIn(panelTx, "jur"), utilTx = await rowsIn(panelTx, "util");
  console.log("Houston · Jurisdictions rows:", jurTx.join(", ")); console.log("Houston · Utilities rows:", utilTx.join(", "));
  check("D · KNOWN-GOOD arm: Houston lists the Texas rows (so an empty answer is not an empty registry)", utilTx.includes("water_sewer") && jurTx.includes("counties_cities"), `${utilTx.length} util, ${jurTx.length} jur`);
  const SL_IDS = ["sl_thoroughfare", "sl_capital_projects", "sl_zoning", "sl_airport_zoning", "sl_flu", "sl_zoning_cases", "sl_public_land", "sl_tirz", "sl_available_sites", "sl_dev_projects", "sl_hydrants", "sl_zoning_cup"];
  const leaked = SL_IDS.filter((id) => accessTx.includes(id) || jurTx.includes(id) || utilTx.includes(id));
  check("D · Houston offers none of the Sugar Land rows", leaked.length === 0, leaked.join(", "));
  const hnote = await page.getByTestId("layer-group-note").count();
  check("D · Houston's Utilities group carries no Sugar Land note", hnote === 0, String(hnote));
  await sleep(3000);
  check("D · the Houston plan issues ZERO requests to the city's server or its org", sent().length === 0, `${sent().length} sent: ${sent().slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
} finally {
  for (const id of LOCAL ? [] : cleanupIds) {
    const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
    check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
  }
  await s.close();
}
if (voided) console.log(`VOID — ${voided} precondition(s) failed; the run proves nothing`);
console.log(failed ? `FAIL (${failed})` : voided ? "VOID" : "PASS");
process.exit(failed ? 1 : voided ? 2 : 0);
