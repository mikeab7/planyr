/* NEW-1 (FL/GA pipelines) — the real built app, three real sites, four real EIA services.
 *
 * WHAT IT PROVES (each on the RENDERED app, not a module's opinion of itself):
 *   A  a Georgia and a Florida plan offer the four EIA pipeline layers, every one labelled
 *      "(approx.)", with the transmission-only / no-mains / 811 detail behind the ⓘ; a Texas plan
 *      does NOT offer them (they sit in the "not available in Texas" fold);
 *   B  toggling the layers draws real EIA lines at metro Atlanta (gas + petroleum products) and an
 *      empty layer (crude, HGL) says "None mapped in this view — not proof there are none", never
 *      "No features";
 *   C  SCREENING — since the Site Analysis redesign (B2117136) Pipelines in FL/GA is a "SHOW ON THE MAP —
 *      check these yourself" pill with NO verdict, so the rendered arm asserts exactly that (no "Present" /
 *      "Not confirmed" / "None" on the Pipelines row) and the screen's own answer is proven against the live
 *      service: a Florida parcel ON a Florida Gas Transmission line (count > 0), downtown Atlanta (0), and the
 *      owner's Georgia project — its STORED parcels (0 within a mile of FID 23971) vs the envelope quoted in
 *      the 2026-10-05 report (the line crosses it) — see also test/eiaPipelineGeorgia.test.js (PLANYR_LIVE_EIA=1);
 *   E  STYLE (NEW-2) — every EIA layer's rendered stroke is its Texas-commodity colour; Leaflet's default
 *      #3388ff appears on NONE of them (it did, on lines fetched after the first opacity write);
 *   D  ROUTING — the Texas RRC service is never asked about a Florida/Georgia coordinate, the EIA
 *      services are never asked about a Texas one, and Texas keeps its verified "No mapped RRC
 *      pipelines crossing the site" wording.
 *
 * HOW IT REACHES THE EIA SERVICES. This sandbox's Chromium cannot open any remote origin (see
 * verify-admin-boundaries.mjs), but `curl` can, through the egress proxy. So every request the page
 * makes to the EIA-republication org (services2.arcgis.com/FiaPA4ga0iQKduv3) is RELAYED through curl to
 * the LIVE service and the real bytes are handed back — the app is exercising real EIA answers, only
 * the transport differs. The Texas RRC host is answered with an empty result (no relay needed: the
 * Texas assertions are about WHICH service is asked and what an empty answer reads as).
 * ⚠ What that cannot prove: CORS from a real planyr.io origin (checked separately by header —
 * `access-control-allow-origin: *` — recorded on the PR) and how the lines read over live aerial.
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the Florida "hit" parcel sits on a line whose
 * answer is known independently (a live `distance` count > 0 taken with curl before the page is
 * opened). If that arm does not report Present the run is VOID, not scored.
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-eia-pipelines.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = [process.env.PW_CHROME, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));
const OUT = new URL("./screens/eia-pipelines/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const EIA = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services";
const SERVICES = {
  gas: `${EIA}/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0`,
  petroleum: `${EIA}/Petroleum_Products_Pipelines_1/FeatureServer/0`,
};

const results = [];
const ok = (label, cond, extra = "") => {
  results.push(!!cond);
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

const sq = (ft) => [{ x: 0, y: 0 }, { x: ft, y: 0 }, { x: ft, y: ft }, { x: 0, y: ft }];
const plan = (id, name, lat, lon, county) => ({
  schemaVersion: 12, id, groupId: id, site: name, name: "Plan A", updatedAt: 1786000000000,
  teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat, lon }, county, status: "active",
  parcels: [{ id: `${id}p`, points: sq(600), active: true, z: 0 }],
  els: [], measures: [], callouts: [], markups: [], sheetOverlays: [], parcelDrawings: [], underlay: null, settings: {},
});
const SITES = {
  ga: plan("ga1", "Atlanta GA", 33.75, -84.39, "ga_fulton"),                 // no EIA line within a mile
  fl: plan("fl1", "Marion FL", 29.35936, -82.404864, "fl_marion"),            // ON a Florida Gas Transmission line
  tx: plan("tx1", "Mont Belvieu TX", 29.846, -94.886, "chambers"),
};

/* Known-good arm: the live answer for the FL parcel, taken OUTSIDE the browser. */
function liveCount(serviceUrl, lng, lat, meters = 1609) {
  const out = execFileSync("curl", ["-sS", "-m", "40", `${serviceUrl}/query`,
    "--data-urlencode", `geometry=${lng},${lat}`,
    "-d", `geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=${meters}&units=esriSRUnit_Meter&returnCountOnly=true&f=json`]);
  return JSON.parse(out.toString()).count;
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function open(key) {
  const site = SITES[key];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); localStorage.setItem("planarfit:relevance:v1", JSON.stringify({ mode: "all", radius: 2.5 })); } catch (_) {} }, JSON.stringify({ [site.id]: site }));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-eia-pipelines");
  const log = { eia: [], rrc: [], errs: [] };
  page.on("pageerror", (e) => log.errs.push(String(e)));
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (route) => {
    const req = route.request(); const url = req.url();
    if (/services2\.arcgis\.com\/FiaPA4ga0iQKduv3/.test(url)) {
      // The org also hosts the pre-existing HIFLD electric-transmission row — relay it, but only the four
      // PIPELINE services count as "EIA" for the routing assertions.
      if (/Natural_Gas_Interstate|Petroleum_Products|Crude_Oil_Trunk|Hydrocarbon_Gas_Liquids/.test(url)) log.eia.push(url);
      try {
        const args = ["-sS", "-m", "40", url];
        if (req.method() === "POST") args.splice(2, 0, "--data-binary", req.postData() || "", "-H", "Content-Type: application/x-www-form-urlencoded");
        const body = execFileSync("curl", args, { maxBuffer: 50 * 1024 * 1024 });
        return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body });
      } catch (_) { return route.abort(); }
    }
    if (/gis\.rrc\.texas\.gov/.test(url)) {
      log.rrc.push(url);
      return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ features: [], count: 0 }) });
    }
    return route.abort();
  });
  await page.goto(`${BASE}#/site-planner`, { waitUntil: "load" });
  await page.getByText(site.site, { exact: false }).first().click();
  await page.getByTestId("planner-canvas").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  return { ctx, page, log };
}

