/* diagnose-gis-fill-hole — NEW-1: does a polygon-FILL GIS layer (Zoning, Future Land Use) paint continuously across the open site on the SITE PLAN view?
 *   E2E_LOGIN_KEY=… node ui-audit/diagnose-gis-fill-hole.mjs [https://planyr.io] [--big] [--lat 29.6122132 --lng -95.6693177] [--w 1500 --h 950] [--shots dir]
 * Per sampled screen point it records three independent answers: TRUTH (the city's own service holds a polygon there — fetched whole through the relay and tested here),
 * LOADED (the layer's own Leaflet polygons contain it) and PAINTED (the screenshot differs from the same view with the layer off). A point that is TRUTH but not PAINTED is a hole. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const SHOTS = flag("--shots"); if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const lat = Number(flag("--lat", 29.6122132)), lng = Number(flag("--lng", -95.6693177));
const VW = Number(flag("--w", 1500)), VH = Number(flag("--h", 950));
const LAYERS = { sl_zoning: /Zoning_GWNT\/MapServer\/0/, sl_flu: /Future_Land_Use_Map_2022_WFL1\/FeatureServer\/8/ };
const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "diagnose-gis-fill-hole");
await page.setViewportSize({ width: VW, height: VH });
console.log("served build", await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build));
const urls = {};
page.on("request", (r) => { for (const [k, re] of Object.entries(LAYERS)) if (re.test(r.url()) && /\/query/.test(r.url()) && !urls[k]) urls[k] = r.url().split("/query")[0]; });
const id = `${LIVE_PREFIX}fillhole-${Date.now().toString(36)}`;
const plan = { ...throwawayPlan(id), origin: { lat, lon: lng }, site: "ZZ Live Check — fill hole" };
if (args.includes("--big")) { // the owner's Academy footprint: a ~3,100 × 6,000 ft parcel and a spread of buildings (extents read from his plan, 2026-11-05)
  plan.parcels = [{ id: "p1", points: [{ x: -1572, y: -2999 }, { x: 1572, y: -2999 }, { x: 1572, y: 2999 }, { x: -1572, y: 2999 }], active: true, z: 0 }];
  const nEls = Number(flag("--els", 5));
  plan.els = Array.from({ length: nEls }, (_, i) => ({ id: `b${i}`, type: "building", cx: -1200 + ((i * 397) % 2400), cy: -2500 + ((i * 611) % 4800), w: 300, h: 200, rot: (i * 17) % 90, z: i + 1 }));
}
if (args.includes("--legacy")) { // the owner's stored map snapshot ("Aerial backdrop", fromMap) — same fields as his plan, read 2026-11-05
  plan.sheetOverlays = [{ x: -2829.86, y: -5399.98, id: "legacy-aerial", src: "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=-95.67823007777187,29.5974288862136,-95.66040537174493,29.6269975919816&bboxSR=4326&imageSR=4326&size=1085,1800&format=jpg&transparent=false&f=image", imgH: 1800, imgW: 1085, kind: "image", name: "Aerial backdrop", page: 1, locked: true, fromMap: true, ftPerPx: 5.2163318, opacity: 1, ftPerPxY: 5.99954, knockout: false, rotation: 0, pageCount: 1, calibrated: false }];
}
const err = await page.evaluate(async ([pl]) => { const { data: u } = await window.pfSupabase.auth.getUser(); const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl }); return error ? String(error.message) : null; }, [plan]);
if (err) throw new Error(err);
const setLayer = async (panel, key, on) => { const cb = panel.locator(`[data-testid="layer-row-${key}"] input[type="checkbox"]`).first(); if ((await cb.isChecked()) !== on) await (on ? cb.check() : cb.uncheck()); };
try {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1200);
  await panel.getByTestId("layer-group-jur").click(); await page.waitForTimeout(300);
  if (flag("--basemap") === "off") { await panel.getByTestId("layer-group-base").click(); await page.waitForTimeout(300); await panel.getByTestId("basemap-source").selectOption("off"); await page.waitForTimeout(2500); await panel.getByTestId("layer-group-jur").click(); await page.waitForTimeout(300); }
  const shot = async () => decodePng(await page.screenshot());
  const sample = []; for (let y = 100; y < VH - 10; y += 40) for (let x = 70; x < VW - 190; x += 40) { if (x > 930 && y < 460) continue; if (x > VW - 260 && y > VH - 120) continue; if (x < 70 || (x > 835 && y < 130)) continue; sample.push({ x, y }); }
  const base = await (async () => { await setLayer(panel, "sl_zoning", false); await setLayer(panel, "sl_flu", false); await page.waitForTimeout(2500); return shot(); })();
  for (const key of Object.keys(LAYERS)) {
    await setLayer(panel, key, true); await page.waitForTimeout(16000);
    const on = await shot();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${key}-on.png` });
    const info = await page.evaluate(async ([pts, url]) => {
      const map = window.__geoMap, rect = map.getContainer().getBoundingClientRect();
      const ll = pts.map((p) => map.containerPointToLatLng([p.x - rect.left, p.y - rect.top]));
      // LOADED: every Leaflet polygon on the map that carries a feature of this layer (matched by the feature's own properties below)
      const polys = [];
      map.eachLayer((l) => { if (l.feature && l.feature.geometry && l.getLatLngs && /Polygon/.test(l.feature.geometry.type)) polys.push(l); });
      const inRing = (r, lt, ln) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.lat > lt) !== (b.lat > lt) && ln < ((b.lng - a.lng) * (lt - a.lat)) / (b.lat - a.lat) + a.lng) c = !c; } return c; };
      const flat = (ls) => (Array.isArray(ls[0]) && ls[0].lat === undefined ? ls.flatMap(flat) : [ls]);
      const loaded = ll.map((p) => polys.some((l) => { const rings = flat(l.getLatLngs()); let n = 0; for (const r of rings) if (inRing(r, p.lat, p.lng)) n++; return n % 2 === 1; }));
      // TRUTH: the service itself, paged, in WGS84
      let truth = null, nfeat = 0;
      try {
        const feats = []; let off = 0;
        for (let k = 0; k < 20; k++) { const q = `${url}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultOffset=${off}&resultRecordCount=500`; const j = await fetch(q).then((r) => r.json()); const f = j.features || []; feats.push(...f); if (f.length < 500 && !j.exceededTransferLimit) break; off += f.length; }
        nfeat = feats.length;
        const ringsOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
        truth = ll.map((p) => feats.some((f) => ringsOf(f.geometry).some((poly) => { let n = 0; for (const r of poly) if (inRing(r.map(([x, y]) => ({ lat: y, lng: x })), p.lat, p.lng)) n++; return n % 2 === 1; })));
      } catch (e) { truth = null; }
      return { loaded, truth, nfeat, zoom: map.getZoom(), layers: polys.length };
    }, [sample, urls[key]]);
    const diff = (a, b, p) => { const i = (p.y * a.width + p.x) * a.channels; return Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); };
    const dpr = on.width / VW;
    const painted = sample.map((p) => diff(on, base, { x: Math.round(p.x * dpr), y: Math.round(p.y * dpr) }) > 12);
    let rows = {}; sample.forEach((p, i) => { (rows[p.y] = rows[p.y] || []).push(`${info.truth ? (info.truth[i] ? "T" : "-") : "?"}${info.loaded[i] ? "L" : "-"}${painted[i] ? "P" : "-"}`); });
    console.log(`\n${key}: zoom ${info.zoom}, service features ${info.nfeat}, polygons on map ${info.layers}   (cell = Truth/Loaded/Painted)`);
    for (const y of Object.keys(rows)) console.log(String(y).padStart(4), rows[y].join(" "));
    const holes = sample.filter((_, i) => info.truth && info.truth[i] && !painted[i]);
    console.log(`${key}: truth points ${info.truth ? info.truth.filter(Boolean).length : "?"}, truth-but-unpainted ${holes.length}, truth-but-unloaded ${sample.filter((_, i) => info.truth && info.truth[i] && !info.loaded[i]).length}`);
    await setLayer(panel, key, false); await page.waitForTimeout(2500);
  }
} finally {
  console.log("cleanup", JSON.stringify(await cleanupLive(page, { planId: id }))); await s.close();
}
