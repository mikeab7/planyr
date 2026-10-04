/* Georgia screening (NEW-1, 2026-10-04) — the Georgia layer set on REAL Georgia sites, and the state-aware panel.
 *
 * Drives the real built app (logged-out, local plans — the sandbox cannot sign in, see V-entry Blocker: auth for the
 * signed-in half) and asserts, per site:
 *   STATE ARM    a Piedmont site (Braselton, I-85, Gwinnett/Jackson line) and a coastal site (Rincon, Effingham Co.)
 *                list the Georgia rows and NONE of the Texas ones (the Texas rows sit behind one collapsed
 *                "not available in Georgia" line);
 *   PAINT ARM    each Georgia layer, turned on over a site placed ON its known feature (the registry's own
 *                fixtures), requests its own host, gets 200, raises no failure toast, and DRAWS;
 *   NO-MOVE ARM  turning layers on never moves the map (the canvas's view numbers are read before and after);
 *   KNOWN-GOOD   a Houston site still lists the Texas rows and none of the Georgia ones, and a Texas row still
 *   ARM          draws — so an instrument that cannot see a drawn layer VOIDS the run instead of scoring it.
 *
 * Needs outbound HTTPS (ArcGIS Online, USGS National Map): set PW_PROXY (defaults to $HTTPS_PROXY). Exits 2 (VOID),
 * never 0, when the network is unreachable. BASE_URL defaults to a local `vite preview`. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PROXY = process.env.PW_PROXY || process.env.HTTPS_PROXY || "";

const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const mkSite = (id, lat, lon, county) => ({
  id, groupId: id, site: `Throwaway ${id}`, name: "Concept A",
  origin: { lat, lon }, county,
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {},
  underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now(),
});

const launch = { executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] };
if (PROXY) launch.args.push("--proxy-server=" + PROXY, "--proxy-bypass-list=localhost;127.0.0.1");
const browser = await chromium.launch(launch);
let fail = 0, voided = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const TEXAS_ROW = /Oil & gas|Pipeline|HCFCD|BKDD|TxDOT|ETJ|MUD\b|CCN|Leaking|growth fault|Harris|Fort Bend|Brookshire|City of Houston/i;
const GA_ROWS = ["Hazardous sites (Georgia EPD)", "Historic places (National Register)", "Cemeteries (incomplete)", "Critical habitat (USFWS)", "Gopher tortoise soils (DNR)", "Trout streams (Georgia DNR)", "Stream buffers (Georgia)", "Slope classes"];

async function open(siteId, site, { watch = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ [siteId]: site })}));localStorage.setItem('planarfit:currentSite:v1','${siteId}');}}catch(e){}})()`);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-georgia-layers");
  const seen = {}; for (const w of watch) seen[w] = [];
  page.on("response", (r) => { for (const w of watch) if (r.url().includes(w)) seen[w].push(r.status()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(3500);
  const btn = page.locator("button:visible", { hasText: "Layers" }).first();
  try { await btn.click({ timeout: 4000 }); } catch (_) {}
  await page.waitForTimeout(800);
  return { ctx, page, seen };
}
const visibleLabels = (page) => page.evaluate(() => [...document.querySelectorAll("label")].filter((l) => l.offsetParent !== null).map((l) => l.innerText.trim()).filter(Boolean));
const viewOf = (page) => page.evaluate(() => { const e = document.querySelector("[data-view-ppf]"); return e ? [e.dataset.viewPpf, e.dataset.viewOffx, e.dataset.viewOffy].join("|") : null; });
const geomCount = (page) => page.evaluate(() => ({
  paths: document.querySelectorAll(".leaflet-pane svg path").length,
  canvases: document.querySelectorAll(".leaflet-pane canvas").length,
  imgs: document.querySelectorAll(".leaflet-pane img.leaflet-image-layer, .leaflet-overlay-pane img").length,
  text: document.body.innerText,
}));

/* ---------- STATE ARM ---------- */
for (const [name, id, lat, lon, county] of [["Piedmont (Braselton, I-85)", "GAP", 34.1099, -83.7632, "ga_gwinnett"], ["Coastal (Rincon, Effingham Co.)", "GAC", 32.2965, -81.2354, "ga_effingham"]]) {
  console.log(`— STATE ARM: ${name} —`);
  const { ctx, page } = await open(id, mkSite(id, lat, lon, county));
  const labels = await visibleLabels(page);
  const text = (await geomCount(page)).text;
  check("the panel opened and lists rows", labels.length > 5, `${labels.length} rows`);
  for (const g of GA_ROWS) check(`lists "${g}"`, labels.some((l) => l.includes(g)));
  check("no Texas row is listed", !labels.some((l) => TEXAS_ROW.test(l)), labels.filter((l) => TEXAS_ROW.test(l)).join(" | "));
  check("the Texas rows are named behind ONE collapsed 'not available in Georgia' line", /not available in Georgia/i.test(text));
  check("national rows remain (FEMA flood, wetlands)", labels.some((l) => /FEMA flood/i.test(l)) && labels.some((l) => /Wetlands/i.test(l)));
  // NO-MOVE ARM — switch on every Georgia row, the view numbers must not change
  const before = await viewOf(page);
  for (const g of GA_ROWS) { const l = page.locator("label:visible", { hasText: g }).first(); try { await l.locator('input[type="checkbox"]').first().check({ timeout: 3000 }); } catch (_) {} }
  await page.waitForTimeout(6000);
  const after = await viewOf(page);
  check("NO-MOVE: turning every Georgia layer on left the map exactly where it was", before != null && before === after, `${before} → ${after}`);
  for (const g of GA_ROWS) { const l = page.locator("label:visible", { hasText: g }).first(); try { await l.locator('input[type="checkbox"]').first().uncheck({ timeout: 3000 }); } catch (_) {} }
  await page.waitForTimeout(1500);
  check("NO-MOVE: …and turning them off did not move it either", (await viewOf(page)) === before);
  await ctx.close();
}

