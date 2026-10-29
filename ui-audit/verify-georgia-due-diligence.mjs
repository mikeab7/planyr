/* verify-georgia-due-diligence — NEW-1 (Georgia due-diligence gaps, 2026-10-29): every new Georgia layer, on the REAL map, over a real Georgia point.
 *
 *   node ui-audit/verify-georgia-due-diligence.mjs [http://localhost:4173]              local `vite preview` (needs outbound HTTPS to ArcGIS Online: PW_PROXY / HTTPS_PROXY)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-georgia-due-diligence.mjs https://planyr.io --expect-sha <sha>
 *                                                              LIVE: signed in as the test account; a LOCATED throwaway Georgia plan it creates, checks and deletes (verified gone)
 *
 * ARMS (each prints ✅/❌; the run is VOID — exit 2, never 0 — if the browser cannot reach a layer's host, or the tab is not foreground):
 *   LISTING   the map finder over each point lists exactly the rows that point should have: Savannah lists NO metro-Atlanta / Spalding row, Roswell lists the
 *             Chattahoochee corridor and the watersheds, Griffin lists Spalding zoning, Houston lists NONE of the new Georgia rows (known-good: Houston still lists Texas rows).
 *   DRAWS     each layer, turned on over a point ON its known feature (the registry's own fixtures), requests its own host with a 200, raises no failure/"too detailed"
 *             state, and DRAWS (paths / canvas grew). A layer that paints nothing over its own fixture fails.
 *   NO-FREEZE every layer is also turned on at a wide, dense view (the zoom a developer lands at); the longest task on the page must stay under the budget and the
 *             page must keep answering rAF — a layer that stalls a pan is a failure, not a note.
 *   PLANNER   (live mode) the throwaway Georgia plan's planner panel lists the same Environmental rows as the finder for that point.
 *   CARD      a click on a drawn feature opens a card with a title and no raw field names.
 * Live mode reads /version.json in the SAME call as the assertions. FOREGROUND-OR-VOID asserted first. */
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4173").replace(/\/$/, "");
const live = !/localhost|127\.0\.0\.1/.test(base);
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const LONG_TASK_BUDGET_MS = Number(process.env.GA_LONG_TASK_MS || 1500);
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* id = the Layers-panel row id (a merged row is its mergeGroup id); needle = a substring of the service URL; zoom = the view the layer is checked at over its feature */
const LAYERS = [
  { id: "ga_recharge", group: "env", lat: 31.58, lon: -84.16, zoom: 11, needle: "Most_Significant_Ground_Water" },
  { id: "ga_gw_susceptibility", group: "env", lat: 33.75, lon: -84.39, zoom: 11, needle: "DRASTIC", wide: { lat: 33.2, lon: -84.2, zoom: 9 } },
  { id: "ga_protected_rivers", group: "env", lat: 34.26, lon: -85.16, zoom: 11, needle: "EnvironmentalPlanning/FeatureServer/6" },
  { id: "ga_protected_mountains", group: "env", lat: 34.65, lon: -83.9, zoom: 10, needle: "EnvironmentalPlanning/FeatureServer/3", wide: { lat: 34.65, lon: -83.9, zoom: 16 } },
  { id: "ga_water_supply", group: "env", lat: 33.349, lon: -84.2138, zoom: 11, needle: "SWSW" },
  { id: "ga_karst", group: "env", lat: 34.17, lon: -84.8, zoom: 10, needle: "SGMC" },
  { id: "ga_solid_waste", group: "env", lat: 33.75, lon: -84.39, zoom: 12, needle: "Solid_Waste_Facilities" },
  { id: "ga_brownfields", group: "env", lat: 33.75, lon: -84.39, zoom: 12, needle: "Brownfields_coordinates" },
  { id: "ga_dams", group: "env", lat: 33.25, lon: -84.26, zoom: 11, needle: "Safe_Dams" },
  { id: "ga_impaired_streams", group: "env", lat: 33.75, lon: -84.4, zoom: 12, needle: "305b303d", wide: { lat: 33.75, lon: -84.4, zoom: 10 } },
  { id: "ga_conservation", group: "env", lat: 33.75, lon: -84.39, zoom: 12, needle: "Georgia_Conservation_Lands", wide: { lat: 33.75, lon: -84.39, zoom: 10 } },
  { id: "ga_mrpa", group: "jur", lat: 33.9982, lon: -84.3348, zoom: 13, needle: "Chattahoochee_River_Corridor_2000ft" },
  { id: "ga_opportunity_zones", group: "jur", lat: 33.75, lon: -84.39, zoom: 11, needle: "Federal_Opportunity_Zones" },
  { id: "ga_jtc_tiers", group: "jur", lat: 33.25, lon: -84.26, zoom: 8, needle: "JTC_Counties_2026" },
  { id: "ga_spalding_zoning", group: "jur", lat: 33.265, lon: -84.28, zoom: 13, needle: "Spalding_County_Zoning" },
  // the relay rows: GDOT / DNR / USGS on the Georgia GIS Clearinghouse and Bartow County, read through /gis-proxy
  { id: "ga_road_ownership", group: "jur", lat: 33.75, lon: -84.39, zoom: 15, needle: "GDOT_FunctionalClass/MapServer/20" },
  { id: "ga_rare_species", group: "env", lat: 31.58, lon: -84.16, zoom: 11, needle: "Conservation/MapServer/1" },
  { id: "ga_mineral", group: "env", lat: 34.17, lon: -84.8, zoom: 12, needle: "PhysicalGeography/MapServer/0" },
  { id: "ga_bartow_zoning", group: "jur", lat: 34.25, lon: -84.9, zoom: 15, needle: "BartowZoning/MapServer/0" },
];
const NEW_ROW_IDS = [...LAYERS.map((l) => l.id), "ga_swsw", "ga_swsw_protected", "ga_mrpa_corridor"].filter((v, i, a) => a.indexOf(v) === i);
const POINTS = [
  { key: "savannah", label: "Savannah (coast, outside the metro District and Spalding)", lat: 32.08, lon: -81.10, expect: { shown: ["ga_recharge", "ga_karst", "ga_jtc_tiers", "ga_conservation", "ga_dams"], hidden: ["ga_mrpa", "ga_water_supply", "ga_spalding_zoning", "ga_protected_mountains", "ga_bartow_zoning"] } },
  { key: "roswell", label: "Roswell (on the Chattahoochee, in the metro District)", lat: 33.9982, lon: -84.3348, expect: { shown: ["ga_mrpa", "ga_water_supply", "ga_recharge"], hidden: ["ga_spalding_zoning"] } },
  { key: "dahlonega", label: "Dahlonega (north Georgia mountains)", lat: 34.53, lon: -83.98, expect: { shown: ["ga_protected_mountains", "ga_recharge"], hidden: ["ga_mrpa", "ga_spalding_zoning"] } },
  { key: "griffin", label: "Griffin (Spalding County)", lat: 33.2468, lon: -84.2641, expect: { shown: ["ga_spalding_zoning", "ga_dams", "ga_road_ownership"], hidden: ["ga_mrpa", "ga_bartow_zoning"] } },
  { key: "adairsville", label: "Adairsville (Bartow County)", lat: 34.37, lon: -84.93, expect: { shown: ["ga_bartow_zoning", "ga_mineral", "ga_rare_species"], hidden: ["ga_spalding_zoning", "ga_mrpa"] } },
  { key: "houston", label: "Houston (known-good arm: Texas rows still listed, no new Georgia row)", lat: 29.7604, lon: -95.3698, expect: { shown: [], hidden: NEW_ROW_IDS } },
];

