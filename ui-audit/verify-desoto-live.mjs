/* verify-desoto-live — DeSoto County MS + Olive Branch (B2507056–B2507059), LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-desoto-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * It proves, against the DEPLOYED build (read from /version.json in the same call as the assertions):
 *   A. PARCELS — on the Map, Select parcels at a real Olive Branch lot: the app selects THE lot the county's own server holds at that point (ground truth asked
 *      separately from the page, through the same relay), its attributes carry owner, PIN and acreage, and the county server was actually asked.
 *   B. LAYERS — a throwaway LOCATED plan at Olive Branch lists the DeSoto / Olive Branch rows; with Zoning, Gas Lines, Water Mains and the four PSC service areas ON
 *      the county / city servers answer WITH FEATURES; a click returns "Who serves this site" with the four providers by name, and the zoning card names the
 *      jurisdiction ("Olive Branch") with a case / ordinance row.
 *   C. NOTHING LEAKS — a throwaway plan at Houston (known-good arm: it lists Texas rows) offers none of the DeSoto rows and issues ZERO requests to the county
 *      server or the Olive Branch org; so does a Map click on a Houston lot.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). */
import { writeFileSync, mkdirSync } from "node:fs";
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

const HOSTS = /desotocountyms\.gov|VGtdH6iTQlVulSnr/;
const OB = { lat: 34.96147632, lng: -89.8298842, name: "Olive Branch (Giant Oil lot, PIN 106834002 0003800)" };
const HOUSTON = { lat: 29.80, lng: -95.54 }; // west Houston (HCAD lots; the Memphis line-band harness's control)

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-desoto-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
/* Network log: every request to the county server / Olive Branch org, with its status and (for /query) the feature count. */
let log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!HOSTS.test(u) && !/\/gis-proxy\/gis\.desotocountyms/.test(u)) return;
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : null; } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { const u = r.url(); if (HOSTS.test(u) || /\/gis-proxy\/gis\.desotocountyms/.test(u)) log.push({ url: u, status: "sent", features: null, req: true }); });
const hit = (re) => log.filter((e) => !e.req && re.test(e.url));
const sent = (re) => log.filter((e) => e.req && re.test(e.url));

/* ── A. Parcels on the Map ───────────────────────────────────────────────────────────────────── */
async function parcelsOnMap(pt, expectDeSoto) {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 45000 });
  await sleep(1200);
  log = [];
  await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [pt.lat, pt.lng]);
  await sleep(900);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await sleep(1500);
  const c = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [pt.lat, pt.lng]);
  await page.mouse.click(c.x, c.y);
  let held = [];
  for (let i = 0; i < 60 && !held.length; i++) { await sleep(500); held = await page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : [])).catch(() => []); }
  await sleep(800);
  // the card is one line ("1 parcel · 0.86 AC") until "Record info" is opened — open it so the owner / PIN text is on the page
  const rec = page.getByRole("button", { name: /Record info/i }).first();
  if (await rec.count()) { await rec.click().catch(() => {}); await sleep(900); }
  return { held, text: await page.evaluate(() => document.body.innerText) };
}
async function truth(pt) {
  return page.evaluate(async ([lat, lng]) => {
    const q = new URLSearchParams({ geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "PIN,OWNER_NAME,ACREAGE", returnGeometry: "false", f: "json" });
    try { const j = await (await fetch("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/BaseLayers/MapServer/1/query?" + q)).json(); return (j.features || []).map((f) => f.attributes); } catch (e) { return null; }
  }, [pt.lat, pt.lng]);
}

