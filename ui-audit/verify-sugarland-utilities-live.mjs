/* verify-sugarland-utilities-live — City of Sugar Land WATER and SEWER network (NEW-1, 2026-11-06), LIVE on planyr.io (or a preview), signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-sugarland-utilities-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>] [--local]
 *
 * It proves, against the DEPLOYED build (read from /version.json in the same call as the assertions):
 *   A. A throwaway LOCATED plan at the Harmon lift station (29.62955, −95.63495 — inside the city, a dense part of the network) lists the five new Utilities rows WITH the date tag
 *      ("Water Lines · as of 2017", "Sewer Lines · as of 2017", "Water Valves · …", "Manholes & Cleanouts · …", "Plants & Lift Stations · …"), the Utilities note says the data is dated through
 *      Jan 2017 and still links the city's Utility Map Request form, and NOTHING is requested from CDM Smith's service before a row is on.
 *   B. With the rows on, the service ANSWERS (water layer 17, gravity 20, force 18, valves 2, manholes 13, lift stations 23, …), the layers PAINT what they were sent
 *      (window.__plannerLayers().features — a `fields` list that omits the service's own object-id field collapses a layer to ONE feature, which no unit test can see), a click card
 *      opens at a point ON a known feature with real values AND the data date + the layer's own edit date + the source, the row's (i) carries the same, and the opacity starts at 100%.
 *   C. A second plan at a production well: the plants / wells row paints and its card opens.
 *   D. NOTHING LEAKS — a throwaway plan in Houston (known-good arm: it lists Texas rows) offers none of the new rows and issues ZERO requests to CDM Smith's service.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). `--local` is the signed-out PR-preview variant (plans seeded into the
 * browser's own store, nothing touches the cloud). */
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
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const HOSTS = /VVapzOPgBae5joyC/;
const HARMON = { lat: 29.62955, lng: -95.63495 };
const WELL = { lat: 29.62782, lng: -95.61653 };
const HOUSTON = { lat: 29.80, lng: -95.54 };
const NEW_ROWS = ["sl_water_lines", "sl_sewer_lines", "sl_valves", "sl_sewer_structures", "sl_plants"];
const TAGGED = { sl_water_lines: "Water Lines · as of 2017", sl_sewer_lines: "Sewer Lines · as of 2017", sl_valves: "Water Valves · as of 2017", sl_sewer_structures: "Manholes & Cleanouts · as of 2017", sl_plants: "Plants & Lift Stations · as of 2017" };

const LOCAL = args.includes("--local");
const TAG = Math.random().toString(36).slice(2, 7);
const localPlan = (key, p, label) => ({
  schemaVersion: 12, id: `zz-slu-${key}-${TAG}`, groupId: `zz-slu-${key}-${TAG}`, site: `ZZ Live Check — ${label}`, name: "Plan 1",
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
  LOCAL_PLANS.harmon = localPlan("harmon", HARMON, "Harmon lift station"); LOCAL_PLANS.well = localPlan("well", WELL, "Production well"); LOCAL_PLANS.hou = localPlan("hou", HOUSTON, "Houston");
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(Object.fromEntries(Object.values(LOCAL_PLANS).map((pl) => [pl.id, pl]))));
  s = { proof: { email: "(signed out — local plans)" }, close: () => browser.close() };
} else {
  for (let attempt = 1; attempt <= 6 && !s; attempt++) {
    try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
    catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
  }
  page = s.page;
}
await assertMeasurable(page, "verify-sugarland-utilities-live");
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
const ans = (re) => answered(re).filter((e) => e.status === 200).reduce((n, e) => n + (e.features || 0), 0);
const asked = (re) => answered(re).some((e) => e.status === 200);

