/* NEW-1 (FL/GA pipelines) — the real built app, three real sites, four real EIA services.
 *
 * WHAT IT PROVES (each on the RENDERED app, not a module's opinion of itself):
 *   A  a Georgia and a Florida plan offer the four EIA pipeline layers, every one labelled
 *      "(approx.)", with the transmission-only / no-mains / 811 detail behind the ⓘ; a Texas plan
 *      does NOT offer them (they sit in the "not available in Texas" fold);
 *   B  toggling the layers draws real EIA lines at metro Atlanta (gas + petroleum products) and an
 *      empty layer (crude, HGL) says "None mapped in this view — not proof there are none", never
 *      "No features";
 *   C  SCREENING — the load-bearing one: downtown Atlanta has NO EIA line within a mile of the
 *      parcel, and the Analysis panel must say "Not confirmed" + title commitment / ALTA survey /
 *      Georgia 811 — and NEVER "None found" / "No mapped RRC pipelines". A Florida parcel ON a
 *      Florida Gas Transmission line must read Present + Approximate;
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

/* The Analysis panel's Pipelines card, read as the user sees it. The card is a run of lines:
 *   <glyph> / Pipelines / <STATUS> / <summary…> / ▸        — so slice from the "Pipelines" line to the
 * next status glyph line. Never a page-wide grep: the Layers panel (hidden) carries pipeline words too. */
async function settle(page) {
  await page.locator('button[title="Analysis"]').first().click();
  await page.waitForFunction(() => /\nPipelines\n/.test(document.body.innerText) && !/Querying GIS sources/.test(document.body.innerText), null, { timeout: 90000 });
  await page.waitForTimeout(800);
}
const cardOf = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/\nPipelines\n([\s\S]*?)\n(?:[⚠✓ℹ↻⚑○])\n/);
  return m ? m[1] : "";
});
async function pipelinesCard(page) { await settle(page); return cardOf(page); }
async function expandCard(page) {
  await page.locator("text=/^Pipelines$/").filter({ visible: true }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  return cardOf(page);
}

/* ═══ KNOWN-GOOD ARM — independent of the app ═══════════════════════════════════════════════════ */
console.log("\nKnown-good arm (live, outside the browser)");
const flKnown = liveCount(SERVICES.gas, -82.404864, 29.35936);
const gaKnown = liveCount(SERVICES.gas, -84.39, 33.75) + liveCount(SERVICES.petroleum, -84.39, 33.75);
ok("Florida Gas Transmission parcel: live EIA count within a mile is > 0", flKnown > 0, `${flKnown}`);
ok("downtown Atlanta parcel: live EIA count within a mile is 0 (a real no-hit site)", gaKnown === 0, `${gaKnown}`);
if (!(flKnown > 0) || gaKnown !== 0) { console.log("\nVOID — the known-good arms did not report their known values; refusing to score."); await browser.close(); process.exit(2); }

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
  const strokes = await page.evaluate(() => { const c = {}; document.querySelectorAll(".leaflet-overlay-pane path, .leaflet-pane svg path").forEach((p) => { const k = p.getAttribute("stroke"); if (k) c[k] = (c[k] || 0) + 1; }); return c; });
  ok("natural gas lines are DRAWN (its stroke colour is on the map)", (strokes["#c2410c"] || 0) > 0, JSON.stringify(strokes));
  ok("petroleum product lines are DRAWN", (strokes["#a16207"] || 0) > 0);
  const empt = await page.locator(`${PANEL} [data-testid="layer-row-eia_crude"]`).innerText();
  ok("an empty layer (crude) says it is not proof, and never 'No features'", /not proof there are none/i.test(empt) && !/No features/i.test(empt), empt.replace(/\n+/g, " | ").slice(0, 160));
  ok("no page errors", log.errs.length === 0, log.errs.join(" ; ").slice(0, 200));
  await page.screenshot({ path: `${OUT}ga-layers.png` });
  await ctx.close();
}

/* ═══ C (no-hit) + D — Georgia screening ═════════════════════════════════════════════════════════ */
console.log("\nC/D — Georgia screening (downtown Atlanta: no EIA line within a mile)");
{
  const { ctx, page, log } = await open("ga");
  const card = await pipelinesCard(page);
  ok("the pipelines card reads 'Not confirmed'", /Not confirmed/.test(card), card.replace(/\n+/g, " | ").slice(0, 260));
  ok("…and NEVER 'None found' / 'No mapped RRC pipelines'", !/None found|No mapped RRC/i.test(card));
  const full = await expandCard(page);
  ok("the real site checks are named — title commitment, ALTA survey, Georgia 811", /title commitment/i.test(full) && /ALTA survey/i.test(full) && /Georgia 811/.test(full), full.replace(/\n+/g, " | ").slice(0, 400));
  ok("the Texas RRC service was NEVER asked about a Georgia coordinate", log.rrc.length === 0, `${log.rrc.length} request(s)`);
  ok("the EIA services WERE asked", log.eia.some((u) => /Natural_Gas/.test(u)) && log.eia.some((u) => /Petroleum/.test(u)));
  const wells = await page.evaluate(() => document.body.innerText);
  ok("Texas-only wells card is 'Not available in Georgia', not 'No mapped oil & gas wells'", /Not available in Georgia/.test(wells) && !/No mapped oil/i.test(wells));
  await page.screenshot({ path: `${OUT}ga-analysis.png` });
  await ctx.close();
}

/* ═══ C (hit) + D — Florida screening ════════════════════════════════════════════════════════════ */
console.log("\nC/D — Florida screening (parcel on a Florida Gas Transmission line)");
{
  const { ctx, page, log } = await open("fl");
  const card = await pipelinesCard(page);
  ok("KNOWN-GOOD ARM: the pipelines card reads Present", /Present/i.test(card), card.replace(/\n+/g, " | ").slice(0, 300));
  ok("…and is labelled Approximate", /Approximate/i.test(card));
  const full = await expandCard(page);
  ok("the operator is named (Florida Gas Trans)", /Florida Gas Trans/i.test(full));
  ok("Sunshine 811 (Florida's one-call), never Georgia 811", /Sunshine 811/.test(full) && !/Georgia 811/.test(full));
  ok("the Texas RRC service was NEVER asked about a Florida coordinate", log.rrc.length === 0, `${log.rrc.length} request(s)`);
  await page.screenshot({ path: `${OUT}fl-analysis.png` });
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
  await settle(page);
  const text = await page.evaluate(() => document.body.innerText);
  ok("Texas keeps the RRC wording: 'No mapped RRC pipelines crossing the site'", /No mapped RRC pipelines crossing the site/.test(text));
  ok("the Texas RRC service WAS asked", log.rrc.length > 0, `${log.rrc.length} request(s)`);
  ok("no EIA service was asked about a Texas coordinate", log.eia.filter((u) => /\/query/.test(u)).length === 0, log.eia.map((u) => u.slice(62, 200)).join(" ; "));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
