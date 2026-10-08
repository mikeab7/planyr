#!/usr/bin/env node
/* verify-basemap-live-export — V1443696 step 6, signed in as the test account on a real deploy: the Site Plan PDF
 * export sheet carries the aerial UNTONED (no grade filter reaches the export path) on the fixture site.
 * Read-only: opens the fixture site, builds the print sheet (captured via URL.createObjectURL like
 * verify-export-quality.mjs), downloads nothing, writes nothing to the account. */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.argv.find((x) => /^https?:/.test(x)) || "https://planyr.io";
const hook = () => { window.__PLANYR_E2E = true; window.__svgs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (obj) => { try { if (obj && obj.type === "image/svg+xml") obj.text().then((t) => window.__svgs.push(t)); } catch (e) {} return o(obj); }; };
const s = await openSignedIn({ base: BASE, initScripts: [[hook, null]] });
const page = s.page;
await assertMeasurable(page, "verify-basemap-live-export");
const build = s.build;
let ok = true; const check = (l, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"} — ${l}${x ? ` (${x})` : ""}`); if (!c) ok = false; };
await page.evaluate((id) => { try { localStorage.setItem("planarfit:currentSite:v1", id); } catch (e) {} location.hash = "#/site"; }, FIXTURE_SITE_ID);
await page.waitForTimeout(6000);
// open the fixture plan from the sites list
const opened = await page.evaluate(async (id) => { const r = await window.pfSupabase.from("sites").select("id,site,name").eq("id", id); return r.data && r.data[0]; }, FIXTURE_SITE_ID);
console.log("fixture:", JSON.stringify(opened), "build:", JSON.stringify(build));
if (opened && opened.site) await page.getByText(opened.site, { exact: true }).first().click({ force: true, timeout: 15000 }).catch(() => {});
const planner = await page.waitForSelector('button:has-text("File ▾")', { timeout: 30000 }).then(() => true, () => false);
check("fixture plan opens in the planner (signed in)", planner);
if (planner) {
  await page.waitForTimeout(5000);
  await page.locator('button:has-text("File ▾")').first().click();
  await page.locator('button:has-text("Download PDF / pick frame")').first().click();
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Continue ➜")').first().click();
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 30000 });
  await page.waitForTimeout(7000);
  const sheet = await page.evaluate(() => (window.__svgs || []).find((x) => x.includes("data-furniture")) || null);
  check("print sheet built", !!sheet);
  if (sheet) {
    check("export sheet carries the aerial (inlined image)", /<image[^>]+href="data:image/.test(sheet) || /<image[^>]+href="/.test(sheet));
    check("no tone-grade filter anywhere in the export sheet", !/planyr-imagery-graded|brightness\(0\.9\)|saturate\(0\.8\)/.test(sheet));
  }
}
await s.close();
console.log(ok ? "\nALL PASSED" : "\nFAILED"); process.exit(ok ? 0 : 1);