const mk = (key, p, label) => (LOCAL ? LOCAL_PLANS[key] : { ...throwawayPlan(`${LIVE_PREFIX}slu-${key}-${Date.now().toString(36)}`), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}` });
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
  await sleep(1200);
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
const layers = () => page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers() : null)).then((h) => h && { on: h.on, live: h.live, features: h.features, opacities: h.opacities });
const identify = (id, at) => page.evaluate(([i, a]) => { const h = window.__plannerLayers && window.__plannerLayers(); const c = h && h.identify ? h.identify(i, a) : null; return c ? { title: c.title, rows: (c.rows || []).map((r) => ({ label: r.label, text: r.text, href: r.href })) } : null; }, [id, at]);
const rowText = (c, label) => ((c && c.rows) || []).find((r) => r.label === label)?.text;

/* Points ON known features (vertices of real features near the Harmon lift station, read from the service 2026-11-06). */
const AT = {
  sl_water_lines: { lat: 29.629612, lng: -95.635448 },        // 8-in PVC water main, 1988, City of Sugar Land
  sl_sewer_gravity: { lat: 29.629633, lng: -95.634826 },      // gravity main, 1979 (its NominalDia reads -1: no size is printed)
  sl_sewer_force: { lat: 29.629633, lng: -95.634826 },        // force main, 1-in PVC, 1975
  sl_manholes: { lat: 29.629607, lng: -95.634786 },           // SS.MH.A000009716, 1979
  sl_water_valves: { lat: 29.629932, lng: -95.634514 },       // 24-in system valve, 2012
  sl_water_control_valves: { lat: 29.62993, lng: -95.634202 },// 2-in control valve
  sl_lift_stations: { lat: 29.629554, lng: -95.634951 },      // Harmon Lift Station
  sl_water_wells: { lat: 29.62782, lng: -95.61653 },          // first production well
};

try {
  const harmon = mk("harmon", HARMON, "Harmon lift station"), well = mk("well", WELL, "Production well"), hou = mk("hou", HOUSTON, "Houston");
  await insert(harmon); await insert(well); await insert(hou);

  /* ── A. Harmon: the rows are listed, dated, and quiet until switched on ─────────────────────── */
  log = [];
  let panel = await openPanel(harmon.id);
  const util = await rowsIn(panel, "util");
  console.log("Harmon · Utilities rows:", util.join(", "));
  for (const id of NEW_ROWS) {
    check(`A · Utilities offers "${id}"`, util.includes(id));
    const label = await panel.locator(`[data-testid="layer-row-${id}"]`).first().innerText().catch(() => "");
    check(`A · and the row label carries the date: "${TAGGED[id]}"`, label.includes(TAGGED[id]), label.replace(/\n/g, " ").slice(0, 80));
  }
  check("A · the existing Fire Hydrants row is still there", util.includes("fire_hydrants"));
  const note = await page.getByTestId("layer-group-note").first().innerText().catch(() => "");
  check("A · the Utilities note says the data is dated through Jan 2017", /dated through Jan 2017/.test(note), note.replace(/\n/g, " "));
  check("A · and no longer says the city publishes none", !/does not publish/.test(note));
  const href = await page.getByTestId("layer-group-note").locator("a").first().getAttribute("href").catch(() => null);
  check("A · and still links the city's Utility Map Request form", href === "https://survey123.arcgis.com/share/a9755767526546b5a9509d1648399862", String(href));
  check("A · nothing is requested from CDM Smith's service before a row is switched on", sent().length === 0, `${sent().length} sent`);

  /* ── B. Harmon: rows on — answers, paint, cards, (i) ────────────────────────────────────────── */
  for (const id of NEW_ROWS) await turnOn(panel, "util", id);
  await sleep(15000);
  const L = await layers(); const F = (L && L.features) || {};
  console.log("painted features:", JSON.stringify(Object.fromEntries(Object.entries(F).filter(([k]) => k.startsWith("sl_")))));
  for (const [layer, nm] of [[17, "water mains"], [20, "gravity mains"], [18, "force mains"], [2, "water valves"], [13, "manholes"], [23, "lift stations"]]) {
    const re = new RegExp(`CityofSugarLand/FeatureServer/${layer}/query`);
    check(`B · ${nm} (layer ${layer}) answered 200 with features`, ans(re) > 0, String(ans(re)));
  }
  for (const layer of [19, 16, 9, 22, 21, 4]) check(`B · layer ${layer} was asked and answered 200`, asked(new RegExp(`CityofSugarLand/FeatureServer/${layer}/query`)));
  const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
  check("B · no request to CDM Smith's service failed", bad.length === 0, bad.slice(0, 3).map((e) => `${e.status} ${e.url.slice(-90)}`).join(" | "));
  for (const id of ["sl_water_lines", "sl_sewer_gravity", "sl_water_valves", "sl_manholes"]) check(`B · ${id}: painted ≥ 2 features (the layer is not collapsed to one)`, (F[id] || 0) >= 2, String(F[id]));
  for (const id of ["sl_sewer_force", "sl_lift_stations"]) check(`B · ${id}: painted ≥ 1 feature`, (F[id] || 0) >= 1, String(F[id]));
  /* opacity is read from the row's OWN control (`__plannerLayers().opacities` lists raster opacities only — it is [] for a vector layer, so it cannot answer this) */
  await panel.getByTestId("layer-group-util").click(); await sleep(250);
  for (const id of ["sl_water_lines", "sl_sewer_lines", "sl_valves", "sl_sewer_structures", "sl_plants"]) {
    await panel.getByTestId(`layer-caret-${id}`).click(); await sleep(400);
    const pct = await panel.locator(`[data-testid="layer-row-${id}-menu"] [data-part="opacity"] input[type="text"]`).first().inputValue().catch(() => null);
    check(`B · ${id}: opacity starts at 100%`, pct === "100", String(pct));
    await panel.getByTestId(`layer-caret-${id}`).click().catch(() => {}); await sleep(200);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-harmon-all-rows.png` });

  const card = {};
  for (const id of Object.keys(AT).filter((k) => k !== "sl_water_wells")) {
    card[id] = await identify(id, AT[id]);
    console.log(`card ${id}:`, JSON.stringify(card[id] && { title: card[id].title, rows: card[id].rows.map((r) => `${r.label}: ${r.text}`) }));
    check(`B · ${id}: a click card opens ON a known feature`, !!(card[id] && card[id].title), card[id] ? card[id].title : "no card");
  }
  const w = card.sl_water_lines;
  check("B · water main card: 8 in · PVC · Drinking water · Installed 1988 · City of Sugar Land", rowText(w, "Size") === "8 in" && rowText(w, "Material") === "PVC" && rowText(w, "Carries") === "Drinking water" && rowText(w, "Installed") === "1988" && rowText(w, "Operated by") === "City of Sugar Land", JSON.stringify(w && w.rows));
  check("B · water main card carries the data date AND the layer's own edit date AND the source", rowText(w, "Data as of") === "Jan 2017 · layer last edited Nov 20, 2025" && rowText(w, "Source") === "CDM Smith for the City of Sugar Land", `${rowText(w, "Data as of")} | ${rowText(w, "Source")}`);
  const g = card.sl_sewer_gravity;
  check("B · gravity main card: titled as sewer, Installed 1979, NO size (the layer reads -1 there), edit date Dec 23, 2025", /Gravity sewer main/.test(g && g.title) && rowText(g, "Installed") === "1979" && rowText(g, "Size") === undefined && /Dec 23, 2025/.test(rowText(g, "Data as of")), JSON.stringify(g && g.rows));
  const f = card.sl_sewer_force;
  check("B · force main card: titled as a pressure sewer line, 1 in, Installed 1975", /force main/i.test(f && f.title) && rowText(f, "Size") === "1 in" && rowText(f, "Installed") === "1975", JSON.stringify(f && f.rows));
  check("B · manhole card: asset id and Installed 1979", rowText(card.sl_manholes, "ID") === "SS.MH.A000009716" && rowText(card.sl_manholes, "Installed") === "1979", JSON.stringify(card.sl_manholes && card.sl_manholes.rows));
  check("B · water valve card: 24 in, Installed 2012", rowText(card.sl_water_valves, "Size") === "24 in" && rowText(card.sl_water_valves, "Installed") === "2012", JSON.stringify(card.sl_water_valves && card.sl_water_valves.rows));
  check("B · control valve card: 2 in", rowText(card.sl_water_control_valves, "Size") === "2 in");
  check("B · lift station card is named Harmon Lift Station", /Harmon Lift Station/.test(card.sl_lift_stations && card.sl_lift_stations.title), card.sl_lift_stations && card.sl_lift_stations.title);
  check("B · no card prints a raw field name, an editor name or an email", !/Subtype|Elevation|InstallDat|LifecycleS|created_us|last_edite|@/.test(JSON.stringify(card)));

  /* the (i): the date, the source and the caution, behind the row's ▾ */
  for (const id of ["sl_water_lines", "sl_sewer_lines"]) {
    await panel.getByTestId("layer-group-util").click(); await sleep(250);
    await panel.getByTestId(`layer-caret-${id}`).click(); await sleep(500);
    await panel.locator(`[data-testid="layer-row-${id}-menu"] [data-part="info"] button`).first().click(); await sleep(400);
    const info = await panel.locator(`[data-testid="layer-row-${id}-menu"] [data-testid="layer-info-text"]`).first().innerText().catch(() => "");
    console.log(`(i) ${id}:\n` + info.split("\n").map((l) => "   " + l).join("\n"));
    check(`B · the (i) of ${id} names the publisher and the Jan 2017 content date`, /CDM Smith for the City of Sugar Land/.test(info) && /Jan 2017/.test(info), "");
    check(`B · and the layer's own edit date`, /Nov 20, 2025|Dec 23, 2025|Nov 10, 2021/.test(info), "");
    check(`B · and says mains built since are not shown / confirm with the city and an 811 locate`, /built since are not shown/.test(info) && /811/.test(info), "");
    await panel.getByTestId(`layer-caret-${id}`).click().catch(() => {});
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-info.png` });

  /* ── C. Production well: the plants row paints and answers ──────────────────────────────────── */
  log = [];
  panel = await openPanel(well.id);
  await turnOn(panel, "util", "sl_plants");
  await sleep(12000);
  const L2 = await layers(); const F2 = (L2 && L2.features) || {};
  console.log("well-plan painted features:", JSON.stringify(Object.fromEntries(Object.entries(F2).filter(([k]) => k.startsWith("sl_")))));
  for (const layer of [4, 21, 22, 23]) check(`C · plants row member layer ${layer} was asked and answered 200`, asked(new RegExp(`CityofSugarLand/FeatureServer/${layer}/query`)));
  check("C · water wells painted ≥ 1 feature", (F2.sl_water_wells || 0) >= 1, String(F2.sl_water_wells));
  const wc = await identify("sl_water_wells", AT.sl_water_wells);
  console.log("card well:", JSON.stringify(wc));
  check("C · the well card opens with the date row", !!(wc && wc.title) && rowText(wc, "Data as of") === "Jan 2017 · layer last edited Nov 10, 2021", JSON.stringify(wc && wc.rows));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/C-well.png` });

  /* ── D. Houston offers none of it ───────────────────────────────────────────────────────────── */
  log = [];
  const panelTx = await openPanel(hou.id);
  const utilTx = await rowsIn(panelTx, "util"), jurTx = await rowsIn(panelTx, "jur");
  console.log("Houston · Utilities rows:", utilTx.join(", "));
  check("D · KNOWN-GOOD arm: Houston lists the Texas rows (so an empty answer is not an empty registry)", utilTx.includes("water_sewer") && jurTx.includes("counties_cities"), `${utilTx.length} util, ${jurTx.length} jur`);
  const leaked = [...NEW_ROWS, "sl_water_valves", "sl_water_control_valves", "sl_manholes", "sl_cleanouts", "sl_lift_stations", "sl_wwtp", "sl_water_plants", "sl_water_wells", "sl_sewer_gravity", "sl_sewer_laterals", "sl_sewer_force"].filter((id) => utilTx.includes(id));
  check("D · Houston offers none of the Sugar Land water / sewer rows", leaked.length === 0, leaked.join(", "));
  await sleep(3000);
  check("D · the Houston plan issues ZERO requests to CDM Smith's service", sent().length === 0, `${sent().length} sent: ${sent().slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
} finally {
  for (const id of LOCAL ? [] : cleanupIds) {
    const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
    check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
  }
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