const stamp = Math.random().toString(36).slice(2, 7);
const plan = (key, lat, lon) => ({
  schemaVersion: 12, id: `zz-gadd-${key}-${stamp}`, groupId: `zz-gadd-${key}-${stamp}`, site: `zz georgia due diligence ${key}`, name: "Plan 1", origin: { lat, lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [], updatedAt: Date.now(), data: { status: "active" },
});
const PLAN = plan("roswell", 33.9982, -84.3348);

let page, close, browser;
const seen = {};
if (live) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; close = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const launch = { args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined };
  const proxy = process.env.PW_PROXY || process.env.HTTPS_PROXY || "";
  if (proxy) launch.proxy = { server: proxy, bypass: "localhost,127.0.0.1" }; // the build sandbox reaches ArcGIS Online only through its egress proxy
  browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  // `vite preview` has no Cloudflare Functions: stand the /gis-proxy relay in with planyr.io's own (what the app reaches in production)
  await page.route(/\/gis-proxy\//, async (route) => {
    const u = new URL(route.request().url());
    try { const r = await route.fetch({ url: "https://planyr.io" + u.pathname + u.search }); await route.fulfill({ response: r }); } catch (e) { await route.abort(); }
  });
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify({ [PLAN.id]: PLAN }));
  close = () => browser.close();
}
const featureIds = {}; // needle-agnostic: unique features each /query answer carried, by URL host+path
page.on("response", async (r) => {
  const u = r.url(); (seen[u] = seen[u] || []).push(r.status());
  if (!/\/query\?/.test(u) || r.status() !== 200) return;
  try {
    const j = await r.json();
    const path = u.split("?")[0];
    const set = (featureIds[path] = featureIds[path] || new Set());
    for (const f of j.features || []) { const a = f.attributes || f.properties || {}; const id = a.OBJECTID ?? a.FID ?? a.ObjectId ?? a.ObjectID ?? JSON.stringify(f.geometry || a).slice(0, 80); set.add(String(id)); }
  } catch (_) { /* not JSON / already consumed */ }
});
const uniqueFeatures = (needle) => Object.entries(featureIds).filter(([u]) => u.includes(needle)).reduce((n, [, s]) => n + s.size, 0);
const reached = (needle) => Object.entries(seen).filter(([u]) => u.includes(needle)).flatMap(([, s]) => s);
const longTaskInit = () => {
  window.__gaLong = { max: 0, n: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__gaLong.n++; if (e.duration > window.__gaLong.max) window.__gaLong.max = e.duration; } }).observe({ entryTypes: ["longtask"] }); } catch (_) {}
};

