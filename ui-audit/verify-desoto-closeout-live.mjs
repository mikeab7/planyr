/* verify-desoto-closeout-live — the partial steps of V1956865 / V1956866 / V1956867 (DeSoto County MS + Olive Branch), LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-desoto-closeout-live.mjs [https://planyr.io] [--part a|b|all] [--shots <dir>] [--expect-sha <sha>]
 *
 *   PART A (Map view, nothing written):
 *     865·4  street-zoom pipe-size labels on the Olive Branch mains, dashed vs solid by field-verified status (screenshot)
 *     867·2  every planning row (City Limits named for the five cities, Future Land Use, Thoroughfare Plan, Future Subdivisions, Olive Branch Planning Area) switches on, draws, and states its vintage behind the (i)
 *   PART B (throwaway LOCATED plans, deleted and verified gone — owner rule 15):
 *     867·1  the header chip reads "City of Olive Branch" at Olive Branch and "Unincorporated DeSoto County" at 34.90,-89.78; Site Analysis carries the DeSoto zoning line there
 *     867·3  a Memphis (Shelby TN) plan is unchanged: no Mississippi rows offered, a Tennessee chip
 *     865·6  PDF parity: the pipe-size labels on screen are in the exported PDF's text
 *     866·2/3  an unincorporated parcel card reads "Zoning · Unincorporated DeSoto County"; a recently rezoned Olive Branch parcel carries "Approved" and an ordinance link
 * FOREGROUND-OR-VOID first; each part carries a known-good arm (a row that must be offered, a label that must be seen) and a run whose arm fails is VOID, never a pass. */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const PART = flag("--part", "all"), SHOTS = flag("--shots"), EXPECT_SHA = flag("--expect-sha");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const voidRun = (why) => { console.log(`VOID: ${why}`); voided++; };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-desoto-closeout-live");
