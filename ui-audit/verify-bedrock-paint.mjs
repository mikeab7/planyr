/* B2081251 — the shallow-rock layer, driven in the REAL built app with the two USDA services MOCKED (the sandbox cannot
 * reach them; the live arm is verify-ssurgo-bedrock.mjs). Proves the app half: the row lists on a Georgia AND a Texas
 * site (national), switching it on requests the WFS then SDA tabular, DRAWS class-coloured polygons, does not move the
 * map, and — the LOUD-FAILURE arm — a failing service paints NOTHING and shows a failed state rather than a clean map.
 * Known-good arm: the mocked answer carries a very-shallow unit; no polygon ⇒ the run is VOID.
 *   npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-bedrock-paint.mjs */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || undefined;
const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const mkSite = (id, lat, lon, county) => ({ id, groupId: id, site: `Throwaway ${id}`, name: "Concept A", origin: { lat, lon }, county, parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() });
let fail = 0;
const check = (n, ok, x = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`); if (!ok) fail++; };

const gml = (bbox) => {
  const [w, s, e, n] = bbox, cx = (w + e) / 2, cy = (s + n) / 2, d = (e - w) / 6;
  const sq = (x, y) => [[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]].map((p) => p.join(",")).join(" ");
  const m = (k, x, y) => `<gml:featureMember><ms:mapunitpoly><ms:mukey>${k}</ms:mukey><gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>${sq(x, y)}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs></gml:Polygon></ms:mapunitpoly></gml:featureMember>`;
  return `<wfs:FeatureCollection>${m("1001", cx - 2 * d, cy)}${m("1002", cx + 2 * d, cy)}${m("1003", cx, cy + 3 * d)}</wfs:FeatureCollection>`;
};
const TAB = { Table: [["mukey", "muname", "brockdepmin"], ["1001", "Pacolet-Cecil complex", "30"], ["1002", "Cecil sandy loam", "110"], ["1003", "Deep loam", null]] };

async function run(label, site, { fail503 = false } = {}) {
  console.log(`— ${label} —`);
  const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ [site.id]: site })}));localStorage.setItem('planarfit:currentSite:v1','${site.id}');}}catch(e){}})()`);
  const hits = { wfs: 0, tab: 0 };
  await ctx.route(/sdmdataaccess\.sc\.egov\.usda\.gov/, async (route) => {
    const u = route.request().url();
    const cors = { "access-control-allow-origin": "*" };
    if (fail503) { await route.fulfill({ status: 503, headers: cors, body: "down" }); return; }
    if (u.includes(".wfs")) {
      hits.wfs++;
      const f = decodeURIComponent(u).match(/<coordinates>([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)<\/coordinates>/);
      await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/xml" }, body: gml(f.slice(1, 5).map(Number)) });
    } else { hits.tab++; await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(TAB) }); }
  });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-bedrock-paint");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(3500);
  try { await page.locator("button:visible", { hasText: "Layers" }).first().click({ timeout: 4000 }); } catch (_) {}
  await page.waitForTimeout(800);
  const row = page.locator("label:visible", { hasText: "Shallow rock (depth to bedrock)" }).first();
  let present = true; try { await row.waitFor({ state: "visible", timeout: 6000 }); } catch (_) { present = false; }
  check("the Shallow rock row is listed", present);
  if (!present) { await browser.close(); return null; }
  const view = () => page.evaluate(() => { const e = document.querySelector("[data-view-ppf]"); return e ? [e.dataset.viewPpf, e.dataset.viewOffx, e.dataset.viewOffy].join("|") : null; });
  const fills = () => page.evaluate(() => [...document.querySelectorAll(".leaflet-pane svg path")].map((p) => (p.getAttribute("fill") || "").toLowerCase()));
  const before = await view(), f0 = await fills();
  await row.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(6000);
  const after = await view(), f1 = await fills();
  check("NO-MOVE: switching the layer on left the map where it was", before != null && before === after, `${before} → ${after}`);
  const out = { hits, painted: f1.length - f0.length, fills: f1, text: await page.evaluate(() => document.body.innerText) };
  await browser.close();
  return out;
}

const ga = await run("Georgia site (Gwinnett)", mkSite("GA1", 33.95, -84.0, "ga_gwinnett"));
if (ga) {
  check("it requested the WFS and then SDA tabular", ga.hits.wfs > 0 && ga.hits.tab > 0, JSON.stringify(ga.hits));
  check("KNOWN-GOOD: the very-shallow unit (30 cm) DRAWS in its class colour", ga.fills.includes("#7f1d1d"), `${ga.painted} new paths`);
  check("a 110 cm unit draws in the 40–60 in colour", ga.fills.includes("#facc15"));
  check("the deep / no-depth unit is NOT painted (a null is not a 'clear' claim)", ga.painted === 2, `${ga.painted} painted of 3`);
}
const tx = await run("Texas site (Katy) — national layer", mkSite("TX1", 29.7836, -95.8244, "harris"));
if (tx) check("the row is listed and draws on a Texas site too (national)", tx.painted >= 1, `${tx.painted} painted`);
const bad = await run("FAILURE arm — both services answer 503", mkSite("GA2", 33.95, -84.0, "ga_gwinnett"), { fail503: true });
if (bad) {
  check("a failing service paints NOTHING", bad.painted === 0, `${bad.painted}`);
  check("…and the panel says it failed (never a silent clean map)", /fail|couldn.t|unavailable|HTTP 503/i.test(bad.text), (bad.text.match(/[^\n]*(?:HTTP 503|failed)[^\n]*/i) || [""])[0]);
}
if (!ga || !ga.fills.includes("#7f1d1d")) { console.log("VOID — the known-good arm did not draw"); process.exit(2); }
console.log(fail ? `FAIL (${fail})` : "PASS");
process.exit(fail ? 1 : 0);
