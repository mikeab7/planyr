/* verify-fortbend-live — Fort Bend County layers (NEW-1, 2026-11-12) and the dead contour row (NEW-2), LIVE on planyr.io (or a preview), signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-fortbend-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>] [--local]
 *
 * Against the DEPLOYED build (read from /version.json in the same call as the assertions):
 *   A. The county's public server is reachable FROM THE PAGE (a real cross-origin read from planyr.io — the CORS claim in sourcesFortBend.js), and the owner's negative case holds:
 *      the Fulshear cluster point (-95.90, 29.69) is in no Levee Improvement District.
 *   B. For each row, a throwaway LOCATED plan on a vertex of a real feature lists the row in its group (Flood & Drainage / Jurisdictions / Access), the row switched on is ASKED and ANSWERED
 *      by the county's server, PAINTS the features it was sent (window.__plannerLayers().features — esri-leaflet drops features if a `fields` list omits the object-id field), and its click
 *      card carries real values with no raw field names or placeholders (the owner's named cases: (-95.62, 29.58) → "Fort Bend LID #2"; a Sienna point → a Sienna levee line; the
 *      Candela agreement on FM 359 / Fulshear Gaston Rd).
 *   C. NEW-2: the dead contour row is gone (no fb_contours / "1-Ft Contours (Fort Bend DD)" row in any group) and the page NEVER requests the dead host (arcgisweb.fortbendcountytx.gov).
 *   D. NOTHING LEAKS — a throwaway plan in Houston (known-good arm: it lists the Texas rows) offers none of the Fort Bend rows and issues ZERO requests to the county's server.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). `--local` is a SIGNED-OUT run for a local/PR preview. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha");
const SHOTS = flag("--shots");
const LOCAL = args.includes("--local");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const FB_HOST = /gisportal\.fortbendcountytx\.gov/;
const DEAD_HOST = /arcgisweb\.fortbendcountytx\.gov/;
const SVC = "https://gisportal.fortbendcountytx.gov/arcgis/rest/services";
const HOUSTON = { lat: 29.80, lng: -95.54 };

/* One case per row family: the plan sits ON a vertex of a real feature (found 2026-11-12 — the same points as the registry fixtures). */
const CASES = [
  { key: "lid", label: "Fort Bend LID #2", at: { lat: 29.58, lng: -95.62 }, group: "flood", row: "fb_lid", ids: ["fb_lid"], re: /Water_Districts_Public\/MapServer\/2\/query/,
    card: { id: "fb_lid", title: /Fort Bend LID #2/, labels: ["Operator", "Engineer", "TCEQ district ID"] } },
  { key: "levee", label: "Sienna levee", at: { lat: 29.4912, lng: -95.5408 }, group: "flood", row: "fb_levees", ids: ["fb_levees"], re: /Drainage_Public\/MapServer\/5\/query/,
    card: { id: "fb_levees", title: /Sienna Plantation/i, labels: ["Waterway", "FEMA accreditation"] } },
  { key: "brazos", label: "Brazos near Fulshear", at: { lat: 29.6325, lng: -95.8977 }, group: "flood", row: "fb_brazos_studies", ids: ["fb_brazos_inundation", "fb_brazos_floodplain"], re: /Drainage_Public\/MapServer\/(8|9)\/query/,
    card: { id: "fb_brazos_floodplain", title: /55-foot floodplain/, labels: ["Mapped in the study as", "What this is"], text: /not the effective FEMA map/ } },
  { key: "tirz", label: "C09 TIRZ 1", at: { lat: 29.5879, lng: -95.5314 }, group: "jur", row: "fb_tirz", ids: ["fb_tirz"], re: /Boundaries_Public\/MapServer\/11\/query/,
    card: { id: "fb_tirz", title: /TIRZ/, labels: ["County code"] } },
  { key: "mmd", label: "Sienna Plantation MMD", at: { lat: 29.5258, lng: -95.5385 }, group: "jur", row: "fb_mmd", ids: ["fb_mmd"], re: /Boundaries_Public\/MapServer\/13\/query/,
    card: { id: "fb_mmd", title: /Sienna Plantation Management District/, labels: ["TCEQ district ID"] } },
  { key: "dev", label: "Candela agreement (FM 359)", at: { lat: 29.6778, lng: -95.8272 }, group: "jur", row: "fb_dev_agreements", ids: ["fb_dev_agreements"], re: /Boundaries_Public\/MapServer\/9\/query/,
    card: { id: "fb_dev_agreements", title: /Candela/, labels: ["Affected road", "Developer", "Agreement type"], text: /FM 359 Rd/ } },
  { key: "mtp", label: "Proposed thoroughfare (Muegge Rd)", at: { lat: 29.5446, lng: -95.8696 }, group: "access", row: "fb_mtp_proposed", ids: ["fb_mtp_proposed"], re: /Transportation_Public\/MapServer\/4\/query/,
    card: { id: "fb_mtp_proposed", title: /Muegge|Proposed/i, labels: ["Plan status"], text: /Proposed — not built/ } },
];
const ALL_FB_ROWS = ["fb_lid", "fb_levees", "fb_brazos_studies", "fb_tirz", "fb_mmd", "fb_dev_agreements", "fb_mtp_proposed"];
const RAW = /\b(LID_NAME|TCEQ_ID|OPERATOR|ENGINEER_FIRM|LEVEE_NM|LEVEE_ID|LEVEE_STAT|PL84_99TF|WTR_NM|FLD_ZONE|ENTITYCODE|MMD_NAME|SUBDIVISION|AFFECTED_ROAD|FULL_NAME|OBJECTID|undefined|null|NaN|-8888|-9999)\b/;

const TAG = Math.random().toString(36).slice(2, 7);
const localPlan = (key, p, label) => ({
  schemaVersion: 12, id: `zz-fb-${key}-${TAG}`, groupId: `zz-fb-${key}-${TAG}`, site: `ZZ Live Check — ${label}`, name: "Plan 1",
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
  for (const c of CASES) LOCAL_PLANS[c.key] = localPlan(c.key, c.at, c.label);
  LOCAL_PLANS.hou = localPlan("hou", HOUSTON, "Houston");
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(Object.fromEntries(Object.values(LOCAL_PLANS).map((pl) => [pl.id, pl]))));
  s = { proof: { email: "(signed out — local plans)" }, close: () => browser.close() };
} else {
  for (let attempt = 1; attempt <= 6 && !s; attempt++) {
    try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
    catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
  }
  page = s.page;
}
await assertMeasurable(page, "verify-fortbend-live");
await page.setViewportSize({ width: 1500, height: 950 });
if (LOCAL) await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!FB_HOST.test(u)) return;
  const e = { url: u, status: res.status(), features: null };
  if (/\/query/.test(u)) { try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : (typeof j.count === "number" ? j.count : null); } catch (_) { /* not json */ } }
  log.push(e);
});
page.on("request", (r) => { const u = r.url(); if (FB_HOST.test(u) || DEAD_HOST.test(u)) log.push({ url: u, status: "sent", features: null, req: true }); });
const answered = (re) => log.filter((e) => !e.req && re.test(e.url) && /\/query/.test(e.url));
const sent = () => log.filter((e) => e.req);
let everDead = 0; page.on("request", (r) => { if (DEAD_HOST.test(r.url())) everDead++; });

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
const mk = (key, p, label) => (LOCAL ? LOCAL_PLANS[key] : { ...throwawayPlan(`${LIVE_PREFIX}fortbend-${key}-${Date.now().toString(36)}`), origin: { lat: p.lat, lon: p.lng }, site: `ZZ Live Check — ${label}` });
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
const identify = (id, at) => page.evaluate(([i, a]) => { const h = window.__plannerLayers && window.__plannerLayers(); const c = h && h.identify ? h.identify(i, a) : null; return c ? { title: c.title, rows: (c.rows || []).map((r) => ({ label: r.label, text: r.text, href: r.href })) } : null; }, [id, at]);