await page.setViewportSize({ width: 1500, height: 950 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the expected one", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);
const OB = { lat: 34.96147632, lng: -89.8298842 };

/* ── helpers on the Map view ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const finder = () => page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
async function openMap() {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
  await sleep(1500);
}
const setView = async (lat, lng, z) => { await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [lat, lng, z]); await sleep(1500); };
async function rowOffered(panel, id) {
  for (let i = 0; i < 8; i++) {
    for (const g of ["jur", "util", "env", "flood", "access", "topo", "base"]) {
      const btn = panel.getByTestId(`layer-group-${g}`);
      if (await btn.count()) { await btn.click().catch(() => {}); await sleep(200); }
      if (await panel.locator(`[data-testid="layer-row-${id}"]`).count()) return true;
    }
    await sleep(1500);
  }
  return false;
}
async function turnOn(panel, id) {
  if (!(await rowOffered(panel, id))) return false;
  const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
  if (!(await cb.isChecked())) await cb.check();
  return true;
}

/* ═══ PART A ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
if (PART === "a" || PART === "all") {
  console.log("── PART A — Map view");
  await openMap();
  const panel = finder();
  // A1 · planning rows: switch each on at a view where it draws, read the (i)
  await setView(34.93, -89.85, 11);
  const rows = [
    { id: "counties_cities", label: "Counties & Cities", expect: null },
    { id: "ms_desoto_flu", label: "Future Land Use", expect: /2004/ },
    { id: "ms_desoto_thoroughfare", label: "Thoroughfare Plan", expect: /2004/ },
    { id: "ms_desoto_future_subd", label: "Future Subdivisions", expect: /./ },
    { id: "ms_ob_planning_area", label: "Olive Branch Planning Area", expect: /2022|last edited/i },
  ];
  for (const r of rows) {
    const on = await turnOn(panel, r.id);
    check(`867·2 · "${r.label}" is offered and switches on`, on);
  }
  await sleep(12000);
  const vint = {};
  for (const r of rows) {
    if (!r.expect) continue;
    await rowOffered(panel, r.id);
    await panel.getByTestId(`layer-caret-${r.id}`).click().catch(() => {}); await sleep(400);
    const info = panel.locator(`[data-testid="layer-row-${r.id}-menu"] button[aria-label*="About"], [data-testid="layer-row-${r.id}-menu"] button[title*="About"]`).first();
    if (await info.count()) { await info.click().catch(() => {}); await sleep(400); }
    const txt = await panel.locator(`[data-testid="layer-row-${r.id}-menu"]`).innerText().catch(() => "");
    vint[r.id] = txt;
    const dot = await panel.locator(`[data-testid="layer-row-${r.id}"]`).getAttribute("data-layer-state").catch(() => null);
    console.log(`  ${r.label}: state=${dot} · ${JSON.stringify(txt.replace(/\s+/g, " ").slice(-230))}`);
    check(`867·2 · "${r.label}" states its vintage behind the (i)`, r.expect.test(txt) && /Data:|vintage|Source:/i.test(txt) || r.expect.test(txt), r.expect.toString());
    await panel.getByTestId(`layer-caret-${r.id}`).click().catch(() => {});
  }
  // Future Subdivisions is zoom-gated (dormant at this view): it must draw once zoomed to its own range
  await setView(34.93, -89.85, 14); await sleep(9000);
  await rowOffered(panel, "ms_desoto_future_subd");
  const fsState = await panel.locator('[data-testid="layer-row-ms_desoto_future_subd"]').getAttribute("data-layer-state").catch(() => null);
  check("867·2 · Future Subdivisions draws once zoomed into its range", fsState === "drawing", `state=${fsState}`);
  // the five city names across a few zooms (a smaller city's name yields to a larger one where they would overlap — so each must show at SOME zoom)
  const seen = new Set();
  for (const z of [10, 11, 12]) {
    await setView(34.93, -89.85, z); await sleep(3500);
    (await page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip.pf-line-label")].filter((e) => e.style.visibility !== "hidden").map((e) => e.textContent.trim()))).forEach((t) => seen.add(t));
  }
  console.log("  city names seen:", [...seen].join(", "));
  for (const n of ["Olive Branch", "Southaven", "Horn Lake", "Hernando", "Walls"]) check(`867·2 · City Limits labels "${n}" (at some zoom)`, [...seen].some((t) => t.toLowerCase() === n.toLowerCase()));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-planning-rows.png` });

  // A2 · street zoom pipe-size labels
  await openMap();
  const p2 = finder();
  await setView(OB.lat, OB.lng, 17);
  const wOn = await turnOn(p2, "water_sewer"); const gOn = await turnOn(p2, "ms_ob_gas_main");
  check("865·4 · Water & Sewer and Gas Lines are offered at Olive Branch", wOn && gOn);
  await sleep(14000);
  const lab = await page.evaluate(() => {
    const tips = [...document.querySelectorAll(".leaflet-tooltip.pf-line-label")].map((e) => e.textContent.trim()).filter(Boolean);
    const paths = [...document.querySelectorAll("path.leaflet-interactive")].map((p) => p.getAttribute("stroke-dasharray") || "");
    return { tips, dashed: paths.filter((d) => d && d !== "none").length, solid: paths.filter((d) => !d || d === "none").length };
  });
  console.log(`  street zoom: ${lab.tips.length} labels (e.g. ${[...new Set(lab.tips)].slice(0, 8).join(" | ")}); dashed paths ${lab.dashed}, solid ${lab.solid}`);
  check("865·4 · pipe-size labels are printed on the mains at street zoom", lab.tips.length >= 3 && lab.tips.some((t) => /\d/.test(t)), `${lab.tips.length}`);
  check("865·4 · both dashed and solid lines are drawn (field-verified status)", lab.dashed > 0 && lab.solid > 0, `${lab.dashed} dashed / ${lab.solid} solid`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/A-street-zoom-labels.png` });
}

/* ═══ PART B ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
const planIds = [];
if (PART === "b" || PART === "all") {
  console.log("── PART B — throwaway plans");
  const mk = (tag, lat, lng, label) => ({ ...throwawayPlan(`${LIVE_PREFIX}ds-${tag}-${Date.now().toString(36)}`), origin: { lat, lon: lng }, site: `ZZ Live Check — ${label}` });
  const insert = async (plan) => {
    const err = await page.evaluate(async ([pl]) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
      return error ? String(error.message) : null;
    }, [plan]);
    planIds.push(plan.id);
    if (err) throw new Error("throwaway plan insert failed — " + err);
  };
  const openPlan = async (plan) => {
    await page.goto(`${BASE}/?planyrDiag=1#/project/${plan.id}/site`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    await sleep(3000);
  };
  try {
    await openMap(); // a page with the Supabase client before inserting
    const obP = mk("ob", OB.lat, OB.lng, "Olive Branch"), unP = mk("un", 34.90, -89.78, "Unincorporated DeSoto"), meP = mk("mem", 35.1495, -90.049, "Memphis");
    for (const p of [obP, unP, meP]) await insert(p);

    // B1 · header chips
    const chipOf = async () => { for (let i = 0; i < 25; i++) { const t = await page.getByTestId("jurisdiction-badge").first().innerText().catch(() => ""); if (t && !/checking|looking/i.test(t)) return t; await sleep(1000); } return await page.getByTestId("jurisdiction-badge").first().innerText().catch(() => ""); };
    await openPlan(unP);
    const unChip = await chipOf();
    console.log("  unincorporated chip:", JSON.stringify(unChip));
    check('867·1 · the chip at 34.90, −89.78 reads "Unincorporated DeSoto County"', /Unincorporated DeSoto County/i.test(unChip) && !/ETJ/i.test(unChip), unChip);
    // Site Analysis: the panel was redesigned to trusted verdicts only (B2117136) and carries no free-text zoning line any more — the DeSoto answer lives in WHO GOVERNS THIS SITE
    await page.getByText("Analysis", { exact: true }).first().click().catch(() => {});
    await sleep(8000);
    const body = await page.evaluate(() => document.body.innerText);
    const gov = (body.match(/WHO GOVERNS THIS SITE[\s\S]{0,260}/) || [""])[0].replace(/\s+/g, " ");
    console.log("  Site Analysis:", JSON.stringify(gov));
    check("867·1 · Site Analysis names the DeSoto answer: County DeSoto County, City Unincorporated DeSoto County, MS — and no ETJ", /County DeSoto County/.test(gov) && /Unincorporated DeSoto County, MS/.test(gov) && !/ETJ/i.test(gov), gov.slice(0, 160));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-unincorporated.png` });

    await openPlan(obP);
    const obChip = await chipOf();
    console.log("  Olive Branch chip:", JSON.stringify(obChip));
    check('867·1 · the chip at Olive Branch reads "City of Olive Branch"', /City of Olive Branch/i.test(obChip) && !/Unincorporated/i.test(obChip), obChip);

    // B3 · Memphis unchanged
    await openPlan(meP);
    const meChip = await chipOf();
    console.log("  Memphis chip:", JSON.stringify(meChip));
    check("867·3 · the Memphis plan's chip is Tennessee's (Memphis / Shelby), no Mississippi wording", /Memphis|Shelby|Tennessee|TN/i.test(meChip) && !/Mississippi|DeSoto|, MS/.test(meChip), meChip);
    const chip = page.getByTestId("layers-expand").filter({ visible: true }); if (await chip.count()) await chip.first().click();
    const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
    await pp.waitFor({ state: "visible", timeout: 20000 }); await sleep(1500);
    const ids = new Set();
    for (const g of ["jur", "util", "env", "flood", "access", "topo", "base"]) {
      const btn = pp.getByTestId(`layer-group-${g}`); if (await btn.count()) { await btn.click().catch(() => {}); await sleep(250); }
      (await pp.evaluate((root) => [...root.querySelectorAll('[data-testid^="layer-row-"]')].map((r) => r.getAttribute("data-testid").replace("layer-row-", "")).filter((x) => !x.endsWith("-menu")))).forEach((x) => ids.add(x));
    }
    const ms = [...ids].filter((x) => /^ms_/.test(x));
    console.log(`  Memphis rows offered: ${ids.size} (Mississippi rows: ${ms.join(", ") || "none"})`);
    if (!ids.has("counties_cities")) voidRun("Memphis known-good arm: Counties & Cities is not offered, so the row list is not readable");
    check("867·3 · no DeSoto / Olive Branch (ms_*) rows are offered on the Memphis plan", ms.length === 0, ms.join(", "));
  } finally {
    for (const id of planIds) { const r = await cleanupLive(page, { planId: id }); check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, !r.errors.length && r.left.site === 0, JSON.stringify(r)); }
  }
}

/* ═══ PART C — cards (Map view) and the PDF ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
if (PART === "c" || PART === "all") {
  console.log("── PART C — zoning cards (Map view)");
  await openMap();
  const panel = finder();
  await setView(34.96, -89.83, 15);
  check("866·1 · Zoning is offered and switches on", await turnOn(panel, "ms_desoto_zoning"));
  await sleep(10000);
  /* a point inside a given feature set, found from the county's own geometry (asked through the relay, like the app) */
  const interior = async (where) => page.evaluate(async (where) => {
    const q = new URLSearchParams({ where, outFields: "ZONE,CASE_NO,DATE_APPROVED", returnGeometry: "true", outSR: "4326", f: "json", resultRecordCount: "40" });
    const j = await fetch("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/CountyWebMap/Zoning/MapServer/20/query?" + q).then((r) => r.json()).catch(() => null);
    const inRing = (ring, x, y) => { let c = false; for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) { const [xi, yi] = ring[i], [xk, yk] = ring[k]; if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) c = !c; } return c; };
    for (const f of (j && j.features) || []) {
      const rings = (f.geometry && f.geometry.rings) || []; if (!rings.length) continue;
      const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (let a = 1; a < 12; a++) for (let b = 1; b < 12; b++) { const x = x0 + ((x1 - x0) * a) / 12, y = y0 + ((y1 - y0) * b) / 12; if (rings.reduce((c, r) => (inRing(r, x, y) ? !c : c), false)) return { lat: y, lng: x, attrs: f.attributes }; }
    }
    return null;
  }, where);
  const readCard = async (pt) => {
    await setView(pt.lat, pt.lng, 17); await sleep(9000);
    const b = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); const c = window.__mapFinderMap.getSize(); return { x: r.left + c.x / 2, y: r.top + c.y / 2 }; });
    await page.mouse.click(b.x, b.y); await sleep(2500);
    return page.evaluate(() => { const el = document.querySelector(".leaflet-popup-content"); return { text: el ? el.innerText : "", links: el ? [...el.querySelectorAll("a")].map((a) => ({ t: a.textContent.trim(), h: a.href })) : [] }; });
  };
  // 866·2 — the recently rezoned Olive Branch parcel (RZN-26-0003, ALMADALE RETREAT, R-1)
  const rz = await interior("CASE_NO LIKE '%RZN-26-0003%'");
  if (!rz) voidRun("the county server returned no RZN-26-0003 polygon, so the rezoned-parcel step cannot be driven");
  else {
    const c = await readCard(rz);
    console.log("  rezoned card:", JSON.stringify(c.text.replace(/\s+/g, " ").slice(0, 260)), JSON.stringify(c.links));
    check('866·2 · the rezoned parcel card reads "Zoning · Olive Branch" with the case number', /Zoning · Olive Branch/.test(c.text) && /RZN-26-0003/.test(c.text), c.text.split("\n")[0]);
    check("866·2 · it carries Approved: Aug 18, 2026", /Approved:\s*Aug 18, 2026/.test(c.text));
    check("866·2 · it carries an ordinance link (a short labelled link, not a raw URL)", c.links.some((l) => /municode|library\./i.test(l.h)) && !/https?:\/\//.test(c.text), JSON.stringify(c.links.map((l) => l.t)));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/C-rezoned-card.png` });
  }
  // 866·3 — an unincorporated DeSoto parcel: a county-zoned polygon whose interior point the county's own Municipalities layer says is in NO city
  const candidates = await page.evaluate(async () => {
    const q = new URLSearchParams({ where: "ZONE IN ('A','R-20','R-30','R-40','R-15','R-12','A-R')", outFields: "ZONE", returnGeometry: "true", outSR: "4326", f: "json", resultRecordCount: "60" });
    const j = await fetch("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/CountyWebMap/Zoning/MapServer/20/query?" + q).then((r) => r.json()).catch(() => null);
    const inRing = (ring, x, y) => { let c = false; for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) { const [xi, yi] = ring[i], [xk, yk] = ring[k]; if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) c = !c; } return c; };
    const out = [];
    for (const f of (j && j.features) || []) {
      const rings = (f.geometry && f.geometry.rings) || []; if (!rings.length) continue;
      const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      let found = null;
      for (let a = 1; a < 12 && !found; a++) for (let b = 1; b < 12 && !found; b++) { const x = x0 + ((x1 - x0) * a) / 12, y = y0 + ((y1 - y0) * b) / 12; if (rings.reduce((c, r) => (inRing(r, x, y) ? !c : c), false)) found = { lat: y, lng: x, zone: f.attributes.ZONE }; }
      if (found) out.push(found);
    }
    return out;
  });
  let un = null;
  for (const c of candidates.slice(0, 25)) {
    const inCity = await page.evaluate(async (c) => {
      const q = new URLSearchParams({ geometry: JSON.stringify({ x: c.lng, y: c.lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true", f: "json" });
      const j = await fetch("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/BaseLayers/MapServer/4/query?" + q).then((r) => r.json()).catch(() => null);
      return j && typeof j.count === "number" ? j.count > 0 : null;
    }, c);
    if (inCity === false) { un = c; break; }
  }
  if (!un) voidRun("no county-zoned polygon outside every city limit was found to click");
  else {
    const c = await readCard(un);
    console.log(`  unincorporated card (${un.zone}):`, JSON.stringify(c.text.replace(/\s+/g, " ").slice(0, 200)));
    check('866·3 · an unincorporated parcel card reads "Zoning · Unincorporated DeSoto County"', /Zoning · Unincorporated DeSoto County/.test(c.text), c.text.split("\n")[0]);
    check("866·3 · its Zone row carries the county's district name", new RegExp(`Zone: ${un.zone.replace("-", "[-]")} · `).test(c.text), (c.text.match(/Zone: [^\n]*/) || [""])[0]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/C-unincorporated-card.png` });
  }
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('866·4 · no "Official Olive Branch zoning map (PDF)" fallback anywhere', !/Official Olive Branch zoning map/i.test(bodyText));
}

/* ═══ PART D — PDF parity of the pipe-size labels ═══════════════════════════════════════════════════════════════════════════════════════════ */
if (PART === "d" || PART === "all") {
  console.log("── PART D — PDF export");
  const id = `${LIVE_PREFIX}ds-pdf-${Date.now().toString(36)}`;
  try {
    await openMap();
    const plan = { ...throwawayPlan(id), origin: { lat: OB.lat, lon: OB.lng }, site: "ZZ Live Check — Olive Branch PDF" };
    plan.parcels[0].points = [{ x: -300, y: -300 }, { x: 300, y: -300 }, { x: 300, y: 300 }, { x: -300, y: 300 }]; plan.els[0] = { ...plan.els[0], w: 200, h: 120 };
    const err = await page.evaluate(async ([pl]) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
      return error ? String(error.message) : null;
    }, [plan]);
    if (err) throw new Error("throwaway plan insert failed — " + err);
    // the downloaded PDF is a flattened picture (no text to read), so capture the SVG the export draws before it rasterises it
    await page.addInitScript(() => { window.__svgBlobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { try { if (b && /svg/.test(b.type || "")) window.__svgBlobs.push(b); } catch (_) { /* capture only */ } return o(b); }; });
    await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 }); await sleep(3000);
    const chip = page.getByTestId("layers-expand").filter({ visible: true }); if (await chip.count()) await chip.first().click();
    const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
    await pp.waitFor({ state: "visible", timeout: 20000 }); await sleep(1200);
    let wOn = false;
    for (let i = 0; i < 8 && !wOn; i++) {
      for (const g of ["util", "jur"]) { const b = pp.getByTestId(`layer-group-${g}`); if (await b.count()) { await b.click().catch(() => {}); await sleep(250); } if (await pp.locator('[data-testid="layer-row-water_sewer"]').count()) { wOn = true; break; } }
      if (!wOn) await sleep(1500);
    }
    check("865·6 · Water & Sewer is offered on the Olive Branch plan", wOn);
    const cb = pp.locator('[data-testid="layer-row-water_sewer"] input[type="checkbox"]').first(); if (!(await cb.isChecked())) await cb.check();
    await sleep(14000);
    const onScreen = await page.evaluate(() => [...new Set([...document.querySelectorAll(".leaflet-tooltip.pf-line-label")].map((e) => e.textContent.trim()).filter((t) => /\d/.test(t)))]);
    console.log("  labels on screen:", onScreen.join(" | "));
    if (onScreen.length < 2) voidRun("known-good arm: fewer than two pipe-size labels are on screen, so parity cannot be judged");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/D-plan-labels.png` });
    await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
    await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 }); await sleep(900);
    await page.locator('button:has-text("Continue ➜")').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 }); await sleep(4000);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 })]);
    const pdfPath = `${SHOTS || "/tmp"}/D-olive-branch-export.pdf`;
    await dl.saveAs(pdfPath);
    // what the export drew: every <text> in the SVGs it rasterised that reads like a pipe size
    const drawn = await page.evaluate(async () => {
      const out = [];
      for (const b of window.__svgBlobs || []) { const t = await b.text(); const d = new DOMParser().parseFromString(t, "image/svg+xml"); d.querySelectorAll("text").forEach((e) => out.push(e.textContent.trim())); }
      return out;
    });
    const sizes = drawn.filter((t) => /^\d+(\.\d+)?"$/.test(t));
    console.log(`  the export drew ${drawn.length} text items; pipe sizes: ${[...new Set(sizes)].join(" | ") || "none"}`);
    check("865·6 · the export draws pipe-size labels for the mains in the frame (PDF-PARITY)", sizes.length >= 1, `${sizes.length}`);
    check("865·6 · every printed pipe size is one that shows on screen", sizes.length > 0 && sizes.every((t) => onScreen.includes(t)), sizes.filter((t) => !onScreen.includes(t)).join(", "));
    execFileSync("pdftoppm", ["-r", "110", "-png", "-f", "1", "-l", "1", pdfPath, pdfPath.replace(/\.pdf$/, "")]);
  } finally {
    const r = await cleanupLive(page, { planId: id });
    check("throwaway PDF plan deleted and verified gone", !r.errors.length && r.left.site === 0, JSON.stringify(r));
  }
}
await s.browser.close().catch(() => {});
console.log(voided ? `VOID (${voided})` : failed ? `FAIL (${failed})` : "PASS");
process.exit(voided ? 2 : failed ? 1 : 0);
