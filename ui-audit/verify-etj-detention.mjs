/**
 * Verify the Houston-ETJ fix (owner report 2026-07-10): a parcel in the City of Houston
 * ETJ but NOT its city limits must resolve the detention reviewer to the COUNTY drainage
 * authority (here Fort Bend County Drainage District), NEVER "City of Houston", and must
 * surface the ETJ note explaining that Houston's rate does not apply.
 *
 * Real repro: 27211 Hoyt Ln, Katy — Fort Bend County, City-of-Houston ETJ, no city limits.
 *
 * Run:  npm run build && npx vite preview --port 4191  (background), then
 *       BASE_URL=http://localhost:4191/ node ui-audit/verify-etj-detention.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4191/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660; // 40.00-ac square
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const site = {
  s_etj: {
    id: "s_etj", groupId: "s_etj", site: "ETJ Test", name: "Plan 1", status: "active",
    origin: { lat: 29.7722, lon: -95.8548 }, county: "fortbend",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [], measures: [], callouts: [], markups: [],
    deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now(),
  },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_etj');
} catch (e) {} })();`;

// Fort Bend county + City-of-Houston ETJ + NO city limits — the exact repro shape.
const GIS_MOCKS = [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: "Fort Bend", FIPS_ST_CNTY_CD: "48157" } }] }],
  ["Texas_City_Boundaries", { features: [] }],
  ["HGAC_City_ETJ", { features: [{ attributes: { CITY: "HOUSTON" } }] }],
  ["TCEQ_Water_Districts", { features: [] }],
  ["NFHL", { features: [] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "30.48" })) }],
];

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  for (const [needle, payload] of GIS_MOCKS) {
    await ctx.route(`**${needle}**`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) }));
  }
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
  await page.getByText("Detention required", { exact: false }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  // B824 — expand the collapsed Stormwater verdict groups before reading text.
  for (const g of ["▸ Detention", "▸ Floodplain mitigation", "▸ Buildability / FFE"]) {
    await page.locator(`button:has-text("${g}")`).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  expect("Reviewer is Fort Bend County Drainage District (the county authority), not COH",
    /Fort Bend County Drainage District/.test(t), t.match(/(?:eff\.|verified)[^.]*/)?.[0]?.slice(0, 80) || "");
  expect("Reviewer is NOT reported as City of Houston",
    !/Reviewing authority: City of Houston/.test(t));
  // B823 — the ETJ note is a one-liner; the platting/rate teaching copy rides its ⓘ title.
  expect("ETJ one-liner: 'Houston ETJ — county (FBCDD) criteria govern detention'",
    /Houston ETJ — county \(FBCDD\) criteria govern detention/.test(t));
  const etjDetailOk = await page.locator("div[title]").evaluateAll((els) =>
    els.some((el) => { const v = el.getAttribute("title") || ""; return /not its city limits/.test(v) && /county drainage-district criteria govern detention/i.test(v) && /Houston's own detention rate does not apply/i.test(v) && /plat review/i.test(v); })).catch(() => false);
  expect("ETJ ⓘ carries the platting + rate-does-not-apply + plat-review detail", etjDetailOk);
  expect("No stale 'detected from city-limits GIS → City of Houston' claim for this ETJ site",
    !/detected from city-limits GIS/.test(t));

  if (failures) console.log(`\n  Readout excerpt: ${t.match(/Detention required[\s\S]{0,400}/)?.[0]?.slice(0, 400) || "(not found)"}`);
  await ctx.close();
  await browser.close();
  console.log(failures ? `\nETJ VERIFY: ${failures} FAILURE(S)` : "\nETJ VERIFY: ALL PASS");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
