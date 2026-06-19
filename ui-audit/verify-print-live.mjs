// Live smoke test for the print/export tranche (B191–B196): seeds a site with two
// differently-sized buildings, opens the planner, enters print mode, opens the print
// Options flyout (B193), and selects a building to show its clear-height/slab fields
// (B192). Captures console/page errors; logged-out (no auth needed).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "print-verify-1";
// 250,000 sf (500×500 → 36'/7") and 95,000 sf (380×250 → 32'/6").
const els = [
  { id: "b1", type: "building", cx: -300, cy: 0, w: 500, h: 500, rot: 0, dock: "cross" },
  { id: "b2", type: "building", cx: 360, cy: 0, w: 380, h: 250, rot: 0, dock: "single" },
];
const parcel = { id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] };
const demoSite = { id: DEMO_ID, groupId: DEMO_ID, site: "Cypress Logistics", name: "Plan 1", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.addInitScript(({ id, site }) => {
  localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: site }));
  localStorage.setItem("planarfit:currentSite:v1", JSON.stringify(id));
}, { id: DEMO_ID, site: demoSite });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
// The app opens to the Map Finder; open the seeded site into the planner.
await page.locator('text=Cypress Logistics').first().click({ timeout: 8000 }).catch((e) => errors.push("open site: " + e.message));
await page.waitForTimeout(1200);

const log = {};
// Open File ▾ menu → Print / pick frame…
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 }).catch((e) => errors.push("File menu: " + e.message));
await page.waitForTimeout(300);
await page.locator('button:has-text("Print / pick frame")').first().click({ timeout: 8000 }).catch((e) => errors.push("Print item: " + e.message));
await page.waitForTimeout(500);
log.printToolbar = await page.locator('text=Print frame').count();
// Open the Options flyout (B193)
await page.locator('button:has-text("Options ▾")').first().click({ timeout: 8000 }).catch((e) => errors.push("Options btn: " + e.message));
await page.waitForTimeout(400);
log.optionsFlyout = await page.locator('text=Defaults by building size').count();
log.perBuilding = await page.locator('text=Per-building overrides').count();
log.clearHeightLabel = await page.locator('text=Clear height').count();
await page.screenshot({ path: "ui-audit/screens/print-live-options.png" });
// Close flyout + cancel print mode, then select a building to check the inspector fields.
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(150);
await page.locator('button:has-text("Cancel")').first().click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(200);
// Click near the larger building (left of centre) to select it.
await page.mouse.click(560, 450);
await page.waitForTimeout(400);
log.selClearField = await page.locator('text=Clear height (ft)').count();
log.selSlabField = await page.locator('text=Slab (in)').count();
await page.screenshot({ path: "ui-audit/screens/print-live-inspector.png" });

await browser.close();
console.log("log:", JSON.stringify(log));
console.log("errors (" + errors.length + "):", JSON.stringify(errors.slice(0, 12), null, 2));
process.exit(errors.length ? 1 : 0);