const PANEL = '[data-testid="layer-panel"][data-surface="planner"]';
async function openLayers(page) {
  await page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).filter({ visible: true }).first().click();
  await page.locator(PANEL).waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
}
const eiaRows = (page) => page.locator(`${PANEL} [data-testid^="layer-row-eia_"]`);

/* ═══ KNOWN-GOOD ARM — independent of the app ═══════════════════════════════════════════════════ */
console.log("\nKnown-good arm (live, outside the browser)");
const flKnown = liveCount(SERVICES.gas, -82.404864, 29.35936);
const gaKnown = liveCount(SERVICES.gas, -84.39, 33.75) + liveCount(SERVICES.petroleum, -84.39, 33.75);
ok("Florida Gas Transmission parcel: live EIA count within a mile is > 0", flKnown > 0, `${flKnown}`);
ok("downtown Atlanta parcel: live EIA count within a mile is 0 (a real no-hit site)", gaKnown === 0, `${gaKnown}`);
/* The owner's Georgia project. Stored parcels (plan smun2bc1cvzu, origin 34.3876/-84.9096) → bbox below; the envelope
 * quoted in the 2026-10-05 report is a different piece of ground the line does cross. Independent of the app. */
const bboxCount = (serviceUrl, [x0, y0, x1, y1], miles) => JSON.parse(execFileSync("curl", ["-sS", "-m", "40", `${serviceUrl}/query`,
  "--data-urlencode", `geometry=${JSON.stringify({ xmin: x0, ymin: y0, xmax: x1, ymax: y1, spatialReference: { wkid: 4326 } })}`,
  "-d", `geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=${miles}&units=esriSRUnit_StatuteMile&returnCountOnly=true&f=json`]).toString()).count;
const GA_STORED = [-84.91895, 34.37821, -84.90030, 34.39709], GA_QUOTED = [-85.020, 34.409, -84.979, 34.451];
const gaStored1 = bboxCount(SERVICES.gas, GA_STORED, 1), gaQuoted1 = bboxCount(SERVICES.gas, GA_QUOTED, 1);
ok("Georgia project, STORED parcels: no EIA gas line within a mile (so 'Not confirmed' is the right answer)", gaStored1 === 0, `${gaStored1}`);
ok("Georgia project, QUOTED envelope: FID 23971 is within a mile (so a screen there must say Present)", gaQuoted1 > 0, `${gaQuoted1}`);
if (!(flKnown > 0) || gaKnown !== 0 || gaStored1 !== 0 || !(gaQuoted1 > 0)) { console.log("\nVOID — the known-good arms did not report their known values; refusing to score."); await browser.close(); process.exit(2); }

