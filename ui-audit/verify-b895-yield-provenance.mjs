/**
 * Verify B895 — the Yield-panel provenance-readability refactor, exercised end-to-end
 * in the real built app (no GIS needed: the Detention storage rollup + SourceTag/
 * SourcesLegend/footer are pure client-side geometry + presentation).
 *
 * Scenario: a small parcel with one pond drawn (no drainage check run, no GIS calls).
 * Asserts: the Yield panel header carries a "Sources ⓘ" legend that opens on click and
 * lists all six tag words; the "Detention storage" row carries a PLAN source tag whose
 * ⓘ opens a Basis popover; the panel footer disclaimer renders (and is the ONLY place
 * the generic screening disclaimer appears); no console errors.
 *
 * Run:  npm run build && npx vite preview --port 4189  (background), then
 *       BASE_URL=http://localhost:4189/ node ui-audit/verify-b895-yield-provenance.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4189/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 300; // half-side → 600' square parcel
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const POND = { id: "pond1", type: "pond", cx: 150, cy: 150, w: 120, h: 120, rot: 0 };
const BLDG = { id: "b1", type: "building", cx: -150, cy: -150, w: 100, h: 80, rot: 0 };

const site = {
  s_prov: {
    id: "s_prov", groupId: "s_prov", site: "Provenance Test", name: "Plan 1", status: "active",
    origin: { lat: 29.9, lon: -95.6 }, county: "harris",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [POND, BLDG], measures: [], callouts: [], markups: [],
    deletedIds: [], settings: {}, underlay: null, updatedAt: Date.now(),
  },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_prov');
} catch (e) {} })();`;

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Zoom to fit" }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  const railText = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // Yield is the default open panel on a fresh site; make sure it's open regardless.
  await page.locator('button[title="Yield"]').first().click().catch(() => {});
  await page.waitForTimeout(500);
  let t = await railText();
  expect("Yield panel shows 'Site Yield'", /site yield/i.test(t)); // header is CSS text-transform: uppercase
  expect("Detention storage row renders", /Detention storage/.test(t) && /ac-ft/.test(t));

  // ── Sources legend ────────────────────────────────────────────────────────
  const legendBtn = page.getByRole("button", { name: /Sources.*colored tags mean/i });
  expect("Sources ⓘ legend button renders in the Yield header", await legendBtn.count() > 0);
  if (await legendBtn.count() > 0) {
    await legendBtn.first().click();
    await page.waitForTimeout(250);
    t = await railText();
    const bodyTxt = await page.locator("body").innerText();
    for (const word of ["CODE", "PLAN", "SURVEY", "ESTIMATE", "YOURS", "UNVERIFIED"]) {
      expect(`Sources legend lists ${word}`, bodyTxt.includes(word));
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }

  // ── Detention storage PLAN source tag + Basis popover ──────────────────────
  const planTag = page.locator("text=Detention storage").locator("xpath=ancestor::div[1]/following-sibling::*//text()[contains(., 'PLAN')]").first();
  const bodyTxt2 = await page.locator("body").innerText();
  expect("Detention storage row shows a PLAN tag", /Detention storage[\s\S]{0,80}PLAN/.test(bodyTxt2));
  // Open its Basis popover via the ⓘ button next to the tag (RowInfo pattern: "About PLAN ...").
  const basisBtn = page.getByRole("button", { name: /About PLAN/i }).first();
  if (await basisBtn.count() > 0) {
    await basisBtn.focus();
    await page.waitForTimeout(250);
    const popoverTxt = await page.locator('[role="note"]').first().innerText().catch(() => "");
    expect("Basis popover opens on keyboard focus and names the row", /Detention storage|Prismoidal/.test(popoverTxt), popoverTxt.slice(0, 80));
    await page.keyboard.press("Escape");
  } else {
    expect("Basis ⓘ button for the PLAN tag is reachable", false);
  }

  // ── Footer disclaimer: present, and it's the ONLY generic screening sentence ──
  t = await railText();
  const disclaimerHits = (t.match(/Screening estimates for deal-stage decisions/g) || []).length;
  expect("Yield-panel footer disclaimer renders exactly once", disclaimerHits === 1, `found ${disclaimerHits}`);
  expect("no stray 'confirm with your engineer' text on the open panel", !/confirm with your engineer/.test(t));

  console.log(failures === 0 ? "\n✓ All B895 provenance checks passed." : `\n✗ ${failures} check(s) failed.`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