/* ---------- PAINT ARM — each layer over a site ON its known feature (the registry fixtures) ---------- */
const PAINT = [
  ["Hazardous sites (Georgia EPD)", "ga_hsi", -84.4011, 33.7453, "2025_HSI"],
  ["Historic places (National Register)", "ga_nrhp", -84.3894, 33.7503, "nrhp_points_v1"],
  ["Cemeteries (incomplete)", "ga_cem", -84.3734, 33.755, "structures/MapServer/37"],
  ["Critical habitat (USFWS)", "ga_ch", -84.4966, 33.4124, "USFWS_Critical_Habitat"],
  ["Gopher tortoise soils (DNR)", "ga_gt", -84.15, 31.55, "GopherTortoiseSoils"],
  ["Trout streams (Georgia DNR)", "ga_tr", -83.8921, 34.6906, "Georgia_Trout_Streams"],
  ["Stream buffers (Georgia)", "ga_sb", -83.8921, 34.6906, "nhd/MapServer/6"],
  ["Slope classes", "ga_sl", -84.0, 34.05, "3DEPElevation/ImageServer"],
];
for (const [row, id, lon, lat, needle] of PAINT) {
  console.log(`— PAINT ARM: ${row} —`);
  const { ctx, page, seen } = await open(id, mkSite(id, lat, lon, "ga_fulton"), { watch: [needle] });
  const label = page.locator("label:visible", { hasText: row }).first();
  let present = true; try { await label.waitFor({ state: "visible", timeout: 6000 }); } catch (_) { present = false; }
  check("row present", present);
  if (!present) { await ctx.close(); continue; }
  const before = await geomCount(page);
  await label.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(10000);
  const after = await geomCount(page);
  const reached = seen[needle].length > 0;
  if (!reached) { console.log("  VOID — the browser could not reach this layer's host; nothing measured."); voided++; await ctx.close(); continue; }
  check("requested its own service and got 200", seen[needle].some((s) => s === 200), JSON.stringify(seen[needle].slice(0, 6)));
  check("no failure toast", !/layer failed|no vector source|couldn.t load/i.test(after.text), (after.text.match(/[^\n]*(?:layer failed|no vector source|couldn.t load)[^\n]*/i) || [""])[0]);
  const painted = after.paths + after.canvases + after.imgs > before.paths + before.canvases + before.imgs;
  check("it DRAWS over its known feature", painted, `${before.paths}p/${before.canvases}c/${before.imgs}i → ${after.paths}p/${after.canvases}c/${after.imgs}i`);
  await page.screenshot({ path: `/tmp/claude-0/s/ga-${id}.png` });
  await ctx.close();
}

/* ---------- KNOWN-GOOD ARM — Houston ---------- */
console.log("— KNOWN-GOOD ARM: Houston-area site (Katy) —");
{
  const { ctx, page, seen } = await open("TX1", mkSite("TX1", 29.7836, -95.8244, "harris"), { watch: ["Texas_County_Boundaries"] });
  const labels = await visibleLabels(page);
  const text = (await geomCount(page)).text;
  check("Texas rows are listed (Oil & gas wells, Pipelines, County boundaries)", /Oil & gas/i.test(labels.join("|")) && /Pipeline/i.test(labels.join("|")) && labels.some((l) => /^County boundaries/.test(l)));
  check("no Georgia row is listed", !labels.some((l) => GA_ROWS.some((g) => l.includes(g))), "");
  check("the Georgia rows are only ever inside the collapsed \"not available in Texas\" lines (the same way the Colorado and California rows already are)", /not available in Texas/i.test(text));
  const before = await geomCount(page);
  const l = page.locator("label:visible", { hasText: /^County boundaries/ }).first();
  try { await l.locator('input[type="checkbox"]').first().check({ timeout: 4000 }); } catch (_) {}
  await page.waitForTimeout(9000);
  if (!seen.Texas_County_Boundaries.length) { console.log("  VOID — could not reach TxDOT; the known-good arm measured nothing."); voided++; }
  else { const a = await geomCount(page); check("a Texas row still DRAWS (the instrument can see a drawn layer)", a.paths + a.canvases > before.paths + before.canvases); }
  await ctx.close();
}
await browser.close();
if (voided) { console.log(`VOID (${voided} arm(s) could not reach their host)`); process.exit(2); }
console.log(fail ? `FAIL (${fail})` : "PASS");
process.exit(fail ? 1 : 0);
