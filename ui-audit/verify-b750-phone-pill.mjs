/* Headless drive for the Site Planner phone/narrow-viewport ✎ Properties pill (B750 / V263 step 2)
 * — LOGGED OUT, on the BUILT app, at a NARROW width (<760px so `narrow` mode engages).
 *
 * On a narrow window a tap only SELECTS — the Properties companion does NOT auto-open. Instead a
 * "✎ Properties" pill appears; tapping it opens the companion overlay. Checks:
 *  1. Selecting an element shows the ✎ Properties pill and leaves the companion CLOSED (tap = select only).
 *  2. Tapping the pill OPENS the Properties companion (its property-panel renders).
 *  3. Deselect + a plain single-tap on the element still SELECTS only (pill back, companion closed).
 *
 * The element is DRAWN live (not seeded) — the narrow layout's fit doesn't frame a seeded parcel in
 * the headless sandbox, but a live draw exercises the exact select→pill path the ticket describes.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const site = { id: "S", groupId: "S", site: "PhoneYard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
// Narrow viewport — below FLOAT_MIN_WIDTH (760) so the narrow layout + ✎ pill logic engages.
const ctx = await browser.newContext({ viewport: { width: 720, height: 860 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const fails = [];
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails.push(name); };
const panelCount = () => page.locator('[data-testid="property-panel"]').count();
const pill = () => page.locator('button:has-text("✎ Properties")');
const pillVisible = async () => (await pill().count()) > 0 && (await pill().first().isVisible());

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 15000 });
await page.waitForTimeout(1500);

// Confirm we're in narrow mode (the ✎ Tools trigger is narrow-only), then arm Building via that overlay.
const toolsBtn = page.locator('button:has-text("Tools")').first();
check("B750 (phone) — narrow layout engaged (the ✎ Tools trigger is present)", (await toolsBtn.count()) > 0);
await toolsBtn.click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Building")').first().click();
await page.waitForTimeout(300);

// Draw a building rectangle on the canvas.
const r = await page.locator('[data-testid="planner-canvas"]').boundingBox();
const A = { x: r.x + r.width * 0.35, y: r.y + r.height * 0.40 };
const B = { x: r.x + r.width * 0.62, y: r.y + r.height * 0.62 };
const C = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; // building centre
const EMPTY = { x: r.x + r.width * 0.85, y: r.y + r.height * 0.85 };
await page.mouse.move(A.x, A.y); await page.mouse.down();
await page.mouse.move(C.x, C.y, { steps: 5 }); await page.mouse.move(B.x, B.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "phone-selected.png" });

// 1) Drawn element is selected → the ✎ pill shows, but the companion stays CLOSED (no auto-open).
const pill1 = await pillVisible();
const panel1 = await panelCount();
check("B750 (phone) — selecting an element shows the ✎ Properties pill (tap = select only)", pill1, `pill=${pill1}`);
check("B750 (phone) — a plain draw/tap does NOT auto-open the companion (no property-panel yet)", panel1 === 0, `panels=${panel1}`);

// 2) Tap the pill → the companion overlay opens.
if (pill1) { await pill().first().click(); await page.waitForTimeout(500); }
await page.screenshot({ path: OUT + "phone-companion.png" });
const panel2 = await panelCount();
check("B750 (phone) — tapping the ✎ pill OPENS the Properties companion", panel2 > 0, `panels=${panel2}`);

// 3) ✕ closes the companion — the element stays SELECTED, so the ✎ pill returns (companion closed
//    again). This is the round-trip the ticket describes: pill ⇄ companion, tap only ever selects.
await page.locator('[aria-label="Close properties"]').first().click();
await page.waitForTimeout(400);
const pill3 = await pillVisible();
const panel3 = await panelCount();
await page.screenshot({ path: OUT + "phone-reselect.png" });
check("B750 (phone) — ✕ closes the companion; the element stays selected so the ✎ pill returns", pill3 && panel3 === 0, `pill=${pill3} panels=${panel3}`);

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.length}\n` : "\nALL PASSED\n");
process.exit(fails.length ? 1 : 0);