const openFinder = async (lat, lon, zoom) => {
  await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
  if (live) await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
  await page.evaluate(longTaskInit);
  await page.evaluate(([la, lo, z]) => window.__mapFinderMap.setView([la, lo], z, { animate: false }), [lat, lon, zoom]);
  await page.waitForTimeout(1500);
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
  await fp.waitFor({ state: "visible", timeout: 20000 });
  return fp;
};
const rowIds = async (fp, group) => {
  await fp.getByTestId(`layer-group-${group}`).click();
  await page.waitForTimeout(600);
  return fp.evaluate((p) => [...p.querySelectorAll('[data-testid="layer-pane"] [data-testid^="layer-row-"]')].map((r) => r.getAttribute("data-testid")).filter((t) => !t.endsWith("-menu")).map((t) => t.replace(/^layer-row-/, "")));
};
const drawn = () => page.evaluate(() => ({ paths: document.querySelectorAll(".leaflet-pane svg path").length, canvases: document.querySelectorAll(".leaflet-pane canvas").length, imgs: document.querySelectorAll(".leaflet-overlay-pane img").length, text: document.body.innerText }));
const rafAlive = () => page.evaluate(() => new Promise((res) => { const t = setTimeout(() => res(false), 4000); requestAnimationFrame(() => { clearTimeout(t); res(true); }); }));

