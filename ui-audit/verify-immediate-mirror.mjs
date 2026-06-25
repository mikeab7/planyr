/* B458 — the data-loss fix. The autosave used to debounce BOTH the on-device localStorage mirror AND
 * the version-history snapshot by 400ms, so a reload within that window lost the edit from cloud, the
 * local mirror, AND history at once (the structural cause of the 8 South / Plan 1 building-loss). The
 * fix writes the device mirror IMMEDIATELY on every edit (history on, so the rollback snapshot is
 * reload-safe too); only the cloud push stays debounced.
 *
 * This harness proves it end-to-end, logged-out (this-device), WITHOUT auth:
 *   1. Draw a markup → read localStorage at 150ms (well under the 400ms debounce). Under the OLD code
 *      the edit would NOT be there yet; with B458 it is → the immediate mirror write beat the debounce.
 *   2. The version-history snapshot is ALSO present at 150ms (history is reload-safe now too).
 *   3. Reload immediately and assert the edit SURVIVES (the real anti-data-loss outcome).
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-immediate-mirror.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";
const HIST_KEY = "planarfit:sites:history:v1";
const DEBOUNCE_MS = 400;            // the cloud-push debounce in SitePlanner.jsx
const READ_AT_MS = 150;             // read the mirror BEFORE the debounce could have fired

// A georeferenced this-device site with one road (so there's prior content for the history snapshot
// to back up). currentSite opens straight into the planner canvas.
const road = { id: "r1", type: "road", cx: 0, cy: 0, w: 400, h: 30, rot: 0, travelW: 24, curb: 0.5 };
const sites = { s1: { id: "s1", groupId: "s1", site: "Verify B458", name: "Plan 1", status: "active",
  origin: { lat: 29.78, lon: -95.79 }, county: "harris",
  parcels: [{ id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] }],
  els: [road], markups: [], updatedAt: Date.now() } };
const seed = `(()=>{try{if(localStorage.getItem("__b458__"))return;localStorage.setItem(${JSON.stringify(SITES_KEY)},${JSON.stringify(JSON.stringify(sites))});localStorage.setItem("planarfit:currentSite:v1","s1");localStorage.setItem("__b458__","1");}catch(e){}})();`;

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// Largest SVG = the planner canvas.
const box = await page.evaluate(() => { let z = null, a = 0; for (const s of document.querySelectorAll("svg")) { const r = s.getBoundingClientRect(); if (r.width * r.height > a) { a = r.width * r.height; z = r; } } return z ? { x: z.x, y: z.y, w: z.width, h: z.height } : null; });
if (!box) { console.log("✗ no canvas SVG found"); await browser.close(); process.exit(1); }
const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;

// Read the stored content from the device mirror (the s1 row). Total = drawn items across collections,
// so the proof is robust to which collection the markup lands in.
const readStore = () => page.evaluate((key) => {
  try {
    const all = JSON.parse(localStorage.getItem(key) || "{}");
    const s = all.s1; if (!s) return { found: false, total: 0 };
    const n = (x) => (Array.isArray(x) ? x.length : 0);
    return { found: true, total: n(s.els) + n(s.markups) + n(s.measures) + n(s.callouts) };
  } catch (e) { return { found: false, total: 0, err: String(e) }; }
}, SITES_KEY);
const histLen = () => page.evaluate((k) => { try { return (JSON.parse(localStorage.getItem(k) || "{}").s1 || []).length; } catch (e) { return -1; } }, HIST_KEY);
const domRects = () => page.evaluate(() => document.querySelectorAll("svg rect[stroke]").length);

const baseline = await readStore();
check("baseline mirror has the seeded content (1 road, 0 markups)", baseline.found && baseline.total === 1, `total=${baseline.total}`);
const histBefore = await histLen();

// --- Make ONE real edit: arm the rectangle markup tool ("r") and drag to commit a markup. ---
const r0 = await domRects();
await page.keyboard.press("r"); await page.waitForTimeout(150);
await page.mouse.move(cx + 120, cy - 170); await page.mouse.down();
await page.mouse.move(cx + 280, cy - 70, { steps: 6 }); await page.mouse.up();
// Read the mirror at 150ms — BEFORE the 400ms cloud-push debounce could have written it.
await page.waitForTimeout(READ_AT_MS);
const drewInDom = (await domRects()) > r0;
const atRead = await readStore();
const histAtRead = await histLen();
check("the markup registered in the canvas (edit really happened)", drewInDom, `Δrect=${(await domRects()) - r0}`);
check(`edit is in the device mirror at ${READ_AT_MS}ms — BEFORE the ${DEBOUNCE_MS}ms debounce (immediate write)`, atRead.found && atRead.total === baseline.total + 1, `total ${baseline.total}→${atRead.total}`);
check(`version-history snapshot present at ${READ_AT_MS}ms (rollback is reload-safe too)`, histAtRead > histBefore, `hist ${histBefore}→${histAtRead}`);
await page.screenshot({ path: OUT + "b458-after-edit.png" });

// --- Reload immediately and assert the edit SURVIVES (the real anti-data-loss outcome). ---
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const afterReload = await readStore();
check("edit SURVIVES an immediate reload (mirror restored on boot)", afterReload.found && afterReload.total === baseline.total + 1, `total=${afterReload.total}`);
await page.screenshot({ path: OUT + "b458-after-reload.png" });
check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB458 immediate-mirror: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
