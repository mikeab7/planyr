/**
 * NEW-3 headless self-check (sandbox, logged-out): mocks a Fort Bend floodplain site at
 * the network layer (canned ArcGIS JSON, the verify-b629 pattern), runs the ⛆ drainage
 * check, and asserts the AUTO pad / FFE behaviour:
 *   • Yield readout — the pad field defaults to the code-minimum FFE and renders as grey
 *     "~<n>′ · code min" text (not a blank input), because Fort Bend's FIRM-BFE basis
 *     (BFE 95 + 2) computes it without a typed pad.
 *   • Site Analysis card — the Required-FFE verdict reads "ASSUMED at this code minimum",
 *     never a verified pass on a real pad.
 *   • NEW-4 — outside Harris the tier's "Channel adjacency unknown" noise is gone.
 *
 * BFE 95 (mocked static BFE) → Fort Bend FFE = max-of-bases = 95 + 2 = 97 (FIRM-BFE basis).
 *
 * Run: npm run build && npx vite preview --port 4188, then
 *      BASE_URL=http://localhost:4188/ node ui-audit/verify-auto-ffe.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const site = {
  s_ffe: {
    id: "s_ffe", groupId: "s_ffe", site: "Auto FFE Test", name: "Plan 1", status: "active",
    origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 300, h: 200, rot: 0 }],
    measures: [], callouts: [], markups: [], deletedIds: [],
    settings: { showSetback: false }, underlay: null, updatedAt: Date.now(),
  },
};
// Idempotent seed — only writes if absent, so a page RELOAD preserves what the live check
// persisted (the NEW-2 round trip); a non-idempotent seed would wipe the remembered lastCheck.
const seed = `(() => { try {
  if (!localStorage.getItem('planarfit:sites:v1')) localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  if (!localStorage.getItem('planarfit:currentSite:v1')) localStorage.setItem('planarfit:currentSite:v1', 's_ffe');
} catch (e) {} })();`;

// Fort Bend, one AE zone (STATIC_BFE 95, NAVD88), ground 100 ft (30.48 m). No HCFCD (Fort
// Bend), and the FBCDD 500-yr raster returns no-data so the FIRM-BFE basis governs the FFE.
const MOCKS = [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: "Fort Bend", FIPS_ST_CNTY_CD: "48157" } }] }],
  ["Texas_City_Boundaries", { features: [] }],
  ["HGAC_City_ETJ", { features: [] }],
  ["TCEQ_Water_Districts", { features: [] }],
  // A big AE polygon around the origin (±0.01° ≈ thousands of ft) so the building footprint
  // sits inside it — the zone needs geometry or zonesFromFeatureCollection drops it (no BFE).
  ["NFHL", { features: [{ attributes: { FLD_ZONE: "AE", ZONE_SUBTY: "", STATIC_BFE: 95, V_DATUM: "NAVD88" }, geometry: { rings: [[[-95.81, 29.54], [-95.79, 29.54], [-95.79, 29.56], [-95.81, 29.56], [-95.81, 29.54]]] } }] }],
  ["HCFCD/Watershed", { features: [] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "30.48" })) }],
  ["500YR_WSE", { samples: [] }],
];

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };
const railText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  for (const [needle, payload] of MOCKS) {
    await ctx.route(`**${needle}**`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) }));
  }
  // Any HCFCD channel query (Fort Bend shouldn't gate on it) fails fast rather than hangs.
  await ctx.route(`**HCFCD/Channels**`, (route) => route.fulfill({ status: 500, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "n/a" }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 }).catch(() => {});
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  const cb = page.getByRole("button", { name: /Check drainage criteria/ });
  await cb.waitFor({ timeout: 8000 }).catch(() => {});
  await cb.click();
  await page.locator('button:has-text("▸ Detention")').waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  // B824 — the Stormwater readout is grouped + COLLAPSED by default; expand all three
  // verdict groups so the detail (formerly the Site Analysis card) is in the DOM.
  for (const g of ["▸ Detention", "▸ Floodplain mitigation", "▸ Buildability / FFE"]) {
    await page.locator(`button:has-text("${g}")`).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  const t = await railText(page);

  // NEW-3 — the pad defaults to the code-minimum FFE (95 + 2 = 97) and shows as grey text.
  expect("NEW-3: pad field shows the AUTO code-minimum FFE ~97′", /~?97(\.0)?′?\s*·?\s*code min/i.test(t) || await page.locator('button:has-text("code min")').count() > 0, t.match(/Pad \/ finished floor[^A-Z]{0,40}/)?.[0]);
  expect("NEW-3: the auto value names its 'code min' source", await page.locator(':text("code min")').count() > 0);
  // NEW-4 — no permanent channel-adjacency noise outside Harris.
  expect("NEW-4: no 'Channel adjacency unknown' (body)", !/Channel adjacency unknown/.test(t));
  expect("NEW-4: no 'Channel adjacency unknown' (tier ⓘ)", await page.locator('[title*="Channel adjacency unknown"]').count() === 0);
  await page.screenshot({ path: "ui-audit/verify-auto-ffe.png" }).catch(() => {});

  // NEW-3 (B824: the card merged into Yield → Stormwater) — the Required-FFE verdict now
  // lives in the expanded Buildability / FFE group of THIS panel.
  const t2 = t;
  expect("NEW-3: Required FFE renders the 97′ code minimum", /Required FFE/.test(t2) && /97(\.0+)?′/.test(t2), t2.match(/Required FFE[^A-Z]{0,40}/)?.[0]);
  expect("NEW-3: verdict reads 'ASSUMED at this code minimum' (not a verified pass)", /ASSUMED at this code minimum/i.test(t2));
  expect("NEW-3: NOT a false 'pad PASSES' verdict", !/pad PASSES/.test(t2));
  // B824 — Site Analysis keeps only the screening LINK row (no duplicate ledger).
  await page.locator('button[title="Analysis"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const tA2 = await railText(page);
  expect("B824: Analysis shows the link row to Yield · Stormwater", /in Yield · Stormwater/.test(tA2));
  expect("B824: Analysis no longer renders the Required-FFE ledger", !/Required FFE/.test(tA2));
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);

  // NEW-2 persist → restore round trip: the live check priced mitigation (the building sits in
  // the AE zone) and persisted a SLIM summary. Reloading (no fresh check) must re-render the
  // remembered ledger — the exact regression NEW-2 fixes (it used to vanish on a restored view).
  await page.waitForTimeout(1500); // let the settings autosave flush the lastCheck to localStorage
  const persisted = await page.evaluate(() => {
    try { const s = JSON.parse(localStorage.getItem("planarfit:sites:v1")); const lc = s?.s_ffe?.settings?.drainage?.lastCheck; return { hasMit: !!(lc && lc.mitigation), mitIntersect: lc?.mitigation?.summary?.intersectAcres }; } catch (e) { return { err: String(e) }; }
  });
  expect("NEW-2: the live check PERSISTS the slim mitigation summary (numbers only) to localStorage", persisted.hasMit === true && persisted.mitIntersect > 0, `intersect=${persisted.mitIntersect}`);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2800);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 }).catch(() => {});
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  const t3 = await railText(page);
  expect("NEW-2: after reload the remembered MITIGATION ledger persists (round trip)", /Floodplain mitigation/.test(t3));
  expect("NEW-2: the reloaded readout reads remembered (As of <date>)", /As of \d/.test(t3));

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error("harness error:", e); process.exit(1); });