const cleanupIds = [];
try {
  const t = await truth(OB);
  if (!t || !t.length) { console.log("VOID: the county server gave no ground truth for the Olive Branch lot"); voided++; }
  else console.log("ground truth @", OB.name, "→", JSON.stringify(t[0]));
  const a = await parcelsOnMap(OB, true);
  const attrs = a.held.length ? a.held[a.held.length - 1].attrs : null;
  check("A · Map click at the Olive Branch lot selects a lot", !!attrs, a.held.length ? "" : (a.text.match(/No parcel right there|isn't responding|Couldn't reach/i) || ["nothing selected"])[0]);
  if (attrs && t && t.length) {
    const pin = (k) => String(attrs[k] ?? "").replace(/\s+/g, " ").trim();
    check("A · it is THE lot the county server holds there (PIN matches ground truth)", pin("PIN") === String(t[0].PIN).replace(/\s+/g, " ").trim(), `${pin("PIN")} vs ${t[0].PIN}`);
    check("A · the record carries the owner", /GIANT OIL/i.test(pin("OWNER_NAME")), pin("OWNER_NAME"));
    check("A · the record carries the acreage", Number(attrs.ACREAGE) > 0.8 && Number(attrs.ACREAGE) < 0.9, String(attrs.ACREAGE));
  }
  check("A · the county server was asked and answered with a parcel", hit(/BaseLayers\/MapServer\/1\/query/).some((e) => e.status === 200 && e.features > 0), JSON.stringify(hit(/BaseLayers\/MapServer\/1/).map((e) => [e.status, e.features])));
  check("A · the map labels the chosen lot's acreage and its neighbours by the county's own PINs", /0\.86 AC/.test(a.text) && /106834002\s+00\d{5}/.test(a.text), "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-olive-branch-parcel.png` });

  /* A2. the same lot by ADDRESS: the card under the search field carries owner, PIN, acreage and the county's own links (as labelled rows). */
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('input[placeholder^="Type an address"]'), null, { timeout: 45000 });
  const inp = page.locator('input[placeholder^="Type an address"]').first();
  await inp.fill("6973 Highway 305, Olive Branch, MS");
  await sleep(600);
  await inp.press("Enter");
  let ctext = "";
  for (let i = 0; i < 50; i++) { await sleep(1000); ctext = await page.evaluate(() => document.body.innerText); if (/GIANT OIL/i.test(ctext)) break; }
  const more = page.getByText(/More details/i).first();
  if (await more.count()) { await more.click().catch(() => {}); await sleep(1200); ctext = await page.evaluate(() => document.body.innerText); }
  console.log("address card text (excerpt):", (ctext.match(/[^\n]*GIANT OIL[^\n]*(\n[^\n]*){0,14}/i) || ["(none)"])[0].replace(/\n/g, " | ").slice(0, 400));
  check("A · address search: the card shows the owner (GIANT OIL CO)", /GIANT OIL/i.test(ctext), "");
  check("A · address search: the card shows the PIN and acreage", /106834002\s+0003800/.test(ctext) && /0\.8\d/.test(ctext), "");
  check("A · address search: the county's own links appear as labelled rows (Warranty deed / Tax info / Tax map / FEMA map)", /Warranty deed/i.test(ctext) && /Tax (info|map)/i.test(ctext), "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/A2-address-card.png` });

  // the control click must land on a real HCAD lot: try the west-Houston point and a few nudges (a click can land on a road)
  let h = { held: [] };
  for (const [dy, dx] of [[0, 0], [0.0015, 0.0015], [-0.0015, -0.0015], [0.003, -0.002], [-0.003, 0.002]]) {
    h = await parcelsOnMap({ lat: HOUSTON.lat + dy, lng: HOUSTON.lng + dx }, false);
    if (h.held.length) break;
  }
  check("A · KNOWN-GOOD arm: a Houston lot IS selected by the same flow", h.held.length > 0, h.held.length ? "" : "nothing selected — the flow itself is broken, run VOID");
  if (!h.held.length) voided++;
  check("C · Map click in Houston issues ZERO requests to the county server or the Olive Branch org", sent(HOSTS).length === 0, `${sent(HOSTS).length} sent`);

  /* ── B. layers on a located plan at Olive Branch ───────────────────────────────────────────── */
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
  const obPlan = mk(`${LIVE_PREFIX}desoto-ob-${Date.now().toString(36)}`, OB, "Olive Branch"), txPlan = mk(`${LIVE_PREFIX}desoto-tx-${Date.now().toString(36)}`, HOUSTON, "Houston");
  await insert(obPlan); await insert(txPlan);
  const openPanel = async (id) => {
    await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    await sleep(2500);
    const chip = page.getByTestId("layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
    await panel.waitFor({ state: "visible", timeout: 20000 });
    await sleep(900); // service-area geometry arrives by a dynamic import
    return panel;
  };
  const rowsIn = async (panel, group) => {
    const btn = panel.getByTestId(`layer-group-${group}`);
    if (await btn.count()) await btn.click(); else await panel.getByTestId("layer-group-select").selectOption(group);
    await sleep(250);
    return panel.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")));
  };

  log = [];
  const panel = await openPanel(obPlan.id);
  const util = await rowsIn(panel, "util"), jur = await rowsIn(panel, "jur");
  console.log("Olive Branch · Utilities rows:", util.join(", "));
  console.log("Olive Branch · Jurisdictions rows:", jur.join(", "));
  for (const id of ["ms_ob_gas_main", "ms_ob_water_service", "ms_ob_sewer_service", "ms_psc_gas", "water_sewer", "electric", "fire_hydrants"]) check(`B · Utilities offers "${id}" at Olive Branch`, util.includes(id));
  for (const id of ["ms_desoto_zoning", "counties_cities", "ms_desoto_flu", "ms_desoto_thoroughfare", "ms_desoto_future_subd", "ms_ob_planning_area"]) check(`B · Jurisdictions offers "${id}" at Olive Branch`, jur.includes(id));
  // the header chip's city / county lookup (BaseLayers 4 and 8) is a site-identify, not a layer: allowed. Nothing else may be asked before a layer is on.
  const early = sent(HOSTS).filter((e) => !/BaseLayers\/MapServer\/(4|8)\/query/.test(e.url));
  console.log("requests before any layer is on:", sent(HOSTS).map((e) => e.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 110)).join(" | "));
  check("B · nothing but the header chip's city/county lookup is requested before a layer is switched on", early.length === 0, `${early.length} other`);

  const turnOn = async (group, id) => {
    await panel.getByTestId(`layer-group-${group}`).click(); await sleep(250);
    const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    if (!(await cb.count())) { check(`B · row "${id}" has a checkbox to switch on`, false, "row not in this group"); return; }
    if (!(await cb.isChecked())) await cb.check();
  };
  for (const id of ["ms_ob_gas_main", "ms_psc_gas", "water_sewer", "electric"]) await turnOn("util", id);
  for (const id of ["ms_desoto_zoning", "counties_cities"]) await turnOn("jur", id);
  await sleep(9000);
  const feats = (re) => hit(re).filter((e) => e.status === 200).reduce((n, e) => n + (e.features || 0), 0);
  check("B · Zoning: the county server answered with zoning polygons", feats(/Zoning\/MapServer\/20\/query/) > 0, `${feats(/Zoning\/MapServer\/20\/query/)} features`);
  check("B · City Limits: the county server answered", feats(/BaseLayers\/MapServer\/4\/query/) > 0, `${feats(/BaseLayers\/MapServer\/4\/query/)}`);
  check("B · PSC gas service areas answered", feats(/County_Web_Map\/MapServer\/70\/query/) > 0, `${feats(/County_Web_Map\/MapServer\/70\/query/)}`);
  check("B · PSC water service areas answered (Water & Sewer row)", feats(/County_Web_Map\/MapServer\/71\/query/) > 0, `${feats(/County_Web_Map\/MapServer\/71\/query/)}`);
  check("B · PSC electric service areas answered (Electric row)", feats(/County_Web_Map\/MapServer\/69\/query/) > 0, `${feats(/County_Web_Map\/MapServer\/69\/query/)}`);
  check("B · Olive Branch gas lines answered with features", feats(/GAS_UTILITIES_\(VIEWER\)\/FeatureServer\/5\/query/) > 0 || feats(/GAS_UTILITIES_%28VIEWER%29\/FeatureServer\/5\/query/) > 0, "");
  check("B · Olive Branch water mains answered with features", feats(/WATER_UTILITIES_(\(|%28)VIEWER(\)|%29)\/FeatureServer\/6\/query/) > 0, "");
  const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
  check("B · no request to the county server or the city's org failed", bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-80)}`).join(" | "));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-olive-branch-layers.png` });

  // click the canvas centre (the plan origin = the Olive Branch point): one card, four providers, and the zoning card names the jurisdiction
  const canvas = page.getByTestId("planner-canvas");
  const box = await canvas.boundingBox();
  // a tap on EMPTY canvas beside the throwaway parcel (a tap on a parcel selects it, it does not identify); try several empty points so one road-gap in the zoning data cannot decide it
  let card = "", tried = 0;
  for (const [dx, dy] of [[260, 40], [-300, 60], [280, 200], [-280, 200], [320, -60], [0, 230], [-120, -150]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await sleep(2500);
    card = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
    tried++;
    if (/Zoning/.test(card)) break;
  }
  console.log(`(zoning card found after ${tried} tap(s))`);
  console.log("identify card:\n" + card.split("\n").map((l) => "   " + l).join("\n"));
  check('B · the click card says "Who serves this site" once', (card.match(/Who serves this site/g) || []).length === 1);
  check("B · it names the water, sewer, gas and electric providers", /Water/.test(card) && /Sewer/.test(card) && /Gas/.test(card) && /Electric/.test(card) && /Olive Branch/.test(card) && /Northcentral|Entergy/.test(card), "");
  check("B · the zoning card names the jurisdiction the site falls in", /Zoning · Olive Branch/.test(card) || /Jurisdiction:\s*Olive Branch/.test(card), "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-identify-card.png` });

  /* ── C. Houston plan offers none of it ─────────────────────────────────────────────────────── */
  log = [];
  const panelTx = await openPanel(txPlan.id);
  const utilTx = await rowsIn(panelTx, "util"), jurTx = await rowsIn(panelTx, "jur");
  console.log("Houston · Utilities rows:", utilTx.join(", "));
  console.log("Houston · Jurisdictions rows:", jurTx.join(", "));
  check("C · KNOWN-GOOD arm: Houston lists the Texas rows (so an empty answer is not an empty registry)", utilTx.includes("water_sewer") && jurTx.includes("counties_cities"), `${utilTx.length} util, ${jurTx.length} jur`);
  const DESOTO_IDS = ["ms_ob_gas_main", "ms_ob_water_service", "ms_ob_sewer_service", "ms_psc_gas", "ms_desoto_zoning", "ms_desoto_flu", "ms_desoto_thoroughfare", "ms_desoto_future_subd", "ms_ob_planning_area", "ms_desoto_city"];
  const leaked = DESOTO_IDS.filter((id) => utilTx.includes(id) || jurTx.includes(id));
  check("C · Houston offers none of the DeSoto / Olive Branch rows", leaked.length === 0, leaked.join(", "));
  await sleep(3000);
  check("C · Houston plan issues ZERO requests to the county server or the Olive Branch org", sent(HOSTS).length === 0, `${sent(HOSTS).length} sent: ${sent(HOSTS).slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
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
