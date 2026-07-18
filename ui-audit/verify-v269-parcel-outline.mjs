/* Headless drive for the parcel OUTLINE style editor (V269) — LOGGED OUT, on the BUILT app.
 * A one-parcel / no-element site auto-selects the parcel and opens the Parcel panel, which carries
 * the per-parcel outline editor (Outline color / Line weight / Line style / Reset outline). These
 * ride the SAME setSelParcel → re-render path as the known-good fill controls. Checks the logged-out
 * half of V269 (the signed-in cloud-reload persistence is the auth-blocked residual):
 *  1. All four outline controls render.
 *  2. Changing Outline color LIVE-recolors the boundary <polygon data-testid="parcel-outline"> stroke.
 *  3. Bumping Line weight thickens the boundary stroke-width.
 *  4. Line style → Dashed applies a stroke-dasharray.
 *  5. Reset outline reverts the stroke back to the default AND clears the dash.
 *  (PDF/print parity is inherent — buildExportSvg clones the live SVG.)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const site = { id: "S", groupId: "S", site: "OutlineYard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const fails = [];
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails.push(name); };
const outline = () => page.evaluate(() => {
  const el = document.querySelector('[data-testid="parcel-outline"]');
  return el ? { stroke: el.getAttribute("stroke"), width: parseFloat(el.getAttribute("stroke-width")), dash: el.getAttribute("stroke-dasharray") || "" } : null;
});

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="parcel-outline"]', { timeout: 15000 });
await page.waitForTimeout(1200);

// 1) Controls render (Parcel panel auto-opened for the single selected parcel).
const body = await page.evaluate(() => document.body.innerText);
const controlsOk = ["Outline color", "Line weight", "Line style", "Reset outline"].every((t) => body.includes(t));
check("V269 — the outline editor controls render (Outline color / Line weight / Line style / Reset outline)", controlsOk);

const base = await outline();
check("V269 — the parcel boundary polygon is present with a default stroke", !!base && !!base.stroke, JSON.stringify(base));

// 2) Change Outline color → live recolor.
const colorInput = page.locator('input[type="color"]').first();
await colorInput.evaluate((el) => { el.value = "#ff0000"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
await page.waitForTimeout(300);
const recolored = await outline();
check("V269 — changing Outline color LIVE-recolors the boundary stroke", (recolored.stroke || "").toLowerCase() === "#ff0000",
  `stroke=${recolored.stroke}`);

// 3) Bump Line weight → thicker stroke.
for (let i = 0; i < 8; i++) { await page.locator('[aria-label="Increase"]').first().click(); await page.waitForTimeout(40); }
await page.waitForTimeout(200);
const thicker = await outline();
check("V269 — bumping Line weight thickens the boundary stroke-width", thicker.width > base.width,
  `before=${base.width} after=${thicker.width}`);

// 4) Line style → Dashed.
await page.locator('select').filter({ hasText: "Dashed" }).first().selectOption("dashed");
await page.waitForTimeout(300);
const dashed = await outline();
check("V269 — Line style → Dashed applies a stroke-dasharray", !!dashed.dash && dashed.dash.trim() !== "",
  `dash="${dashed.dash}"`);
await page.screenshot({ path: OUT + "v269-styled.png" });

// 5) Reset outline → back to default stroke + no dash.
await page.locator('button:has-text("Reset outline")').first().click();
await page.waitForTimeout(300);
const reset = await outline();
check("V269 — Reset outline reverts to the default stroke and clears the dash",
  (reset.stroke || "").toLowerCase() === (base.stroke || "").toLowerCase() && (!reset.dash || reset.dash.trim() === ""),
  `stroke=${reset.stroke} dash="${reset.dash}"`);

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.length}\n` : "\nALL PASSED\n");
process.exit(fails.length ? 1 : 0);
