/* Headless drive for the Site Planner phone/narrow-viewport Properties access (B750 / V263 step 2)
 * — LOGGED OUT, on the BUILT app, at a NARROW width (<760px so `narrow` mode engages).
 *
 * ⛔ SUPERSEDED (NEW-1, phone-chrome-parity pass, 2026-09-12) — this used to drive the standalone
 * "✎ Properties" quick-access pill (B656): select an element, the pill appears, tap it to open the
 * companion. That pill is GONE — Properties is reached the same way on every width now: the
 * Panels edge tab opens the rail, and its "Properties" row is one of the tabs in it, exactly as
 * it's a tab inside the rail on desktop. The B556 guard this test exists to prove — a plain tap
 * only ever SELECTS, it never auto-opens the panel — is unchanged, so this still checks it; only
 * the "how do I open it on purpose" step changed. On narrow, the Properties tab keeps its
 * dedicated phone bottom-sheet presentation (`phoneSheetSolo`) rather than becoming an ordinary
 * left-side drawer panel, so the assertions below read the companion overlay the same way the
 * original pill flow did.
 *
 *  1. Selecting an element leaves the companion CLOSED (tap = select only) — and confirms the old
 *     "✎ Properties" pill no longer exists at all.
 *  2. Panels tab → "Properties" row OPENS the Properties companion (its property-panel renders).
 *  3. ✕ closes the companion — the element stays SELECTED.
 *
 * The element is DRAWN live (not seeded) — the narrow layout's fit doesn't frame a seeded parcel in
 * the headless sandbox, but a live draw exercises the exact select→open path the ticket describes.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
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
// Narrow viewport — below FLOAT_MIN_WIDTH (760) so the narrow layout engages.
const ctx = await browser.newContext({ viewport: { width: 720, height: 860 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-b750-phone-pill");
const fails = [];
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails.push(name); };
const panelCount = () => page.locator('[data-testid="property-panel"]').count();
const oldPillVisible = async () => {
  const p = page.locator('button:has-text("✎ Properties")');
  return (await p.count()) > 0 && (await p.first().isVisible());
};

// ⛔ B1231282 — a bare hash lands on the Dashboard, not the Site Planner (see
// verify-canvas-furniture.mjs's own header note on the same fix). Name the seeded groupId.
await page.goto(BASE + "#/project/S/site", { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 15000 });
await page.waitForTimeout(1500);

// Confirm we're in narrow mode (the Tools edge tab is narrow-only), then arm Building via that overlay.
const toolsTab = page.locator('[data-testid="mobile-tools-tab"]').first();
check("B750 (phone) — narrow layout engaged (the Tools edge tab is present)", (await toolsTab.count()) > 0);
await toolsTab.click();
await page.waitForTimeout(400);
await page.locator('button:has-text("Building")').first().click();
await page.waitForTimeout(300);

// Draw a building rectangle on the canvas.
const r = await page.locator('[data-testid="planner-canvas"]').boundingBox();
const A = { x: r.x + r.width * 0.35, y: r.y + r.height * 0.40 };
const B = { x: r.x + r.width * 0.62, y: r.y + r.height * 0.62 };
const C = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; // building centre
await page.mouse.move(A.x, A.y); await page.mouse.down();
await page.mouse.move(C.x, C.y, { steps: 5 }); await page.mouse.move(B.x, B.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "phone-selected.png" });

// 1) Drawn element is selected → the companion stays CLOSED (no auto-open), and the old
//    standalone "✎ Properties" pill (removed by NEW-1) does not exist at all.
const panel1 = await panelCount();
const oldPill1 = await oldPillVisible();
check("B750 (phone) — a plain draw/tap does NOT auto-open the companion (no property-panel yet)", panel1 === 0, `panels=${panel1}`);
check("B750 (phone) — the removed standalone '✎ Properties' pill does not exist (NEW-1)", !oldPill1, `oldPill=${oldPill1}`);

// 2) Panels edge tab → "Properties" row → the companion overlay opens.
const panelsTab = page.locator('[data-testid="mobile-panels-tab"]').first();
check("B750 (phone) — Panels edge tab is present", (await panelsTab.count()) > 0);
await panelsTab.click();
await page.waitForTimeout(300);
const propertiesRow = page.locator('[data-rail-tab="properties"]').first();
check("B750 (phone) — Properties row is present in the Panels drawer", (await propertiesRow.count()) > 0);
await propertiesRow.click();
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "phone-companion.png" });
const panel2 = await panelCount();
check("B750 (phone) — Panels → Properties OPENS the companion overlay", panel2 > 0, `panels=${panel2}`);

// 3) ✕ closes the companion.
await page.locator('[aria-label="Close properties"]').first().click();
await page.waitForTimeout(400);
const panel3 = await panelCount();
await page.screenshot({ path: OUT + "phone-closed.png" });
check("B750 (phone) — ✕ closes the companion", panel3 === 0, `panels=${panel3}`);

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.length}\n` : "\nALL PASSED\n");
process.exit(fails.length ? 1 : 0);
