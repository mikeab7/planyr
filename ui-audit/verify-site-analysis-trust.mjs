/* NEW-1 (2026-10-05) — Site Analysis, rebuilt around TRUSTED VERDICTS. Drives the REAL panel in a real browser.
 *
 * Every GIS answer is mocked at the network edge (page.route) with geometry authored in feet around the site, so the
 * expected severities are known INDEPENDENTLY of the code under test (the known-good arm the harness rules require):
 *   Texas site (1000 ft square):  100-yr floodplain over the WEST half · shaded 0.2% over the EAST half · a wetland ·
 *   a pipeline ~200 ft outside · a well ON the site   →  red · amber · red · amber · red.
 * Then: a forced 503 on the RRC (Couldn't check + Retry), a Colorado site (no RRC verdict, no RRC request),
 * the pill ↔ Layers-panel round trip (and through a reload), the transient row highlight, the persisted call ticks.
 *
 * Run: vite preview on :4173, then `node ui-audit/verify-site-analysis-trust.mjs [--shots <dir>]`.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import fs from "node:fs";

const ORIGIN = process.env.BASE_URL_ORIGIN || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* ── geometry: feet east/north of a site's origin → lng/lat ─────────────────────────────────────── */
const FT_LAT = 364567;
const geo = (lat0, lng0) => {
  const ftLng = FT_LAT * Math.cos((lat0 * Math.PI) / 180);
  const pt = (x, y) => [lng0 + x / ftLng, lat0 + y / FT_LAT];
  const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)];
  return { pt, rect };
};
function siteRecord(id, name, lat, lon) {
  return {
    id, groupId: id, site: name, name: "Plan 1", origin: { lat, lon }, county: "harris",
    parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
    els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
    updatedAt: Date.now(), data: { status: "active" }, status: "active",
  };
}
const TX = { id: "trust-tx", lat: 29.80, lon: -95.00 };
const CO = { id: "trust-co", lat: 39.74, lon: -104.99 };

/* ── mocks ──────────────────────────────────────────────────────────────────────────────────────── */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
function mockFor(lat, lon) {
  const g = geo(lat, lon);
  return {
    flood: { features: [
      { attributes: { FLD_ZONE: "AE", ZONE_SUBTY: "" }, geometry: { rings: [g.rect(-700, -700, 0, 700)] } },
      { attributes: { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }, geometry: { rings: [g.rect(0, -700, 700, 700)] } },
    ] },
    wetlands: { features: [{ attributes: { WETLAND_TYPE: "Freshwater Emergent Wetland" }, geometry: { rings: [g.rect(100, 100, 300, 200)] } }] },
    pipelines: { features: [{ attributes: { OPERATOR: "CHEVRON PIPE LINE COMPANY", COMMODITY_DESCRIPTION: "Crude Oil" }, geometry: { paths: [[g.pt(700, -900), g.pt(700, 900)]] } }] },
    wells: { features: [{ attributes: { API: "4220100001", SYMNUM: 4, GIS_SYMBOL_DESCRIPTION: "Oil Well" }, geometry: { x: g.pt(0, 0)[0], y: g.pt(0, 0)[1] } }] },
  };
}