try {
  /* ── A. the county's server, from the page's own origin ─────────────────────────────────── */
  const probe = await page.evaluate(async (svc) => {
    const out = {};
    try {
      const r = await fetch(`${svc}/InteractiveMap/Water_Districts_Public/MapServer/2/query?where=1%3D1&returnCountOnly=true&f=json`);
      out.lidCount = (await r.json()).count;
      const q = new URLSearchParams({ f: "json", geometry: "-95.90,29.69", geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true" });
      out.fulshearLid = (await (await fetch(`${svc}/InteractiveMap/Water_Districts_Public/MapServer/2/query?${q}`)).json()).count;
      const q2 = new URLSearchParams({ f: "json", geometry: "-95.62,29.58", geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "LID_NAME", returnGeometry: "false" });
      out.lid2 = ((await (await fetch(`${svc}/InteractiveMap/Water_Districts_Public/MapServer/2/query?${q2}`)).json()).features || []).map((f) => f.attributes.LID_NAME);
      const fb = await (await fetch("https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0?f=json")).json();
      out.fbcadEdit = fb.editingInfo && fb.editingInfo.lastEditDate ? new Date(fb.editingInfo.lastEditDate).toISOString() : null;
    } catch (e) { out.error = String(e && e.message || e); }
    return out;
  }, SVC);
  console.log("A · page-origin probe:", JSON.stringify(probe));
  check("A · the county's server answers a cross-origin read from the page (CORS-open)", !probe.error && probe.lidCount > 0, probe.error || `${probe.lidCount} LIDs`);
  check("A · the Fulshear cluster point (-95.90, 29.69) is in NO Levee Improvement District (owner's negative fixture)", probe.fulshearLid === 0, String(probe.fulshearLid));
  check('A · (-95.62, 29.58) is "Fort Bend LID #2" (owner\'s named fixture)', Array.isArray(probe.lid2) && probe.lid2.includes("Fort Bend LID #2"), JSON.stringify(probe.lid2));
  console.log(`A · FBCAD hosted parcel layer lastEditDate (what the parcel-copy line reads at runtime): ${probe.fbcadEdit}`);

  /* ── B. one throwaway plan per row family ──────────────────────────────────────────────── */
  for (const c of CASES) {
    const plan = mk(c.key, c.at, c.label); await insert(plan);
    log = [];
    const panel = await openPanel(plan.id);
    const rows = await rowsIn(panel, c.group);
    console.log(`${c.label} · ${c.group} rows:`, rows.join(", "));
    check(`B · ${c.label}: the "${c.row}" row is offered in its group`, rows.includes(c.row));
    check(`B · ${c.label}: nothing from the county is requested before the row is switched on`, sent().filter((e) => FB_HOST.test(e.url)).length === 0, String(sent().length));
    await turnOn(panel, c.group, c.row);
    await sleep(12000);
    const ans = answered(c.re).filter((e) => e.status === 200);
    check(`B · ${c.label}: the county's server was asked and answered 200`, ans.length > 0, answered(c.re).map((e) => e.status).join(","));
    check(`B · ${c.label}: the answer carries features`, ans.reduce((n, e) => n + (e.features || 0), 0) > 0, String(ans.reduce((n, e) => n + (e.features || 0), 0)));
    const bad = log.filter((e) => !e.req && typeof e.status === "number" && e.status >= 400);
    check(`B · ${c.label}: no request to the county failed`, bad.length === 0, bad.slice(0, 2).map((e) => `${e.status} ${e.url.slice(-80)}`).join(" | "));
    const L = await layers(); const F = (L && L.features) || {};
    console.log(`${c.label} · painted:`, JSON.stringify(Object.fromEntries(c.ids.map((i) => [i, F[i]]))));
    for (const id of c.ids) check(`B · ${c.label}: ${id} painted ≥ 1 feature`, (F[id] || 0) >= 1, String(F[id]));
    const card = await identify(c.card.id, c.at);
    console.log(`card ${c.card.id}:`, JSON.stringify(card && { title: card.title, rows: (card.rows || []).map((r) => `${r.label}: ${r.text}`) }));
    check(`B · ${c.label}: a click card opens at the known feature`, !!(card && card.title), card ? card.title : "no card");
    if (card) {
      check(`B · ${c.label}: card title reads "${c.card.title}"`, c.card.title.test(card.title), card.title);
      const lbls = (card.rows || []).map((r) => r.label);
      for (const l of c.card.labels) check(`B · ${c.label}: card has the "${l}" row`, lbls.includes(l), lbls.join(", "));
      if (c.card.text) check(`B · ${c.label}: card text matches ${c.card.text}`, c.card.text.test(JSON.stringify(card)), "");
      check(`B · ${c.label}: card has no raw field names, placeholders or empty rows`, !RAW.test(JSON.stringify(card)) && (card.rows || []).every((r) => String(r.text || "").trim()), "");
    }
    if (c.key === "dev") {
      const lidHere = await identify("fb_lid", c.at);
      check("B · Fulshear (Candela): the LID row has no feature here (no LID in the Fulshear cluster)", lidHere === null, JSON.stringify(lidHere));
    }
    if (c.key === "brazos") {
      const insd = await identify("fb_brazos_inundation", c.at);
      check("B · Brazos: the inundation study card says it is not the effective FEMA map", !!insd && /not the effective FEMA map/.test(JSON.stringify(insd)), JSON.stringify(insd && insd.title));
    }
    if (c.key === "lid") {
      // NEW-2 (C): the dead contour row is gone from every group of a Fort Bend plan
      let all = [];
      for (const g of ["base", "topo", "jur", "flood", "util", "env", "access"]) all = all.concat(await rowsIn(panel, g));
      check("C · a Fort Bend plan has NO fb_contours row (the dead 1-ft contour service) in any group", !all.includes("fb_contours"), all.filter((r) => /contour/i.test(r)).join(", "));
      check("C · the USGS 3DEP Contour Lines row covers Fort Bend (known-good arm)", all.includes("contours"), all.filter((r) => /contour/i.test(r)).join(", "));
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-${c.key}.png` });
  }
  check("C · the page never requested the dead contour host (arcgisweb.fortbendcountytx.gov) in any plan", everDead === 0, String(everDead));

  /* ── D. Houston offers none of it ─────────────────────────────────────────────────────── */
  log = [];
  const hou = mk("hou", HOUSTON, "Houston"); await insert(hou);
  const pTx = await openPanel(hou.id);
  let allTx = [];
  for (const g of ["jur", "flood", "util", "access"]) allTx = allTx.concat(await rowsIn(pTx, g));
  console.log("Houston rows:", allTx.join(", "));
  check("D · KNOWN-GOOD arm: Houston lists the Texas rows (an empty answer is not an empty registry)", allTx.includes("water_sewer") && allTx.includes("counties_cities"), `${allTx.length} rows`);
  const leaked = ALL_FB_ROWS.filter((id) => allTx.includes(id));
  check("D · Houston offers none of the Fort Bend rows", leaked.length === 0, leaked.join(", "));
  await sleep(3000);
  check("D · the Houston plan issues ZERO requests to the county's server", sent().length === 0, `${sent().length} sent: ${sent().slice(0, 2).map((e) => e.url.slice(0, 90)).join(" | ")}`);
} finally {
  for (const id of LOCAL ? [] : cleanupIds) {
    const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
    check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
  }
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
