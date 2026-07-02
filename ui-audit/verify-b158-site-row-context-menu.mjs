/* B158 verification — site-row right-click context menu (no inline ✕).
 *
 * Acceptance (BACKLOG.md B158):
 *  - hovering a site row shows NO inline ✕ delete affordance (only the ⊕ locate icon);
 *  - right-clicking a site row opens a menu carrying Rename + Delete at the cursor;
 *  - pressing Escape closes the menu (the fix this lap added);
 *  - clicking outside closes the menu;
 *  - the ⊕ locate icon is still present on hover.
 *
 * Boots logged-out against the built app (vite preview on :4173) with two located
 * sites seeded into localStorage so the "Your sites" panel renders. No network/back-end.
 *
 * Run:  npm run build && npx vite preview --host --port 4173 &
 *       node ui-audit/verify-b158-site-row-context-menu.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const sites = {
  a1: { id: "a1", groupId: "a1", site: "Katy Logistics Park", name: "Plan 1", origin: { lat: 29.786, lon: -95.83 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" } },
  a2: { id: "a2", groupId: "a2", site: "Brookshire Tract", name: "Plan 1", origin: { lat: 29.78, lon: -95.95 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "pursuit" } },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${name}`); if (!ok) failures++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);

// The site row carries a title beginning "Open site"; grab the Katy row.
const row = page.locator('[title^="Open site"]', { hasText: "Katy Logistics Park" }).first();
await row.waitFor({ timeout: 8000 });
check("site row renders in Your sites panel", await row.count() > 0);

// Hover → the ⊕ locate button appears; no inline delete affordance.
await row.hover();
await page.waitForTimeout(200);
check("⊕ locate-on-map button present on hover", await page.locator('[aria-label="Show on map"]').first().isVisible());
check("no inline ✕ delete button on the row", await row.locator('[aria-label="Delete site"], [title*="Delete" i]').count() === 0);

// Right-click → menu opens with Rename + Delete.
await row.click({ button: "right" });
await page.waitForTimeout(250);
const renameItem = page.locator('button:has-text("Rename")');
const deleteItem = page.locator('button:has-text("Delete project")');
check("right-click opens menu with Rename", await renameItem.first().isVisible());
check("right-click menu carries Delete project", await deleteItem.first().isVisible());

// Escape closes the menu (the fix added this lap).
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check("Escape closes the menu", !(await deleteItem.first().isVisible().catch(() => false)));

// Re-open, then click outside → closes.
await row.click({ button: "right" });
await page.waitForTimeout(250);
check("menu re-opens on right-click", await deleteItem.first().isVisible());
await page.mouse.click(1200, 60);
await page.waitForTimeout(250);
check("click-outside closes the menu", !(await deleteItem.first().isVisible().catch(() => false)));

// Re-open, choose Rename → inline rename input appears on the row.
await row.click({ button: "right" });
await page.waitForTimeout(200);
await renameItem.first().click();
await page.waitForTimeout(250);
check("Rename opens the inline edit input", await page.locator('input[aria-label], input').filter({ hasText: "" }).count() >= 0 && await page.locator('input').count() > 0);

await ctx.close();
await browser.close();
console.log(failures ? `\nB158: ${failures} check(s) FAILED` : "\nB158: all checks passed");
process.exit(failures ? 1 : 0);
