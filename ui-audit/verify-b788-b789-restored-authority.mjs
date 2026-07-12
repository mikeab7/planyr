/**
 * B788/B789/B791 — the remembered-drainage-check self-heal + Harris-side county gating.
 *
 * Scenario 1 (the Bain repro, 27211 Hoyt Ln Katy — restored WITHOUT clicking Check):
 *   settings.drainage.lastCheck is seeded with the pre-B754 WRONG verdict
 *   (primaryReviewerId:"coh") next to CORRECT raw facts (city Katy · ETJ Houston ·
 *   county Fort Bend), an old sig (→ stale), plus a latent drainsToHcfcdChannel:true.
 *   Expect: reviewer RE-DERIVES to Fort Bend County Drainage District (B788); the stale
 *   banner + ↻ Re-check lead the card and claims read past-tense "checked <date>" (B791);
 *   the "Drains to HCFCD channel" control is ABSENT and the stored channel answer is
 *   visibly ignored (B789 a/c); no HCFCD greater-of candidate prices (B789).
 *
 * Scenario 2 (explicit COH override on the same Fort Bend site, >20 ac):
 *   settings.drainage.authorityId:"coh" → the engine prices COH's own impervious rate
 *   with the "outside Harris County" caveat — never the HCFCD compare (B789 engine gate).
 *
 * Run:  npm run build && npx vite preview --port 4193  (background), then
 *       BASE_URL=http://localhost:4193/ node ui-audit/verify-b788-b789-restored-authority.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4193/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 660; // 40.00-ac square
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const CHECKED_AT = 1783713120066; // Fri Jul 10 2026, 2:52 PM CDT — the real Bain timestamp

const lastCheck = {
  authority: {
    primaryReviewerId: "coh", // the frozen pre-B754 verdict — must NOT be trusted
    channelAuthority: null,
    overlays: [],
    ambiguous: [],
    flags: [],
    mudState: "loaded",
    jurisdiction: { city: ["Katy"], county: ["Fort Bend"], etj: ["Houston"] },
  },
  flood: { zones: [], state: "loaded", ageMs: 0 },
  channel: { near: null, unitNo: null, name: null, type: null, distFt: null, state: "not-applicable" },
  watershed: null,
  groundElevFt: 135.5,
  groundDatum: "NAVD88",
  sig: "seeded-old-boundary", // never matches the live sig → stale
  checkedAt: CHECKED_AT,
};

const siteFor = (drainage, floodMitigation) => ({
  s_b788: {
    id: "s_b788", groupId: "s_b788", site: "B788 Test", name: "Plan 1", status: "active",
    origin: { lat: 29.7722, lon: -95.8548 }, county: "fortbend",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [], measures: [], callouts: [], markups: [],
    deletedIds: [], settings: { showSetback: false, drainage, ...(floodMitigation ? { floodMitigation } : {}) }, underlay: null, updatedAt: Date.now(),
  },
});
const seedFor = (drainage, floodMitigation) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(siteFor(drainage, floodMitigation))}));
  localStorage.setItem('planarfit:currentSite:v1', 's_b788');
} catch (e) {} })();`;

// Fort Bend county + City-of-Houston ETJ + Katy frontage sliver — the exact Bain shape.
const GIS_MOCKS = [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: "Fort Bend", FIPS_ST_CNTY_CD: "48157" } }] }],
  ["Texas_City_Boundaries", { features: [{ attributes: { city_name: "Katy" } }] }],
  ["HGAC_City_ETJ", { features: [{ attributes: { CITY: "HOUSTON" } }] }],
  ["TCEQ_Water_Districts", { features: [] }],
  ["NFHL", { features: [] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "41.3" })) }],
];

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

async function openYield(browser, drainage, clickCheck, floodMitigation = null) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seedFor(drainage, floodMitigation));
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
  if (clickCheck) {
    const cb = page.getByRole("button", { name: /Check drainage criteria/ });
    await cb.waitFor({ timeout: 8000 }).catch(() => {});
    await cb.click().catch(() => {});
  }
  await page.getByText("Detention required", { exact: false }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  return { ctx, page, t };
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  console.log("\nScenario 1 — restored stale check with the pre-B754 'coh' verdict + latent channel override:");
  {
    const { ctx, page, t } = await openYield(browser, { drainsToHcfcdChannel: true, lastCheck }, false);
    expect("B788: reviewer RE-DERIVED to Fort Bend County Drainage District (stored 'coh' not trusted)",
      /Fort Bend County Drainage District/.test(t));
    expect("B788: reviewer is NOT City of Houston",
      !/Reviewing authority: City of Houston/.test(t));
    expect("B788/B791: no present-tense '(detected from city-limits GIS)' on a remembered check",
      !/\(detected from city-limits GIS\)/.test(t));
    expect("B791: the stale banner leads — boundary-changed wording + old-boundary caveat",
      /Site boundary changed since this check/.test(t) && /old boundary/.test(t));
    expect("B791: banner carries the checked date (past tense)",
      /checked 7\/10\/2026|checked 2026/.test(t));
    const recheck = await page.getByRole("button", { name: /Re-check/ }).count();
    expect("B791: a ↻ Re-check button is present in the stale state", recheck >= 1);
    const chanControl = await page.getByRole("button", { name: /Drains to HCFCD channel: Auto/ }).count();
    expect("B789(a): the 'Drains to HCFCD channel' control is ABSENT off-Harris", chanControl === 0);
    expect("B789(c): the stored channel answer is visibly IGNORED (note present)",
      /HCFCD only governs in Harris County/.test(t));
    expect("B789: no HCFCD greater-of candidate prices on this Fort Bend site",
      !/greater-of/.test(t));
    if (failures) console.log(`\n  Readout excerpt: ${t.match(/Stormwater[\s\S]{0,500}/)?.[0]?.slice(0, 500) || "(not found)"}`);
    await ctx.close();
  }

  console.log("\nScenario 2 — explicit COH override on the Fort Bend site (>20 ac):");
  {
    const { ctx, t } = await openYield(browser, { authorityId: "coh", lastCheck }, false);
    expect("B789 engine: COH-only pricing with the 'outside Harris County' caveat",
      /outside Harris County/.test(t));
    expect("B789 engine: no HCFCD greater-of compare under the off-Harris override",
      !/greater-of/.test(t));
    await ctx.close();
  }

  console.log("\nScenario 3 — B790: sticky floodMitigation.jurKey:'harris' on the Fort Bend site:");
  {
    const { ctx, page, t } = await openYield(browser, { lastCheck }, false, { jurKey: "harris" });
    expect("B790: the county-mismatch warning names the contradiction",
      /county map reads Fort Bend/.test(t) && /Switch the Jurisdiction to Auto/.test(t));
    const autoOpt = await page.locator('option[value=""]').filter({ hasText: /Auto — detected/ }).count();
    expect("B790: an 'Auto — detected: …' option exists on the Jurisdiction picker", autoOpt >= 1);
    // Switch to Auto → the warning clears and the detected (Fort Bend) rule takes over.
    const fmSelect = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: /Auto — detected/ }) }).last();
    await fmSelect.selectOption("").catch(() => {});
    await page.waitForTimeout(400);
    const t2 = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect("B790: switching to Auto clears the mismatch warning",
      !/county map reads Fort Bend —/.test(t2));
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\nB788/B789 VERIFY: ${failures} FAILURE(S)` : "\nB788/B789 VERIFY: ALL PASS");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
