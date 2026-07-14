/**
 * Verify B629–B633 + B635 — the detention rules engine wired into the Yield panel +
 * pond panel, exercised end-to-end in the real built app.
 *
 * By DEFAULT the GIS endpoints are mocked at the network layer (page.route serving
 * canned ArcGIS JSON) so the whole flow is deterministic and runs in the sandbox —
 * this session's egress proxy resets Chromium's tunneled TLS (curl/Node reach the
 * services fine; Chromium cannot), so live-GIS-in-browser is not verifiable here.
 * Set LIVE=1 to skip the mocks and hit the real services (browser-equipped envs) —
 * the required/badge assertions still hold at the same Harris test point; the
 * flood/regime assertions are mock-specific and are relaxed in LIVE mode.
 *
 * Scenario (mock): 40-ac square parcel, unincorporated Harris (Cypress area), outfall
 * type = storm sewer (B761) → HCED Infra-Regs 0.75 × 40 = 30.00 ac-ft required; one
 * 300′×300′ pond ≈ 12.00 ac-ft provided; Zone AE + FLOODWAY with BFE 95 vs ground 100 →
 * Regime B (wet-bottom); nearest HCFCD unit W100-00-00; CYPRESS CREEK watershed → the
 * B635 overlay note; a real MUD district.
 * Asserts: check button → required (badge: eff. Jul 2019 · verified Jul 2026) →
 * provided → Shortfall → Full-DIA triggers → Regime-B banner → MUD + watershed notes
 * → B750 channel Auto/Yes/No control + detected-channel + reviewing-agency picker →
 * pond "Size for required detention" → solver expands to MEET the requirement.
 * A second (COH) pass verifies the >20-ac Houston→HCFCD greater-of wording + the
 * failed-channel "couldn't confirm" hedge + the Yes override clearing it (B750).
 *
 * Run:  npm run build && npx vite preview --port 4188  (background), then
 *       BASE_URL=http://localhost:4188/ node ui-audit/verify-b629-detention.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LIVE = process.env.LIVE === "1";

// 40.0-ac square parcel centered on the origin (world feet).
const H = 660; // half-side → 1320′ square = 1,742,400 sf = 40.00 ac
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
// One 300′×300′ pond, offset from center so its click point dodges the parcel acreage chip.
const POND = { id: "pond1", type: "pond", cx: 300, cy: 300, w: 300, h: 300, rot: 0 };

const site = {
  s_det: {
    id: "s_det", groupId: "s_det", site: "Detention Test", name: "Plan 1", status: "active",
    origin: { lat: 29.96, lon: -95.69 }, county: "harris",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [POND], measures: [], callouts: [], markups: [],
    deletedIds: [], settings: { showSetback: false, drainage: { outfallType: "stormSewer" } }, underlay: null, updatedAt: Date.now(),
  },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_det');
} catch (e) {} })();`;

// ── canned ArcGIS responses (URL substring → payload) ─────────────────────────
// Elevation: 30.48 m × (3937/1200) = 100.00 ft ground, NAVD88.
const GIS_MOCKS = [
  ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: "Harris", FIPS_ST_CNTY_CD: "48201" } }] }],
  ["Texas_City_Boundaries", { features: [] }],
  ["HGAC_City_ETJ", { features: [] }],
  ["TCEQ_Water_Districts", { features: [{ attributes: { NAME: "Harris County MUD 61", TYPE: "MUD", TYPE_DESCRIPTION: "Municipal Utility District", COUNTY: "Harris", STATUS_DESCRIPTION: "Active", DISTRICT_ID: "1061" } }] }],
  ["NFHL", { features: [{ attributes: { FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", STATIC_BFE: 95, V_DATUM: "NAVD88" } }] }],
  ["HCFCD/Channels", { features: [{ attributes: { UNIT_NO: "W100-00-00", CHAN_NAME: "BUFFALO BAYOU", TYPE: "OPEN", DIT_TYPE: null }, geometry: { paths: [[[-95.6905, 29.9601], [-95.6895, 29.9602]]] } }] }],
  ["HCFCD/Watershed", { features: [{ attributes: { WTSHNAME: "CYPRESS CREEK", WTSHUNIT: "K" } }] }],
  ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "30.48" })) }],
];

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

// Map a WORLD-feet point to screen px via the rendered parcel outline (axis-aligned square:
// affine interpolation across its view-space bbox, then screen CTM).
const screenAt = (page, wx, wy) =>
  page.locator('[data-testid="parcel-outline"]').first().evaluate((el, { wx, wy, H }) => {
    const pts = el.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const vx = minX + ((wx + H) / (2 * H)) * (maxX - minX);
    const vy = minY + ((wy + H) / (2 * H)) * (maxY - minY);
    const m = el.getScreenCTM(), p = el.ownerSVGElement.createSVGPoint(); p.x = vx; p.y = vy;
    const v = p.matrixTransform(m); return { x: v.x, y: v.y };
  }, { wx, wy, H });

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  if (!LIVE) {
    for (const [needle, payload] of GIS_MOCKS) {
      await ctx.route(`**${needle}**`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) }));
    }
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Zoom to fit" }).first().click().catch(() => {});
  await page.waitForTimeout(500);

  // Open the right-rail Yield tab (the YieldPanel lives behind it).
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  const expandGroups = async (pg) => {
    // B824 — expand the collapsed Stormwater verdict groups before reading text.
    for (const g of ["▸ Detention", "▸ Floodplain mitigation", "▸ Buildability / FFE"]) {
      await pg.locator(`button:has-text("${g}")`).first().click({ timeout: 3000 }).catch(() => {});
      await pg.waitForTimeout(120);
    }
  };
  const railText = async () => { await expandGroups(page); return (await page.locator("body").innerText()).replace(/\s+/g, " "); };

  // ── 1. the Stormwater group offers the explicit check ──────────────────────
  const checkBtn = page.getByRole("button", { name: /Check drainage criteria/ });
  await checkBtn.waitFor({ timeout: 8000 }).catch(() => {});
  expect("Stormwater group shows 'Check drainage criteria'", await checkBtn.count() > 0);

  // ── 2–5. click → required / provided / shortfall / tier / regime ────────────
  await checkBtn.click();
  // B824 — the resolved readout renders as collapsed verdict groups; wait for the
  // Detention group header, expand (railText does), THEN assert the detail row.
  await page.locator('button:has-text("▸ Detention")').waitFor({ timeout: LIVE ? 90000 : 30000 }).catch(() => {});
  await railText();
  expect("'Detention required' row renders after the check", await page.getByText("Detention required", { exact: false }).count() > 0);

  let t = await railText();
  expect("required = 30.00 ac-ft (40 ac × HCED storm-sewer 0.75, B761)", /30\.00\s*ac-ft/.test(t), t.match(/Detention required[^A-Z]*/)?.[0]?.slice(0, 80));
  expect("rule badge carries the record (eff. Jul 2019 · verified Jul 2026)", /eff\. Jul 2019/.test(t) && /verified Jul 2026/.test(t));
  expect("'Detention provided' ≈ 12.00 ac-ft · 1 pond", /Detention provided/.test(t) && /12\.0\d?\s*ac-ft/.test(t) && /1 pond/.test(t));
  if (!LIVE) {
    // Regime B here (BFE 95 vs ground 100): the ~3-ft permanent pool (~4.69 ac-ft dead
    // storage) is UNCREDITED, so the honest shortfall is 30 − (12 − 4.69) ≈ 22.7 ac-ft,
    // NOT the gross 18.0. NEW-1(a): the usable figure stays visible on the provided row while
    // the "dead storage earns no credit" teaching copy folds into the row's ⓘ (title) hover.
    expect("usable figure shown on the provided row (Regime-B dead pool)", /usable\s+[\d.]+/i.test(t));
    expect("dead-storage detail folds into the provided-row ⓘ", await page.locator('div[title*="dead storage earns no credit"][title*="permanent pool"]').count() > 0);
    expect("Shortfall reflects USABLE volume (dead pool excluded, ~22.7 ac-ft)", /Shortfall/.test(t) && /22\.\d\d?\s*ac-ft/.test(t));
  } else {
    expect("Shortfall line renders (provided < required)", /Shortfall/.test(t));
  }
  if (!LIVE) {
    // NEW-1(a): tier + triggers + unknowns collapse to ONE verdict line; the four triggers
    // fold into the tier row's ⓘ (title) rather than a separate wrapped note.
    expect("Analysis tier = Full DIA (verdict line)", /Analysis tier/.test(t) && /Full DIA/.test(t));
    expect("all four DIA triggers fold into the tier ⓘ", await page.locator('div[title*="Floodplain"][title*="Floodway"][title*="Regulated channel"][title*="Tract size"]').count() > 0);
    // NEW-1(a): the regime collapses to a one-line verdict; its datum-tagged reasons + the
    // wet-bottom note fold into the regime row's ⓘ.
    expect("Regime B verdict line", /Regime B/i.test(t));
    expect("regime reasons (datum-tagged) + wet-bottom fold into the regime ⓘ", await page.locator('div[title*="NAVD88"][title*="permanent pool below the static water surface"]').count() > 0);
    expect("MUD district surfaced (never silent)", /Harris County MUD 61/.test(t));
    expect("B635 watershed overlay note (Upper Cypress)", /Upper Cypress/.test(t) && /retention/i.test(t));
  } else {
    expect("Analysis tier renders (verdict line)", /Analysis tier/.test(t));
    expect("tract-size trigger folds into the tier ⓘ", await page.locator('div[title*="Tract size"]').count() > 0);
    expect("hydraulic-regime banner renders (A/B/unknown — never absent)", /Regime (A|B|unknown)/i.test(t));
  }
  expect("screening caveat present", /Screening estimate — confirm with your engineer/.test(t));

  // ── 5a. NEW-1 verdict-first density redesign: the single status line (date + inline
  // Re-check), the mitigation-inputs 'Advanced' fold, and the datum footnote folded into
  // the inputs-header ⓘ (a live check this session reads present-tense "Checked <date>").
  expect("NEW-1: single status line shows the check date", /Checked\s+\d/.test(t));
  expect("NEW-1: inline Re-check button in the status line", await page.getByRole("button", { name: /Re-check/ }).count() > 0);
  expect("NEW-1: mitigation-inputs 'Advanced' fold present", await page.getByRole("button", { name: /Advanced/ }).count() > 0);
  expect("NEW-1: datum footnote folds into the inputs-header ⓘ", await page.locator('div[title*="mixed datums are a multi-foot silent error"]').count() > 0);

  // ── 5b. B750: channel-discharge control + detected-channel transparency ─────
  expect("B750 channel Auto/Yes/No control renders", /Drains to HCFCD channel/.test(t));
  expect("B750 detected channel is named (auto transparency)", /HCFCD channel detected/.test(t) && /W100-00-00/.test(t));
  expect("B750 reviewing-agency picker renders", /Reviewing agency/.test(t));
  expect("B761 outfall-type control renders (unincorporated Harris)", /Outfall type/.test(t) && /Storm sewer/.test(t));
  const chanBtn = (label) => page.getByRole("button", { name: `Drains to HCFCD channel: ${label}` });
  if (await chanBtn("No").count() > 0) {
    await chanBtn("No").click(); await page.waitForTimeout(300); t = await railText();
    expect("B750 setting channel → No follows the user's choice", /NOT draining to an HCFCD channel/.test(t));
    await chanBtn("Yes").click(); await page.waitForTimeout(300); t = await railText();
    expect("B750 setting channel → Yes shows the confirmed copy", /confirmed this site drains to an HCFCD channel/.test(t));
    await chanBtn("Auto").click(); await page.waitForTimeout(300); // reset for the pond-solve section
  }

  // ── 6. pond auto-size through the expand plumbing ──────────────────────────
  const pondPt = await screenAt(page, 380, 380).catch(() => null); // off-center in the pond
  expect("could compute the pond's screen position", !!pondPt);
  if (pondPt) {
    await page.mouse.dblclick(pondPt.x, pondPt.y); // B750 — dblclick opens Properties
    await page.waitForTimeout(700);
    const sizeBtn = page.getByRole("button", { name: /Size for required detention/ });
    await sizeBtn.waitFor({ timeout: 8000 }).catch(() => {});
    const haveBtn = await sizeBtn.count() > 0;
    expect("pond panel shows 'Size for required detention (… short)'", haveBtn);
    if (haveBtn) {
      const btnText = await sizeBtn.innerText();
      expect("the button names the shortfall", /ac-ft short/.test(btnText), btnText.trim());
      if (!LIVE) expect("Regime-B dead pool is included in the solve note", /(unusable permanent pool|Regime B)/.test(await railText()));
      await sizeBtn.click();
      await page.waitForTimeout(1500);
      t = await railText();
      expect("auto-size lands in expand mode (baseline + ghost + Done/Reset)", /Expanding · existing locked/i.test(t));
      expect("storage delta renders in expand mode", /Storage gained|Proposed storage/i.test(t));
      // The solver's own output proves it closed the shortfall: Proposed storage reaches
      // ≥ the 30.00 ac-ft required (usable target + dead pool → gross well above required).
      // Read here in expand mode — reliable, unlike navigating the rail back after commit.
      const prop = t.match(/Proposed storage\s+([\d.]+)\s*ac-ft/);
      const proposedAcFt = prop ? parseFloat(prop[1]) : null;
      expect("auto-size expands the pond to MEET the required detention (shortfall closed)",
        proposedAcFt != null && proposedAcFt >= 30.0, proposedAcFt != null ? `proposed ${proposedAcFt} ac-ft ≥ 30.00 required` : "no Proposed storage figure");
    }
  }

  // ── 7. B750 COH pass: greater-of reviewer wording + failed-channel hedge ────
  // A FRESH context (own localStorage, so no SWR-cached city/channel leaks in from the
  // primary pass): inside City of Houston + a FAILING HCFCD channel query (near=null →
  // the honest "couldn't confirm" hedge). Then confirm the Yes override clears it.
  // (Skipped in LIVE mode: it depends on the mocked jurisdiction/channel.)
  if (!LIVE) {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
    await ctx2.addInitScript(seed);
    const COH_MOCKS = [
      ["Texas_County_Boundaries", { features: [{ attributes: { CNTY_NM: "Harris", FIPS_ST_CNTY_CD: "48201" } }] }],
      ["Texas_City_Boundaries", { features: [{ attributes: { city_name: "Houston" } }] }],
      ["HGAC_City_ETJ", { features: [] }],
      ["TCEQ_Water_Districts", { features: [] }],
      ["NFHL", { features: [] }],
      ["HCFCD/Watershed", { features: [] }],
      ["3DEPElevation/ImageServer/getSamples", { samples: Array.from({ length: 9 }, () => ({ value: "30.48" })) }],
    ];
    for (const [needle, payload] of COH_MOCKS) {
      await ctx2.route(`**${needle}**`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) }));
    }
    await ctx2.route(`**HCFCD/Channels**`, (route) => route.fulfill({ status: 500, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "boom" }));
    const page2 = await ctx2.newPage();
    page2.on("pageerror", (e) => { failures++; console.log(`  [FAIL] COH pageerror — ${e.message}`); });
    await page2.goto(BASE, { waitUntil: "load" });
    await page2.waitForTimeout(2800);
    await page2.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 }).catch(() => {});
    await page2.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
    await page2.waitForTimeout(400);
    const cb2 = page2.getByRole("button", { name: /Check drainage criteria/ });
    await cb2.waitFor({ timeout: 8000 }).catch(() => {});
    await cb2.click();
    await page2.getByText("Detention required", { exact: false }).waitFor({ timeout: 30000 }).catch(() => {});
    await page2.waitForTimeout(700);
    await expandGroups(page2);
    const t2a = (await page2.locator("body").innerText()).replace(/\s+/g, " ");
    expect("B750 COH: reviewer wording explains the >20-ac Houston→HCFCD greater-of (not indecision)",
      /For a tract over 20 acres, City of Houston applies the larger/.test(t2a), t2a.match(/Reviewing authority[^.]*\./)?.[0]?.slice(0, 90));
    expect("B750 COH: a failed channel query shows the honest 'couldn't confirm' hedge",
      /Couldn't confirm from HCFCD's map server/.test(t2a));
    const yes2 = page2.getByRole("button", { name: "Drains to HCFCD channel: Yes" });
    if (await yes2.count() > 0) {
      await yes2.click(); await page2.waitForTimeout(400);
      await expandGroups(page2);
      const t2b = (await page2.locator("body").innerText()).replace(/\s+/g, " ");
      expect("B750 COH: confirming Yes clears the hedge (user's answer replaces the unknown)",
        /confirmed this site drains to an HCFCD channel/.test(t2b) && !/Couldn't confirm from HCFCD's map server/.test(t2b));
    }
    await ctx2.close();
  }

  await page.screenshot({ path: "ui-audit/verify-b629-detention.png", fullPage: false }).catch(() => {});
  await browser.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("harness error:", e); process.exit(1); });