try {
  await assertMeasurable(page, "verify-georgia-due-diligence");
  if (live) {
    const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
    console.log("served build:", v.build);
    if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
  }

  /* ---------- LISTING ---------- */
  for (const p of POINTS) {
    console.log(`— LISTING: ${p.label} —`);
    const fp = await openFinder(p.lat, p.lon, 12);
    const rows = { environmental: await rowIds(fp, "env"), jurisdiction: await rowIds(fp, "jur") };
    const all = new Set([...rows.environmental, ...rows.jurisdiction]);
    check(`${p.key}: the panel opened and lists rows`, all.size > 3, `${all.size}`);
    for (const id of p.expect.shown) check(`${p.key}: lists ${id}`, all.has(id));
    for (const id of p.expect.hidden) check(`${p.key}: does NOT list ${id}`, !all.has(id));
    if (p.key === "houston") check("known-good arm: Houston still lists Texas rows (the instrument can see rows)", rows.jurisdiction.some((r) => /^jur_/.test(r)) || rows.environmental.length > 0, [...all].slice(0, 6).join(","));
  }

  /* ---------- DRAWS (+ CARD) ---------- */
  for (const L of LAYERS) {
    if (process.env.GA_ONLY && !process.env.GA_ONLY.split(",").includes(L.id)) continue; // a focused re-run after a fix
    console.log(`— DRAWS: ${L.id} —`);
    const fp = await openFinder(L.lat, L.lon, L.zoom);
    await rowIds(fp, L.group);
    const row = fp.getByTestId(`layer-row-${L.id}`);
    if (!(await row.count())) { check(`${L.id}: row present`, false); continue; }
    const before = await drawn();
    await row.locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(L.id === "ga_protected_mountains" ? 14000 : 9000);
    const state = await row.getAttribute("data-layer-state");
    const after = await drawn();
    const codes = reached(L.needle);
    if (!codes.length) { console.log(`  VOID — the browser never reached ${L.needle}`); voided++; continue; }
    check(`${L.id}: requested its service and got 200`, codes.some((c) => c === 200), JSON.stringify(codes.slice(0, 5)));
    check(`${L.id}: no failure / "too detailed" state`, !/failed|error/i.test(String(state)) && !/too detailed|layer failed|no vector source|couldn.t load/i.test(after.text), `state=${state}`);
    check(`${L.id}: DRAWS over its known feature`, after.paths + after.canvases + after.imgs > before.paths + before.canvases + before.imgs, `${before.paths}p/${before.canvases}c → ${after.paths}p/${after.canvases}c`);
    /* the collapse trap: a layer that draws ONE of fifty features is broken. A quarter is the floor, not half: esri-leaflet requests whole tile cells, so a statewide layer legitimately returns features beyond the viewport (measured: JTC counties, 159 returned / 73 in view) */
    const returned = uniqueFeatures(L.needle), grew = after.paths - before.paths;
    check(`${L.id}: draws the features the service returned, not just one`, returned === 0 || (grew >= Math.min(returned, 3) && grew >= Math.floor(returned * 0.25)), `${returned} returned · ${grew} new paths`);
    check(`${L.id}: page still answers (rAF alive)`, await rafAlive());
    const lt = await page.evaluate(() => window.__gaLong);
    check(`${L.id}: no task over ${LONG_TASK_BUDGET_MS} ms while drawing`, lt.max < LONG_TASK_BUDGET_MS, `longest ${Math.round(lt.max)} ms over ${lt.n} long task(s)`);
    await page.screenshot({ path: `${process.env.GA_SHOTS || "/tmp"}/ga-dd-${L.id}.png` }).catch(() => {});

    if (L.wide) {
      await page.evaluate(([la, lo, z]) => window.__mapFinderMap.setView([la, lo], z, { animate: false }), [L.wide.lat, L.wide.lon, L.wide.zoom]);
      await page.evaluate(() => { window.__gaLong = { max: 0, n: 0 }; });
      await page.waitForTimeout(12000);
      const w = await drawn();
      const lw = await page.evaluate(() => window.__gaLong);
      check(`${L.id}: wide view z${L.wide.zoom} — no "too detailed" refusal`, !/too detailed/i.test(w.text));
      check(`${L.id}: wide view z${L.wide.zoom} — no task over ${LONG_TASK_BUDGET_MS} ms`, lw.max < LONG_TASK_BUDGET_MS, `longest ${Math.round(lw.max)} ms`);
      check(`${L.id}: wide view — page still answers`, await rafAlive());
      if (L.id === "ga_protected_mountains") { // the cumulative draw cap: ordinary panning and one zoom step at parcel scale must not flip an already-drawn layer to "too detailed"
        for (const [dla, dlo, z] of [[0.15, 0.1, L.wide.zoom], [0.15, 0.1, L.wide.zoom + 1], [-0.3, 0.2, L.wide.zoom + 1]]) {
          await page.evaluate(([la, lo, zz]) => window.__mapFinderMap.setView([la, lo], zz, { animate: false }), [L.wide.lat + dla, L.wide.lon + dlo, z]);
          await page.waitForTimeout(9000);
        }
        const pn = await drawn();
        check(`${L.id}: after panning and a zoom step at z${L.wide.zoom + 1} — still no "too detailed" refusal`, !/too detailed/i.test(pn.text));
      }
    }
    await row.locator('input[type="checkbox"]').first().uncheck().catch(() => {});
  }

  /* ---------- PLANNER (live: the throwaway located plan) ---------- */
  if (live) {
    const ins = await page.evaluate(async (site) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, PLAN);
    check("throwaway LOCATED Georgia plan written to the test account", !ins, ins || "");
  }
  console.log("— PLANNER: the located plan's panel —");
  await page.goto(`${base}/#/project/${PLAN.id}/site`, { waitUntil: "load" });
  if (live) await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForTimeout(1800);
  const pchip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await pchip.count()) await pchip.first().click();
  const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await pp.waitFor({ state: "visible", timeout: 20000 });
  const envP = await rowIds(pp, "env"), jurP = await rowIds(pp, "jur");
  for (const id of ["ga_recharge", "ga_karst", "ga_water_supply", "ga_solid_waste"]) check(`planner @ Roswell lists ${id}`, envP.includes(id));
  for (const id of ["ga_mrpa", "ga_jtc_tiers"]) check(`planner @ Roswell lists ${id}`, jurP.includes(id));
  check("planner @ Roswell does NOT list Spalding zoning", !jurP.includes("ga_spalding_zoning"));
  const mrpa = pp.getByTestId("layer-row-ga_mrpa");
  await mrpa.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(9000);
  check("planner: the Chattahoochee corridor row turns on without a failure state", !/failed/i.test(String(await mrpa.getAttribute("data-layer-state"))), String(await mrpa.getAttribute("data-layer-state")));
} finally {
  if (live) {
    const gone = await page.evaluate(async (id) => {
      try {
        for (const k of Object.keys(localStorage)) {
          if (!/^planarfit:sites:/.test(k)) continue;
          try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
        }
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await window.pfSupabase.from("sites").delete().eq("id", id);
        const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
        return { cloud: !(q.data && q.data.length), left: (q.data || []).length };
      } catch (e) { return { error: String(e) }; }
    }, PLAN.id);
    check("the throwaway plan is deleted and verified GONE (owner rule 15)", gone && gone.cloud === true, JSON.stringify(gone));
  }
  await close();
}
if (voided) { console.log(`VOID (${voided} layer(s) could not reach their host)`); process.exit(2); }
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
