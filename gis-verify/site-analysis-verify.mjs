/* B147 Site Analysis — headless self-verification.
 *
 * Seeds a georeferenced site (Katy, TX) with one ACTIVE parcel, boots the planner
 * from the built app (vite preview on :4173), opens the new "Analysis" left-rail tab,
 * waits for the screen to run, and dumps the rendered findings + a screenshot.
 *
 * NOTE on the sandbox: outbound HTTPS is restricted to an allowlist, so the GIS
 * sources (FEMA, NWI, TxRRC, TxDOT) may be unreachable here — in which case the
 * panel SHOULD show honest "Unknown" states (never a fabricated "none"), which is
 * itself the key behaviour to confirm. If a host is allowlisted, real
 * Present/None-found states appear instead.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node gis-verify/site-analysis-verify.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./site-analysis-verify.png", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const parcel = {
  id: "pc1", locked: false, active: true,
  points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }],
};
const site = {
  id: "sa-demo", groupId: "sa-demo", site: "Katy Logistics Park", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {},
  underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);

// Open the Analysis tab.
await page.locator('button[title="Analysis"]').click({ timeout: 8000 });
await page.waitForTimeout(500);
console.log("Analysis tab opened. Waiting for the screen to run…");

// Wait until the per-category findings render (or the loading note clears).
await page.waitForTimeout(9000);

// Dump the panel text so we can confirm every category + its state.
const panelText = await page.evaluate(() => {
  const headers = Array.from(document.querySelectorAll("div")).filter((d) => /Site Analysis/.test(d.textContent || "") && d.querySelector("*") == null);
  // Grab the whole left menu column text.
  const col = Array.from(document.querySelectorAll("div")).find((d) => /Screening/.test(d.textContent || "") && /active parcel/.test(d.textContent || ""));
  return (col ? col.textContent : document.body.textContent).replace(/\s+/g, " ").slice(0, 1400);
});
console.log("\n--- PANEL TEXT ---\n" + panelText + "\n------------------\n");

await page.screenshot({ path: OUT });
console.log("saved", OUT);
await browser.close();
