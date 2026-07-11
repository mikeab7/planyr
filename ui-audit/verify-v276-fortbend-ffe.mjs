/**
 * V276 / B773 (provisional B759) — Fort Bend MULTI-BASIS FFE display, headless.
 *
 * Drives the REAL built app (GIS mocked at the network layer — same discipline as
 * verify-b629-detention.mjs; this sandbox's egress proxy resets Chromium's tunneled
 * TLS so live GIS can't run here) on a Fort Bend site and asserts:
 *   1. PASS  — FloodMitigationCard shows "Required FFE 96.5′ (FEMA FIRM BFE (18 in)
 *              + 1.5′) — pad PASSES" (governing basis named), AND the pending-bases
 *              copy lists every un-computed basis (Atlas-14 / pre-Atlas-14 / 500-yr /
 *              Zone-A / outside-SFHA) — never dropped.
 *              PDF-PARITY: the composed print sheet (captured via a Blob hook on the
 *              real exportPDF path) carries "Required FFE 96.5 ft (max-of — more
 *              bases pending)".
 *   2. SHORT — pad 95 vs required 96.5 → the ⚠ "Pad FFE is 1.5′ SHORT of the
 *              required 96.5′ (…)" line; sheet shows "(pad 1.5 ft short)".
 *   3. no_rule — a Montgomery site (no FFE rule modeled) → the card's honest
 *              "Required FFE unknown — no FFE rule modeled …" AND the sheet's
 *              "Required FFE  no rule modeled" pair (PDF-PARITY for the fallback).
 *
 * Scenario: 40-ac square Fort Bend parcel (Rosenberg-ish origin), one building,
 * FEMA AE zone with STATIC_BFE 95 (NAVD88), ground 100 (3DEP mock 30.48 m).
 * Only the wse1pct (FIRM BFE) basis is computable → governing = 95 + 1.5 = 96.5;
 * the other five bases surface as pending.
 *
 * Run:  npm run build && npx vite preview --port 4173  (background), then
 *       BASE_URL=http://localhost:4173/ node ui-audit/verify-v276-fortbend-ffe.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660; // 1320' square = 40.00 ac
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const BUILDING = { id: "b1", type: "building", cx: 0, cy: 0, w: 400, h: 180, rot: 0 };

const mkSite = ({ county, padFfeFt }) => ({
  s_v276: {
    id: "s_v276", groupId: "s_v276", site: "V276 FFE Site", name: "Plan 1", status: "active",
    origin: county === "fortbend" ? { lat: 29.60, lon: -95.77 } : { lat: 30.35, lon: -95.48 },
    county,
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [BUILDING], measures: [], callouts: [], markups: [],
    deletedIds: [],
    settings: { showSetback: false, floodMitigation: padFfeFt != null ? { padFfeFt } : {} },
    underlay: null, updatedAt: Date.now(),
  },
});
const seedFor = (site) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_v276');
} catch (e) {} })();`;

// Capture every SVG-typed Blob the page builds — exportPDF composes the print sheet
// into `new Blob([sheetSvg], { type: "image/svg+xml" })`, so the LAST svg blob is the
// exact sheet the PDF rasterizes (parity read on the true export artifact).
const BLOB_HOOK = `(() => {
  window.__sheetSvgs = [];
  const Orig = window.Blob;
  window.Blob = function (parts, opts) {
    try {
      if (opts && /svg/.test(String(opts.type)) && parts && typeof parts[0] === "string") window.__sheetSvgs.push(parts[0]);
    } catch (e) {}
    return new Orig(parts, opts);
  };
  window.Blob.prototype = Orig.prototype;
})();`;

// An AE polygon that fully covers each seeded site (esri rings, lon/lat — the raw
// ArcGIS shape vectorLayers.toGeoJSON converts). Without geometry the zone list is
// empty and the FFE's governing BFE can't compute (fmGoverningBfe reads zone rings).
const AE_RING = (lon, lat) => [[[lon - 0.02, lat - 0.02], [lon + 0.02, lat - 0.02], [lon + 0.02, lat + 0.02], [lon - 0.02, lat + 0.02], [lon - 0.02, lat - 0.02]]];

const mocksFor = (countyName, fips, origin) => [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: countyName, FIPS_ST_CNTY_CD: fips } }] }],
  ["Texas_City_Boundaries", { features: [] }],
  ["HGAC_City_ETJ", { features: [] }],
  ["TCEQ_Water_Districts", { features: [] }],
  ["NFHL", { features: [{ attributes: { FLD_ZONE: "AE", ZONE_SUBTY: null, STATIC_BFE: 95, V_DATUM: "NAVD88" }, geometry: { rings: AE_RING(origin.lon, origin.lat) } }] }],
  ["HCFCD/Channels", { features: [] }],
  ["HCFCD/Watershed", { features: [] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "30.48" })) }],
];

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

async function openAndCheck(browser, { county, fips, countyName, padFfeFt }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  const siteObj = mkSite({ county, padFfeFt });
  await ctx.addInitScript(seedFor(siteObj));
  await ctx.addInitScript(BLOB_HOOK);
  for (const [needle, payload] of mocksFor(countyName, fips, siteObj.s_v276.origin)) {
    await ctx.route(`**${needle}**`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) }));
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 });
  // Yield → run the explicit drainage check (the card's data is button-gated).
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  const checkBtn = page.getByRole("button", { name: /Check drainage criteria/ });
  await checkBtn.waitFor({ timeout: 8000 });
  await checkBtn.click();
  await page.getByText("Detention required", { exact: false }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  // Site Analysis → the FloodMitigationCard.
  await page.getByRole("button", { name: "Analysis", exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  return { ctx, page, text };
}

// Enter print mode and click Download PDF; return the LAST captured sheet SVG string.
async function captureSheet(page) {
  await page.getByRole("button", { name: /^File/ }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
  await page.waitForTimeout(3500);
  return page.evaluate(() => (window.__sheetSvgs && window.__sheetSvgs.length ? window.__sheetSvgs[window.__sheetSvgs.length - 1] : null));
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ── 1. Fort Bend, pad 98 → PASS + pending list + sheet parity ───────────────
  console.log("· Fort Bend / pad FFE 98 (PASS + pending bases + PDF parity)");
  {
    const { ctx, page, text: t } = await openAndCheck(browser, { county: "fortbend", fips: "48157", countyName: "Fort Bend", padFfeFt: 98 });
    expect("card names the governing basis: Required FFE 96.5′ (FEMA FIRM BFE (18 in) + 1.5′)",
      /Required FFE/.test(t) && /96\.5′ \(FEMA FIRM BFE \(18 in\) \+ 1\.5′\)/.test(t), t.match(/Required FFE[^—]*—?[^.]{0,40}/)?.[0]);
    expect("pad PASSES verdict renders", /pad PASSES/.test(t));
    expect("pending-bases copy: 'must clear the HIGHEST of several bases'", /must clear the HIGHEST of several bases/.test(t));
    expect("pending list names Atlas-14 100-yr WSE +2′", /Atlas-14 100-yr WSE \+2′/.test(t));
    expect("pending list names pre-Atlas-14 100-yr / legacy pond +2.5′", /pre-Atlas-14 100-yr WSE \/ legacy pond \+2\.5′/.test(t));
    expect("pending list names pre-Atlas-14 500-yr WSE +2′", /pre-Atlas-14 500-yr WSE \+2′/.test(t));
    expect("pending list names Zone A estimated BFE +4′", /Zone A estimated BFE \(no data\) \+4′/.test(t));
    expect("pending list names the outside-SFHA site basis +2′", /outside SFHA: pond 100-yr WSE \/ top of curb \/ natural ground \+2′/.test(t));
    expect("Fort Bend fill-to-elevate pathway note renders", /fill-to-elevate is allowed with mitigation/.test(t) || /Fort Bend County: fill/.test(t));
    const sheet = await captureSheet(page);
    expect("print sheet captured off the real exportPDF path", !!sheet, sheet ? `${sheet.length} chars` : "no svg blob seen");
    if (sheet) {
      expect("PDF-PARITY: sheet carries 'Required FFE' = '96.5 ft (max-of — more bases pending)'",
        /Required FFE/.test(sheet) && /96\.50? ft \(max-of — more bases pending\)/.test(sheet),
        (sheet.match(/Required FFE[^<]{0,80}/) || sheet.match(/96\.5[^<]{0,60}/) || []).toString().slice(0, 100));
    }
    await ctx.close();
  }

  // ── 2. Fort Bend, pad 95 → SHORT by 1.5 ────────────────────────────────────
  console.log("· Fort Bend / pad FFE 95 (SHORT)");
  {
    const { ctx, page, text: t } = await openAndCheck(browser, { county: "fortbend", fips: "48157", countyName: "Fort Bend", padFfeFt: 95 });
    expect("SHORT warning: 'Pad FFE is 1.5′ SHORT of the required 96.5′ (FEMA FIRM BFE (18 in) + 1.5′)'",
      /Pad FFE is 1\.5′ SHORT of the required 96\.5′ \(FEMA FIRM BFE \(18 in\) \+ 1\.5′\)/.test(t), t.match(/Pad FFE[^.]{0,90}/)?.[0]);
    expect("pending-bases copy still renders alongside the SHORT verdict", /must clear the HIGHEST of several bases/.test(t));
    const sheet = await captureSheet(page);
    if (sheet) {
      expect("PDF-PARITY: sheet shows '96.5 ft (pad 1.5 ft short) (max-of — more bases pending)'",
        /96\.50? ft \(pad 1\.50? ft short\) \(max-of — more bases pending\)/.test(sheet),
        (sheet.match(/Required FFE[^<]{0,90}/) || []).toString().slice(0, 110));
    } else expect("print sheet captured (SHORT pass)", false);
    await ctx.close();
  }

  // ── 3. Montgomery → no_rule honest fallback, card + sheet ──────────────────
  console.log("· Montgomery (no FFE rule modeled → no_rule, card + sheet parity)");
  {
    const { ctx, page, text: t } = await openAndCheck(browser, { county: "montgomery", fips: "48339", countyName: "Montgomery", padFfeFt: 98 });
    expect("card: 'Required FFE unknown — no FFE rule modeled for this jurisdiction'",
      /Required FFE unknown — no FFE rule modeled for this jurisdiction/.test(t), t.match(/Required FFE[^.]{0,80}/)?.[0]);
    const sheet = await captureSheet(page);
    if (sheet) {
      expect("PDF-PARITY: sheet carries 'Required FFE' = 'no rule modeled'",
        /Required FFE/.test(sheet) && /no rule modeled/.test(sheet),
        (sheet.match(/Required FFE[^<]{0,60}/) || []).toString().slice(0, 80));
    } else expect("print sheet captured (no_rule pass)", false);
    await ctx.close();
  }

  await browser.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("harness error:", e); process.exit(1); });
