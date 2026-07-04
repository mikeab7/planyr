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
 * Scenario (mock): 40-ac square parcel, unincorporated Harris (Cypress area) → HCFCD
 * 0.65 × 40 = 26.00 ac-ft required; one 300′×300′ pond ≈ 12.00 ac-ft provided; Zone AE
 * + FLOODWAY with BFE 95 vs ground 100 → Regime B (wet-bottom); nearest HCFCD unit
 * W100-00-00; CYPRESS CREEK watershed → the B635 overlay note; a real MUD district.
 * Asserts: check button → required (badge: eff. Mar 2021 · verified Jul 2026) →
 * provided → Shortfall → Full-DIA triggers → Regime-B banner → MUD + watershed notes
 * → pond "Size for required detention" → solver lands in expand mode → Surplus.
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
    deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now(),
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

  // ── 1. the Stormwater group offers the explicit check ──────────────────────
  const checkBtn = page.getByRole("button", { name: /Check drainage criteria/ });
  await checkBtn.waitFor({ timeout: 8000 }).catch(() => {});
  expect("Stormwater group shows 'Check drainage criteria'", await checkBtn.count() > 0);

  // ── 2–5. click → required / provided / shortfall / tier / regime ────────────
  await checkBtn.click();
  const requiredRow = page.getByText("Detention required", { exact: false });
  await requiredRow.waitFor({ timeout: LIVE ? 90000 : 30000 }).catch(() => {});
  expect("'Detention required' row renders after the check", await requiredRow.count() > 0);

  const railText = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  let t = await railText();
  expect("required = 26.00 ac-ft (40 ac × HCFCD 0.65, whole tract)", /26\.00\s*ac-ft/.test(t), t.match(/Detention required[^A-Z]*/)?.[0]?.slice(0, 80));
  expect("rule badge carries the record (eff. Mar 2021 · verified Jul 2026)", /eff\. Mar 2021/.test(t) && /verified Jul 2026/.test(t));
  expect("'Detention provided' ≈ 12.00 ac-ft · 1 pond", /Detention provided/.test(t) && /12\.0\d?\s*ac-ft/.test(t) && /1 pond/.test(t));
  if (!LIVE) {
    // Regime B here (BFE 95 vs ground 100): the ~3-ft permanent pool (~4.69 ac-ft dead
    // storage) is UNCREDITED, so the honest shortfall is 26 − (12 − 4.69) ≈ 18.7 ac-ft,
    // NOT the gross 14.0 — and the panel says so via the "usable … permanent pool" note.
    expect("usable-volume note shows the uncredited Regime-B permanent pool", /permanent pool/i.test(t) && /Usable/.test(t));
    expect("Shortfall reflects USABLE volume (dead pool excluded, ~18.7 ac-ft)", /Shortfall/.test(t) && /18\.\d\d?\s*ac-ft/.test(t));
  } else {
    expect("Shortfall line renders (provided < required)", /Shortfall/.test(t));
  }
  if (!LIVE) {
    expect("Analysis tier = Full DIA with all four triggers", /Analysis tier/.test(t) && /Full DIA/.test(t) && /Floodplain/.test(t) && /Floodway/.test(t) && /Regulated channel/.test(t) && /Tract size/.test(t));
    expect("Regime B banner (BFE 95 within pond depth of ground 100), datum-tagged", /Regime B/i.test(t) && /NAVD88/.test(t));
    expect("wet-bottom warning renders in Regime B", /permanent pool below the static water surface/i.test(t));
    expect("MUD district surfaced (never silent)", /Harris County MUD 61/.test(t));
    expect("B635 watershed overlay note (Upper Cypress)", /Upper Cypress/.test(t) && /retention/i.test(t));
  } else {
    expect("Analysis tier renders (tract-size trigger at minimum)", /Analysis tier/.test(t) && /Tract size/.test(t));
    expect("hydraulic-regime banner renders (A/B/unknown — never absent)", /Regime (A|B|unknown)/i.test(t));
  }
  expect("screening caveat present", /Screening estimate — confirm with your engineer/.test(t));

  // ── 6. pond auto-size through the expand plumbing ──────────────────────────
  const pondPt = await screenAt(page, 380, 380).catch(() => null); // off-center in the pond
  expect("could compute the pond's screen position", !!pondPt);
  if (pondPt) {
    await page.mouse.click(pondPt.x, pondPt.y);
    await page.waitForTimeout(600);
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
      // The site-level readout should now show the shortfall closed (≥ required) —
      // selecting the pond switched the rail to the Element tab, so re-open Yield.
      await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
      await page.waitForTimeout(400);
      t = await railText();
      const m = t.match(/Surplus\s*\+?([\d.]+)/);
      expect("Yield panel flips to Surplus after the solve", !!m, m ? `+${m[1]} ac-ft` : "no Surplus line found");
    }
  }

  await page.screenshot({ path: "ui-audit/verify-b629-detention.png", fullPage: false }).catch(() => {});
  await browser.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("harness error:", e); process.exit(1); });