async function openApp(browser, site, mocks, { rrc = "ok" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(`(() => { try {
    window.__PLANYR_E2E = true;
    if (!localStorage.getItem('planarfit:sites:v1')) {
      localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [site.id]: siteRecord(site.id, site.id, site.lat, site.lon) }))});
      localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
    }
  } catch (e) {} })();`);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-site-analysis-trust");
  const seen = { rrc: 0, nwiExport: 0, urls: [] };
  const state = { rrc };
  await page.route(/^https?:\/\/(?!localhost)/, async (route) => {
    const url = route.request().url();
    const json = (o) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });
    if (url.includes("gis.rrc.texas.gov")) {
      seen.rrc++;
      if (state.rrc === "503") return route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, body: "unavailable" });
      if (/\/13\/query/.test(url)) return json(mocks.pipelines);
      if (/\/1\/query/.test(url)) return json(mocks.wells);
      return json({ features: [] });
    }
    if (url.includes("hazards.fema.gov") && /\/query/.test(url)) return json(mocks.flood);
    if (url.includes("fwsprimary.wim.usgs.gov") && /\/query/.test(url)) return json(/\/(2)\/query/.test(url) ? mocks.wetlands : { features: [] });
    if (/export\?/.test(url)) { if (url.includes("fwsprimary")) seen.nwiExport++; return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }); }
    if (/\/query/.test(url)) return json({ features: [] });
    if (/\.(png|jpe?g|webp)(\?|$)/.test(url) || /\/tile\//.test(url)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
  });
  page.on("request", (r) => seen.urls.push(r.url()));
  await page.goto(`${ORIGIN}/#/project/${site.id}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  return { ctx, page, seen, state };
}
async function openAnalysis(page) {
  await page.locator('button[title="Analysis"]').click();
  await page.waitForSelector('[data-site-analysis="1"]', { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('[data-site-analysis="1"]')?.innerText.includes("Checking the maps"), null, { timeout: 40000 });
  await page.waitForTimeout(400);
}
const rowsOf = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-check-row]")].map((r) => [r.dataset.checkRow, {
  sev: r.dataset.severity, text: r.innerText.replace(/\s+/g, " ").trim(), figure: r.querySelector("[data-check-figure]")?.innerText.trim(),
}])));
const panelText = (page) => page.evaluate(() => document.querySelector('[data-site-analysis="1"]')?.innerText || "");
const layersOn = (page) => page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers().on : null));

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
try {
  /* ═════════════ Texas site ═════════════ */
  const mocks = mockFor(TX.lat, TX.lon);
  const tx = await openApp(browser, TX, mocks);
  const page = tx.page;
  await openAnalysis(page);
  const rows = await rowsOf(page);
  const text = await panelText(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-texas.png` });

  console.log("\n— the five sections —");
  check("sections present, in order: governs · checked · pills · calls", await page.evaluate(() => {
    const order = [...document.querySelectorAll("[data-section]")].map((e) => e.dataset.section);
    return JSON.stringify(order) === JSON.stringify(["governs", "checked", "pills", "calls"]);
  }));
  check("header reads 'N parcel(s) · X AC' and ONE freshness line", /1 parcel · [\d.]+ AC/.test(text) && (text.match(/Checked /g) || []).length === 1, (await page.locator("[data-analysis-freshness]").innerText()).trim());
  check("footer is exactly 'Screening data. Verify before relying on it.'", text.trim().endsWith("Screening data. Verify before relying on it."));
  check("the old chrome is GONE: no banner, no INFO/PRESENT/NONE FOUND badges, no Activate-layer chips", !/constraints? present|NONE FOUND|\bINFO\b|PRESENT|Activate layer/i.test(text));
  check("plain labels: no SFHA / CCN / AADT / Part 77", !/SFHA|CCN|AADT|Part 77/.test(text));
  check("never prints 'sources we trust'", !/sources we trust|we trust/i.test(text));
  check("no per-row ages (rows carry no 'ago')", Object.values(rows).every((r) => !/ ago/.test(r.text)));

  console.log("\n— severities (mock ground truth: AE west half, shaded-X east half, wetland, pipeline 200 ft out, well on site) —");
  check("100-year floodplain RED ≈ 50%", rows.flood100?.sev === "red" && /^(4[7-9]|5[0-3])%$/.test(rows.flood100.figure), JSON.stringify(rows.flood100));
  check("100-year row names the zone and the side", /Zone AE/.test(rows.flood100?.text || "") && /west/.test(rows.flood100?.text || ""));
  check("500-year floodplain AMBER ≈ 50% (shaded X only; not double counted)", rows.flood500?.sev === "amber" && /^(4[7-9]|5[0-3])%$/.test(rows.flood500.figure), JSON.stringify(rows.flood500));
  check("Wetlands RED with acres + count", rows.wetlands?.sev === "red" && /AC · 1/.test(rows.wetlands.figure), rows.wetlands?.figure);
  check("Pipelines AMBER, nearest distance prefixed ~", rows.pipelines?.sev === "amber" && /^~\d+ ft$/.test(rows.pipelines.figure), rows.pipelines?.figure);
  check("Pipelines line names the operator in plain case", /Chevron Pipe Line Company/.test(rows.pipelines?.text || ""));
  check("a pipeline running the WHOLE east side reads 'east', not a corner", /to the east\b/.test(rows.pipelines?.text || "") && !/northeast|southeast/.test(rows.pipelines?.text || ""), rows.pipelines?.text);
  check("Oil & gas wells RED (a well on the site)", rows.wells?.sev === "red" && /on site/.test(rows.wells.figure), rows.wells?.figure);
  check("severity is a thin left bar + figure colour only (no filled card)", await page.evaluate(() => {
    const r = document.querySelector("[data-check-row]"); const cs = getComputedStyle(r);
    return parseFloat(cs.borderLeftWidth) > 0 && (cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent");
  }));

  console.log("\n— click a row: expands in place, one at a time, with source + caveat —");
  await page.locator('[data-check-row="pipelines"] [role="button"]').click();
  let ex = await page.locator('[data-check-expanded]').allInnerTexts();
  check("pipelines expands with 'Routes are approximate. Confirm with 811 and the operator.'", ex.length === 1 && /Routes are approximate\. Confirm with 811 and the operator\./.test(ex[0]), ex[0]?.slice(0, 120));
  await page.locator('[data-check-row="flood100"] [role="button"]').click();
  ex = await page.locator('[data-check-expanded]').allInnerTexts();
  check("opening another closes the first (one open at a time)", ex.length === 1 && /floodplain/i.test(ex[0]) && /Open in Drainage →/.test(ex[0]));
  await page.locator('[data-check-row="flood100"] [role="button"]').click();

  console.log("\n— hover / open highlights the row's layer, transiently (never persisted) —");
  const onBefore = await layersOn(page);
  const nwiBefore = tx.seen.nwiExport;
  await page.locator('[data-check-row="wetlands"]').hover();
  await page.waitForTimeout(2500);
  const onHover = await layersOn(page);
  check("hover does NOT switch the layer on in the saved state", JSON.stringify(onHover) === JSON.stringify(onBefore) && !(onHover || []).includes("wetlands"), JSON.stringify(onHover));
  check("…but the wetlands layer is requested and drawn while hovered", tx.seen.nwiExport > nwiBefore, `NWI exports ${nwiBefore} → ${tx.seen.nwiExport}`);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);

  console.log("\n— Show on the map: pills ↔ Layers panel, both ways, and through a reload —");
  const pillIds = await page.evaluate(() => [...document.querySelectorAll("[data-layer-pill]")].map((e) => e.dataset.layerPill));
  check("Texas pills: power · rail · traffic · contamination · faults (pipelines/wells are verdict rows)", JSON.stringify(pillIds) === JSON.stringify(["power", "rail", "traffic", "contamination", "faults"]), pillIds.join(","));
  check("the muted line is exactly the owner's words", (await panelText(page)).includes("Tap one to turn it on. These come from public maps that are often off, so Planyr doesn't flag them for you."));
  check("pills show no verdict, distance or count", await page.evaluate(() => [...document.querySelectorAll("[data-layer-pill]")].every((e) => !/\d|none|✓/i.test(e.innerText))));
  const railPill = page.locator('[data-layer-pill="rail"]');
  check("rail pill starts off", (await railPill.getAttribute("aria-pressed")) === "false");
  await railPill.click(); await page.waitForTimeout(500);
  check("clicking the pill turns the SAME layer key on (bts_rail)", ((await layersOn(page)) || []).includes("bts_rail"), JSON.stringify(await layersOn(page)));
  check("…and the pill reads pressed", (await railPill.getAttribute("aria-pressed")) === "true");
  // the Layers panel
  const layersBtn = page.getByRole("button", { name: /^Layers/ }).first();
  await layersBtn.click();
  await page.waitForTimeout(800);
  const railRow = page.locator('[data-testid="layer-row-bts_rail"] input[type="checkbox"]').first();
  const haveRow = (await railRow.count()) > 0;
  check("the Layers panel has the rail row", haveRow);
  if (haveRow) {
    check("Layers panel shows it CHECKED (pill → panel)", await railRow.isChecked());
    await railRow.uncheck(); await page.waitForTimeout(500);
    check("unchecking in the Layers panel un-presses the pill (panel → pill)", (await page.locator('[data-layer-pill="rail"]').getAttribute("aria-pressed")) === "false");
    await railRow.check(); await page.waitForTimeout(500);
    check("re-checking in the panel presses it again", (await page.locator('[data-layer-pill="rail"]').getAttribute("aria-pressed")) === "true");
  }
  // contamination = TWO layers behind one pill
  await page.locator('[data-layer-pill="contamination"]').click(); await page.waitForTimeout(500);
  const on2 = (await layersOn(page)) || [];
  check("the contamination pill drives BOTH its layers (env_lpst + env_cleanups)", on2.includes("env_lpst") && on2.includes("env_cleanups"), JSON.stringify(on2));
  await page.locator('[data-layer-pill="contamination"]').click(); await page.waitForTimeout(300);

  console.log("\n— Who governs: Show lines toggles the city limits & ETJ layers —");
  await page.locator('[data-governs-lines]').click(); await page.waitForTimeout(600);
  const lines = (await layersOn(page)) || [];
  check("'Show lines' turns on BOTH city-limits layers (jur_city + jur_etj)", lines.includes("jur_city") && lines.includes("jur_etj"), JSON.stringify(lines));
  check("…and the link now reads 'Hide lines'", /Hide lines/.test(await page.locator('[data-governs-lines]').innerText()));
  await page.locator('[data-governs-lines]').click(); await page.waitForTimeout(400);

  console.log("\n— Calls to make: ticks persist per site —");
  const callIds = await page.evaluate(() => [...document.querySelectorAll("[data-call]")].map((e) => e.dataset.call));
  check("power service is always offered", callIds.includes("power"), callIds.join(","));
  check("811 prompt appears because the pipeline row is amber", callIds.includes("pipelines-811"));
  await page.locator('[data-call="power"] input').check();
  await page.waitForTimeout(2500); // autosave
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2500);
  await openAnalysis(page);
  check("after a reload the tick is still there", await page.locator('[data-call="power"] input').isChecked());
  check("and the rail layer (pill ↔ panel) survived the reload", (await page.locator('[data-layer-pill="rail"]').getAttribute("aria-pressed")) === "true", "persisted through the plan's saved layer overrides");

  console.log("\n— FAILURE: the RRC answers 503 → 'Couldn't check', never None/green; Retry recovers —");
  await tx.ctx.close();
  const bad = await openApp(browser, { ...TX, id: "trust-tx2" }, mocks, { rrc: "503" });
  await openAnalysis(bad.page);
  const brows = await rowsOf(bad.page);
  check("pipelines + wells read 'Couldn't check' (failed), not green, not None", ["pipelines", "wells"].every((k) => brows[k]?.sev === "failed" && /Couldn't check/.test(brows[k].figure) && !/None/.test(brows[k].text)), JSON.stringify([brows.pipelines?.sev, brows.wells?.sev]));
  check("…while FEMA + NWI still answer (one source's outage doesn't take the rest down)", brows.flood100?.sev === "red" && brows.wetlands?.sev === "red");
  check("each failed row offers Retry", (await bad.page.locator("[data-check-retry]").count()) === 2);
  if (SHOTS) await bad.page.screenshot({ path: `${SHOTS}/after-failure.png` });
  bad.state.rrc = "ok";
  await bad.page.locator('[data-check-retry="pipelines"]').click();
  await bad.page.waitForFunction(() => document.querySelector('[data-check-row="pipelines"]')?.dataset.severity !== "failed", null, { timeout: 30000 });
  const after = await rowsOf(bad.page);
  check("Retry re-asks and the pipelines row resolves (amber ~distance); wells stays 'Couldn't check' until retried", after.pipelines?.sev === "amber" && after.wells?.sev === "failed", JSON.stringify([after.pipelines?.sev, after.wells?.sev]));
  await bad.ctx.close();

  /* ═════════════ Colorado site ═════════════ */
  console.log("\n— REGION GATE: a Colorado site gets no RRC verdict and no RRC request —");
  const co = await openApp(browser, CO, mockFor(CO.lat, CO.lon));
  await openAnalysis(co.page);
  const crows = await rowsOf(co.page);
  check("Colorado: exactly the three national checks (100-yr, 500-yr, wetlands)", JSON.stringify(Object.keys(crows)) === JSON.stringify(["flood100", "flood500", "wetlands"]), Object.keys(crows).join(","));
  check("Colorado: the Texas Railroad Commission is never contacted", co.seen.rrc === 0, `${co.seen.rrc} requests`);
  const cpills = await co.page.evaluate(() => [...document.querySelectorAll("[data-layer-pill]")].map((e) => e.dataset.layerPill));
  check("Colorado pills: no faults (Texas-only layer), no wells pill (ECMC unwired)", !cpills.includes("faults") && !cpills.includes("wells"), cpills.join(","));
  check("Colorado: no 811 prompt (no pipeline verdict)", !(await co.page.locator('[data-call="pipelines-811"]').count()));
  if (SHOTS) await co.page.screenshot({ path: `${SHOTS}/after-colorado.png` });
  await co.ctx.close();
} finally {
  await browser.close();
}
console.log(failed ? `\n❌ ${failed} check(s) FAILED` : "\n✅ all checks passed");
process.exit(failed ? 1 : 0);
