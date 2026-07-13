/**
 * B807 — FBCDD Atlas-14 100-yr DRAFT WSE provider (`derivedWse1pctFt`), headless.
 *
 * Drives the REAL built app (GIS mocked at the network layer — the
 * verify-v276-fortbend-ffe.mjs discipline) on an UNSTUDIED ZONE A Fort Bend site
 * (the Bain class: NFHL publishes no BFE/S_BFE/S_XS, so pre-B807 the 1% band could
 * never price) and asserts:
 *   1. PRICED — the per-watershed 100YR getSamples mock returns 96.0 → the
 *      mitigation ledger prices +X ac-ft with ZERO manual inputs; the providers
 *      line reads `1% WSE derived (FBCDD study — DRAFT)`; the ⚑ card note names
 *      the value + watershed; the footer carries DERIVED_WSE100_DRAFT_NOTE; the
 *      yield row tags "DRAFT Atlas-14 100-yr" with its loud note. Variant (b):
 *      the FFE computes off the atlas14_100yr basis (96+2 = 98, labeled) with the
 *      DRAFT caveat. PDF-PARITY: the sheet (Blob hook on the real exportPDF path)
 *      carries "(1% from DRAFT Atlas-14 study — basis is the effective floodplain)"
 *      and "(Atlas-14 100-yr WSE — DRAFT study)".
 *   2. OUT-OF-COUNTY — a Montgomery site makes NO FBCDD call (county gate + empty
 *      candidate route) and shows no DRAFT copy.
 *   3. OUTAGE (LOUD-FAILURE) — the 100YR mock 503s → the card's "server didn't
 *      answer" banner renders and mitigation reads UNKNOWN (never a value).
 *
 * Scenario: 40-ac Fort Bend parcel at the Oyster Creek fixture point, one building,
 * NFHL Zone A (SFHA, no STATIC_BFE), ground 90 ft (3DEP mock 27.432 m), FBCDD 0.2%
 * mosaic out-of-coverage (empty) so the 100-yr draft is the ONLY water surface.
 *
 * Run:  npm run build && npx vite preview --port 4173  (background), then
 *       BASE_URL=http://localhost:4173/ node ui-audit/verify-b807-zonea-draft100.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660; // 1320' square = 40.00 ac
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const BUILDING = { id: "b1", type: "building", cx: 0, cy: 0, w: 400, h: 180, rot: 0 };

// Fort Bend origin = the Oyster Creek registry fixture point (inside the baked
// Oyster/BZ-River/San-Bernard extents, so the multiplex router finds candidates).
const ORIGINS = { fortbend: { lat: 29.648, lon: -95.6895 }, montgomery: { lat: 30.35, lon: -95.48 } };

const mkSite = ({ county }) => ({
  s_b807: {
    id: "s_b807", groupId: "s_b807", site: "B807 Zone A Site", name: "Plan 1", status: "active",
    origin: ORIGINS[county],
    county,
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [BUILDING], measures: [], callouts: [], markups: [],
    deletedIds: [],
    settings: { showSetback: false, floodMitigation: {} }, // ZERO manual inputs — the point of B807
    underlay: null, updatedAt: Date.now(),
  },
});
const seedFor = (site) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_b807');
} catch (e) {} })();`;

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

// An UNSTUDIED ZONE A polygon fully covering the site — SFHA true, NO static BFE.
const A_RING = (lon, lat) => [[[lon - 0.02, lat - 0.02], [lon + 0.02, lat - 0.02], [lon + 0.02, lat + 0.02], [lon - 0.02, lat + 0.02], [lon - 0.02, lat - 0.02]]];

const mocksFor = (countyName, fips, origin, { wse100 = "96.0", wse100Status = 200 } = {}) => [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: countyName, FIPS_ST_CNTY_CD: fips } }] }],
  ["Texas_City_Boundaries", { features: [] }],
  ["HGAC_City_ETJ", { features: [] }],
  ["TCEQ_Water_Districts", { features: [] }],
  ["NFHL", { features: [{ attributes: { FLD_ZONE: "A", ZONE_SUBTY: null, SFHA_TF: "T", STATIC_BFE: -9999 }, geometry: { rings: A_RING(origin.lon, origin.lat) } }] }],
  ["HCFCD/Channels", { features: [] }],
  ["HCFCD/Watershed", { features: [] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "27.432" })) }], // 90 ft — BELOW the 96 draft WSE so depth prices
  ["500YR_WSE/ImageServer/getSamples", { samples: [{ value: "", resolution: 12 }] }], // 0.2% mosaic: out of coverage
  // B807 — every per-watershed 100YR raster answers empty by default (registered
  // FIRST so the specific Oyster mock below wins Playwright's newest-first match)…
  ["100YR", { samples: [{ value: "", resolution: 12 }] }],
  // …and the Oyster service returns the draft value (or a 503 for the outage pass).
  ["Oyster_100YR_Existing_WSE", wse100Status === 200 ? { samples: [{ value: wse100, resolution: 12 }] } : "HTTP_FAIL"],
];

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

async function openAndCheck(browser, { county, fips, countyName, wse100, wse100Status }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  const siteObj = mkSite({ county });
  await ctx.addInitScript(seedFor(siteObj));
  await ctx.addInitScript(BLOB_HOOK);
  const fbcddCalls = { count: 0 };
  const mocks = mocksFor(countyName, fips, ORIGINS[county], { wse100, wse100Status });
  for (const [needle, payload] of mocks) {
    await ctx.route(`**${needle}**`, (route) => {
      if (/100YR/.test(needle)) fbcddCalls.count++;
      if (payload === "HTTP_FAIL") return route.fulfill({ status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) });
    });
  }
  // Catch-all (see verify-v276-fortbend-ffe.mjs): some sandboxes' egress proxies HANG
  // unmatched requests, stalling exportPDF's aerial capture — fulfil everything else
  // instantly and defer to the mocks above via fallback.
  const needles = mocks.map(([n]) => n);
  await ctx.route("**", (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith("data:") || needles.some((n) => u.includes(n))) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  const checkBtn = page.getByRole("button", { name: /Check drainage criteria/ });
  await checkBtn.waitFor({ timeout: 8000 });
  await checkBtn.click();
  await page.getByText("Detention required", { exact: false }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const yieldText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  // The regime row's disclosure lives in a title attribute (ⓘ hover) on the Yield
  // panel — read it here, before the view switches to Analysis.
  const regimeDraftDisclosed = await page.locator("div[title]").evaluateAll((els) =>
    els.some((el) => /A DRAFT Atlas-14 watershed-study 1% WSE is pricing the floodplain mitigation/.test(el.getAttribute("title") || ""))).catch(() => false);
  await page.getByRole("button", { name: "Analysis", exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  return { ctx, page, text, yieldText, regimeDraftDisclosed, fbcddCalls };
}

async function captureSheet(page) {
  await page.getByRole("button", { name: /^File/ }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const n = await page.evaluate(() => (window.__sheetSvgs || []).length);
    if (n) break;
  }
  return page.evaluate(() => (window.__sheetSvgs && window.__sheetSvgs.length ? window.__sheetSvgs[window.__sheetSvgs.length - 1] : null));
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ── 1. Fort Bend Zone A + draft 96.0 → priced, labeled DRAFT everywhere ────────
  console.log("· Fort Bend unstudied Zone A / FBCDD 100YR = 96.0 (priced + DRAFT labels + FFE basis + PDF parity)");
  {
    const { ctx, page, text: t, yieldText: y, regimeDraftDisclosed, fbcddCalls } = await openAndCheck(browser, { county: "fortbend", fips: "48157", countyName: "Fort Bend", wse100: "96.0" });
    expect("the 100YR multiplex was actually sampled", fbcddCalls.count > 0, `${fbcddCalls.count} calls`);
    expect("mitigation PRICED with zero manual inputs (a compensating-storage volume renders)",
      /Required compensating storage/.test(t) && !/Mitigation volume UNKNOWN/.test(t), t.match(/Required compensating storage[^a-z]{0,40}/)?.[0]);
    expect("providers line: 1% WSE derived (FBCDD study — DRAFT)", /1% WSE derived \(FBCDD study — DRAFT\)/.test(t), t.match(/Providers:[^·]*·[^·]*·[^·]*/)?.[0]);
    expect("⚑ card note: value + watershed + DRAFT screening copy",
      /1% WSE ≈ 96′ read from Fort Bend's Atlas-14 watershed-study rasters \(Oyster watershed\)/.test(t), t.match(/1% WSE ≈[^.]{0,110}/)?.[0]);
    expect("footer carries DERIVED_WSE100_DRAFT_NOTE", /This 1% \(100-yr\) water surface was read from Fort Bend County's Atlas-14 watershed-study rasters/.test(t));
    expect("yield row tags 'DRAFT Atlas-14 100-yr'", /DRAFT Atlas-14 100-yr/.test(y), y.match(/Floodplain mitigation[^A-Z]{0,60}[A-Z]{0,30}/)?.[0]);
    expect("yield loud note: '1% WSE ≈ 96.0′ read from …' + override prompt", /1% WSE ≈ 96(\.0)?′ read from Fort Bend's Atlas-14 watershed-study rasters — DRAFT study results, screening only\. Type a BFE below to override\./.test(y));
    // Variant (b): the FFE computes off the labeled atlas14_100yr basis (96 + 2 = 98).
    expect("FFE computes off the Atlas-14 100-yr basis: Required FFE 98′ (Atlas-14 100-yr WSE + 2′)",
      /98′ \(Atlas-14 100-yr WSE \+ 2′\)/.test(t), t.match(/Required FFE[^—]*—?[^.]{0,40}/)?.[0]);
    expect("⚑ FFE DRAFT caveat: 'The Atlas-14 100-yr WSE behind this required FFE is a DRAFT…'",
      /The Atlas-14 100-yr WSE behind this required FFE is a DRAFT Fort Bend watershed-study value/.test(t));
    expect("BFE input greyed placeholder shows the DRAFT read: ~96.0′ · DRAFT (FBCDD 100-yr)",
      /~96(\.0)?′ · DRAFT \(FBCDD 100-yr\)/.test(y), y.match(/BFE \(1% WSE\)[^e]{0,40}/)?.[0]);
    expect("regime ⓘ discloses the DRAFT stand-in is pricing the mitigation", regimeDraftDisclosed);
    const sheet = await captureSheet(page);
    expect("print sheet captured off the real exportPDF path", !!sheet, sheet ? `${sheet.length} chars` : "no svg blob seen");
    if (sheet) {
      expect("PDF-PARITY: mitigation pair carries '(1% from DRAFT Atlas-14 study — basis is the effective floodplain)'",
        /1% from DRAFT Atlas-14 study — basis is the effective floodplain/.test(sheet),
        (sheet.match(/Floodplain mitigation.{0,160}/) || []).toString().slice(0, 180));
      expect("PDF-PARITY: FFE pair carries '(Atlas-14 100-yr WSE — DRAFT study)'",
        /Atlas-14 100-yr WSE — DRAFT study/.test(sheet),
        (sheet.match(/Required FFE.{0,160}/) || []).toString().slice(0, 180));
    }
    await ctx.close();
  }

  // ── 2. Montgomery Zone A → NO FBCDD call, no DRAFT copy ────────────────────────
  console.log("· Montgomery unstudied Zone A (out of county: no FBCDD call, no draft copy, honest UNKNOWN)");
  {
    const { ctx, text: t, fbcddCalls } = await openAndCheck(browser, { county: "montgomery", fips: "48339", countyName: "Montgomery", wse100: "96.0" });
    expect("no 100YR raster call left the app (county-gated + zero extent candidates)", fbcddCalls.count === 0, `${fbcddCalls.count} calls`);
    expect("no DRAFT Atlas-14 copy renders anywhere", !/Atlas-14 watershed-study/.test(t));
    expect("mitigation reads honest UNKNOWN (unstudied Zone A, nothing to price from)",
      /Mitigation volume UNKNOWN/.test(t) && /unstudied Zone A/.test(t), t.match(/Mitigation volume UNKNOWN[^.]{0,80}/)?.[0]);
    await ctx.close();
  }

  // ── 3. Fort Bend Zone A + 503 → loud outage banner, UNKNOWN, never a value ─────
  console.log("· Fort Bend unstudied Zone A / FBCDD 100YR 503s (LOUD-FAILURE: banner + UNKNOWN)");
  {
    const { ctx, text: t } = await openAndCheck(browser, { county: "fortbend", fips: "48157", countyName: "Fort Bend", wse100Status: 503 });
    expect("the outage banner renders: 'the DRAFT 1% (100-yr) WSE couldn't be read this check'",
      /the DRAFT 1% \(100-yr\) WSE couldn't be read this check/.test(t), t.match(/watershed-study server[^.]{0,90}/)?.[0]);
    expect("mitigation reads UNKNOWN — an outage is never a value",
      /Mitigation volume UNKNOWN/.test(t) && !/Required compensating storage/.test(t));
    expect("no DRAFT provider label appears (nothing was read)", !/derived \(FBCDD study — DRAFT\)/.test(t));
    await ctx.close();
  }

  await browser.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("harness error:", e); process.exit(1); });
