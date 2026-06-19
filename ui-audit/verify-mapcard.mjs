/* B167 + B168 verification: map finder loads with no "Drag to move" hint bubble,
 * and the project card's right-click menu offers Change status + Delete (no inline ✕).
 * Run: node ui-audit/verify-mapcard.mjs  (vite preview must be running on :4173) */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Two seeded sites WITH origins (so they appear both as map markers and as cards in
// the "Your sites" panel). No currentSite → the app lands on the MapFinder, not the planner.
const sites = {
  s1: { id: "s1", groupId: "s1", site: "JFK", name: "Plan 1", status: "pursuit",
        origin: { lat: 29.78, lon: -95.55 }, county: "harris",
        parcels: [{ id: "p1", points: [{ x: -600, y: -400 }, { x: 600, y: -400 }, { x: 600, y: 400 }, { x: -600, y: 400 }] }],
        els: [], updatedAt: Date.now() },
  s2: { id: "s2", groupId: "s2", site: "Schiel Rd", name: "Plan 1", status: "active",
        origin: { lat: 29.74, lon: -95.50 }, county: "harris",
        parcels: [{ id: "p2", points: [{ x: -300, y: -300 }, { x: 300, y: -300 }, { x: 300, y: 300 }, { x: -300, y: 300 }] }],
        els: [], updatedAt: Date.now() },
};
const seed = `(() => { try {
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
  localStorage.removeItem("planarfit:currentSite:v1");
  localStorage.setItem("planarfit:mapHintDismissed:v1", "");  // ensure a stale flag can't mask a regression
  localStorage.removeItem("planarfit:mapHintDismissed:v1");
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text()); });

await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 1) No "Drag to move the map" bubble anywhere (B167).
const hintCount = await page.locator("text=/Drag to move the map/i").count();
console.log(`B167 — "Drag to move the map" bubble present: ${hintCount > 0 ? "YES (FAIL)" : "no (PASS)"}`);

// 2) The "Your sites" panel shows cards but no inline ✕ delete button (B168).
const panel = page.locator("text=Your sites");
const panelVisible = await panel.count();
console.log(`Your-sites panel visible: ${panelVisible > 0 ? "yes" : "NO"}`);
const delBtns = await page.locator('button[aria-label="Delete site"]').count();
console.log(`B168 — inline 'Delete site' ✕ buttons on cards: ${delBtns} (expect 0)`);

await page.screenshot({ path: OUT + "mapcard-1-loaded.png" });

// 3) Right-click the JFK card row → context menu with status options + Delete project.
const row = page.locator('div[title*="right-click for status"]').first();
const rowBox = await row.boundingBox();
if (rowBox) {
  await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2, { button: "right" });
  await page.waitForTimeout(400);
}
const hasDelete = await page.locator("text=/Delete project/i").count();
const hasStatuses = await page.locator('text=On Hold').count();
console.log(`B168 — right-click menu has 'Delete project…': ${hasDelete > 0 ? "yes (PASS)" : "NO (FAIL)"}`);
console.log(`B168 — right-click menu has status options (On Hold): ${hasStatuses > 0 ? "yes (PASS)" : "NO (FAIL)"}`);
await page.screenshot({ path: OUT + "mapcard-2-rightclick-menu.png" });

await browser.close();
console.log("Screens written to ui-audit/screens/");