/* ═══ A + B — Georgia: layers offered, labelled, draw ═══════════════════════════════════════════ */
console.log("\nA/B — Georgia plan: the four layers");
{
  const { ctx, page, log } = await open("ga");
  await openLayers(page);
  const rows = await eiaRows(page).evaluateAll((els) => els.map((e) => ({ id: e.dataset.testid.replace("layer-row-", ""), text: e.innerText })));
  ok("all four EIA rows are offered on a Georgia plan", rows.length === 4, rows.map((r) => r.id).join(","));
  ok("every row is labelled approximate", rows.every((r) => /approx\./i.test(r.text)));
  const panelText = await page.locator(PANEL).innerText();
  ok("Texas-only layers are demoted with the state named ('not available in Georgia')", /not available in Georgia/.test(panelText));

  // ⓘ detail for the petroleum row — read the popover's own text
  const infoBtn = page.locator(`${PANEL} [data-testid="layer-row-eia_petroleum"] button`).filter({ hasText: "ⓘ" }).first();
  await infoBtn.click();
  await page.waitForTimeout(400);
  const infoText = await page.evaluate(() => document.body.innerText);
  ok("ⓘ names 'transmission lines only' and 'no local gas mains or gathering lines'", /transmission lines only/i.test(infoText) && /no local gas mains or gathering lines/i.test(infoText));
  ok("ⓘ points at the title commitment, an ALTA survey and Georgia 811 (not Florida's)", /title commitment/i.test(infoText) && /ALTA survey/i.test(infoText) && /Georgia 811/.test(infoText));
  await infoBtn.click().catch(() => {});

  for (const id of ["eia_gas", "eia_petroleum", "eia_crude", "eia_hgl"]) {
    await page.locator(`${PANEL} [data-testid="layer-row-${id}"] input[type=checkbox]`).first().check();
  }
  await page.waitForTimeout(6000);
  const strokes = await page.evaluate(() => { const c = {}; document.querySelectorAll(".leaflet-gisLine-pane path").forEach((p) => { const k = (p.getAttribute("stroke") || "").toLowerCase(); if (k) c[k] = (c[k] || 0) + 1; }); return c; });
  ok("E: natural gas lines are DRAWN in the Texas natural-gas colour", (strokes["#ef9f27"] || 0) > 0, JSON.stringify(strokes));
  ok("E: petroleum product lines are DRAWN in the Texas refined-products colour", (strokes["#1d9e75"] || 0) > 0);
  ok("E: NO line on the map is Leaflet's default #3388ff (lines fetched after the opacity write used to be)", !strokes["#3388ff"], `${strokes["#3388ff"] || 0}`);
  const widths = await page.evaluate(() => [...document.querySelectorAll(".leaflet-gisLine-pane path")].filter((p) => (p.getAttribute("stroke") || "").toLowerCase() === "#ef9f27").map((p) => p.getAttribute("stroke-width")));
  ok("E: …and at the constraint-tier weight", widths.length > 0 && widths.every((w) => w === "3"), widths.join(","));
  const empt = await page.locator(`${PANEL} [data-testid="layer-row-eia_crude"]`).innerText();
  ok("an empty layer (crude) says it is not proof, and never 'No features'", /not proof there are none/i.test(empt) && !/No features/i.test(empt), empt.replace(/\n+/g, " | ").slice(0, 160));
  ok("no page errors", log.errs.length === 0, log.errs.join(" ; ").slice(0, 200));
  await page.screenshot({ path: `${OUT}ga-layers.png` });
  await ctx.close();
}

/* ═══ C + D — Georgia / Florida Site Analysis: Pipelines is a map pill, not a verdict ═══════════ */
const PIPE_ROW = (t) => { const m = t.match(/SHOW ON THE MAP[\s\S]*?\n(Pipelines)\n/); return m ? m[1] : null; };
for (const key of ["ga", "fl"]) {
  console.log(`\nC/D — ${key === "ga" ? "Georgia" : "Florida"} Site Analysis`);
  const { ctx, page, log } = await open(key);
  await page.locator('button[title="Analysis"]').first().click();
  await page.waitForFunction(() => /SHOW ON THE MAP/.test(document.body.innerText), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const t = await page.evaluate(() => document.body.innerText);
  ok("Pipelines is offered under 'SHOW ON THE MAP — check these yourself'", PIPE_ROW(t) === "Pipelines");
  ok("…the panel says it does not flag them for you", /doesn't flag them for you/.test(t));
  const mapSec = t.slice(t.search(/SHOW ON THE MAP/), t.search(/CALLS TO MAKE/));
  ok("…and carries NO pipeline verdict (no Present / Not confirmed / None found / No mapped)", !/Present|Not confirmed|None found|No mapped/i.test(mapSec), mapSec.replace(/\n+/g, " | ").slice(0, 200));
  ok("the Texas RRC service was NEVER asked about this coordinate", log.rrc.length === 0, `${log.rrc.length} request(s)`);
  await page.screenshot({ path: `${OUT}${key}-analysis.png` });
  await ctx.close();
}

/* ═══ Texas regression ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nTexas — unchanged");
{
  const { ctx, page, log } = await open("tx");
  await openLayers(page);
  const rows = await eiaRows(page).count();
  ok("the EIA layers are NOT offered on a Texas plan", rows === 0, `${rows} row(s)`);
  ok("the authoritative Texas pipeline layer still is", (await page.locator(`${PANEL} [data-testid="layer-row-txrrc_pipe"]`).count()) === 1);
  await page.locator('button[title="Analysis"]').first().click();
  await page.waitForFunction(() => /CHECKED FOR YOU/.test(document.body.innerText) && !/Checking the maps/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => document.body.innerText);
  const checked = text.slice(text.search(/CHECKED FOR YOU/), text.search(/SHOW ON THE MAP|CALLS TO MAKE/));
  ok("Texas keeps a TRUSTED Pipelines check under 'CHECKED FOR YOU' (RRC permit routes)", /Pipelines/.test(checked), checked.replace(/\n+/g, " | ").slice(0, 200));
  ok("the Texas RRC service WAS asked", log.rrc.length > 0, `${log.rrc.length} request(s)`);
  ok("no EIA service was asked about a Texas coordinate", log.eia.filter((u) => /\/query/.test(u)).length === 0, log.eia.map((u) => u.slice(62, 200)).join(" ; "));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
