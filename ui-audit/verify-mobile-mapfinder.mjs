/* Verify the mobile (≤760px) MapFinder reflow (owner request, 2026-06-27):
 *  1. The "Select parcels" button is visible and NOT covered by another panel
 *     (the bug: side panels overlapped the centered pill and hid it).
 *  2. The "Your sites" panel defaults CLOSED on a phone (its list rows are absent).
 *  3. The full-width search bar sits above the two side panels (no vertical overlap).
 *
 * Run: BASE_URL=http://localhost:4173/ node ui-audit/verify-mobile-mapfinder.mjs
 *      (vite preview must be serving the built app)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux/chrome";

const sites = {
  a1: { id: "a1", groupId: "a1", site: "Katy Logistics Park", name: "Plan 1", origin: { lat: 29.786, lon: -95.83 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" } },
  a2: { id: "a2", groupId: "a2", site: "Brookshire Tract", name: "Plan 1", origin: { lat: 29.78, lon: -95.95 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "pursuit" } },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
  localStorage.removeItem('planarfit:sitesPanelClosed:v1');
} catch (e) {} })();`;

const overlaps = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

// 1. Select parcels button visible + fully on-screen.
const selBtn = page.locator('button:has-text("Select parcels")');
const selVisible = await selBtn.isVisible().catch(() => false);
const selBox = selVisible ? await selBtn.boundingBox() : null;
check("Select-parcels button is visible", selVisible);
check("Select-parcels button is within the viewport", !!selBox && selBox.x >= 0 && selBox.x + selBox.width <= 390 && selBox.y >= 0,
  selBox ? `x=${selBox.x.toFixed(0)} w=${selBox.width.toFixed(0)} right=${(selBox.x + selBox.width).toFixed(0)}` : "no box");

// 2. The button is not covered: elementFromPoint at its center returns the button (or a descendant).
const covered = selBox ? await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return !(el && (el.closest("button") && /Select parcels/.test(el.closest("button").textContent || "")));
}, { x: selBox.x + selBox.width / 2, y: selBox.y + selBox.height / 2 }) : true;
check("Select-parcels button is the top element at its center (not covered)", !covered);

// 3. Your sites panel defaults closed — the per-site rows are not rendered.
const siteRow = page.locator('text=Katy Logistics Park');
const rowVisible = await siteRow.isVisible().catch(() => false);
check("Your sites list is collapsed by default (no site rows shown)", !rowVisible);

// The collapsed "Your sites" header IS present (panel still reachable by tap).
const sitesHeader = page.locator('button:has-text("Your sites")');
check("Your sites header (tap-to-open) is present", await sitesHeader.isVisible().catch(() => false));

// 4. The search bar sits above the side panels (no overlap with the layers panel chip).
const bar = await selBtn.evaluate((el) => { const r = el.closest("div").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }).catch(() => null);
const layersChip = page.locator('button:has-text("Imagery & layers")');
const layersBox = await layersChip.boundingBox().catch(() => null);
check("Search bar does not overlap the layers chip", !overlaps(bar, layersBox),
  bar && layersBox ? `bar.bottom=${(bar.y + bar.height).toFixed(0)} chip.top=${layersBox.y.toFixed(0)}` : "");

await page.screenshot({ path: new URL("./screens/mobile-mapfinder.png", import.meta.url).pathname });
console.log("\nsaved screens/mobile-mapfinder.png");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
