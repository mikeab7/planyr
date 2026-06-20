/* Verification for NEW-1 (header cleanup) + NEW-2 (cartographic furniture restyle).
 *
 * NEW-1: the dead hamburger (≡) and settings gear (⚙) are gone from the unified
 *        header, and Row 1 reflows cleanly (logo/breadcrumb left, account right) on
 *        both the Site and Schedule modules — no console errors.
 * NEW-2: the on-screen north arrow + scale bar render in their restyled, cartographic
 *        form (slim two-tone needle, thin segmented bar) over the planner canvas.
 *
 * Runs logged-out against the built app (vite preview on :4173). Seeds a located demo
 * site so the app boots straight into the planner with the furniture on screen.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e3", type: "paving", cx: 0, cy: 132, w: 420, h: 120, rot: 0 },
];
const demoSite = {
  id: "uiaudit-demo", groupId: "uiaudit-demo", site: "UI Audit Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);
// Frame the plan so the furniture sits at a representative zoom.
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch {}
await page.waitForTimeout(900);

// ── NEW-1: assert the dead controls are gone from the header ──────────────
const hamburger = await page.locator('header [aria-label="Menu"]').count();
const gear = await page.locator('header [aria-label="Settings"]').count();
// The header should still carry its live controls (logo wordmark + module tabs).
const wordmark = await page.locator('header:has-text("planyr")').count();
const siteTab = await page.locator('header button:has-text("Site")').count();

// ── NEW-2: assert the furniture renders, and check its restyled shape ─────
// The on-screen furniture lives in two <svg> plates inside the data-export="skip"
// overlay. Pull their inner markup to confirm the cartographic primitives.
const furn = await page.evaluate(() => {
  const overlay = [...document.querySelectorAll('div[data-export="skip"]')]
    .find((d) => d.querySelector("svg text") && /FEET|>N</.test(d.innerHTML));
  if (!overlay) return null;
  const html = overlay.innerHTML;
  return {
    hasFeet: />FEET</.test(html),
    hasN: />N</.test(html),
    hasCircle: /<circle/.test(html),     // a needle/segmented bar → must be false
    pathCount: (html.match(/<path /g) || []).length,   // needle halves
    rectCount: (html.match(/<rect /g) || []).length,   // plate + bar segments
    plateFill: /rgba\(249,248,244/.test(html),          // the new subtle warm plate
  };
});

await page.screenshot({ path: OUT + "new2-planner-full.png" });
await page.screenshot({ path: OUT + "new1-header.png", clip: { x: 0, y: 0, width: 1440, height: 80 } });
await page.screenshot({ path: OUT + "new2-northarrow.png", clip: { x: 0, y: 720, width: 240, height: 180 } });
await page.screenshot({ path: OUT + "new2-scalebar.png", clip: { x: 1120, y: 700, width: 320, height: 200 } });

// ── Schedule module: confirm the same clean header (no hamburger/gear) ────
await page.locator('header button:has-text("Schedule")').click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1200);
const hamburgerSched = await page.locator('header [aria-label="Menu"]').count();
const gearSched = await page.locator('header [aria-label="Settings"]').count();
await page.screenshot({ path: OUT + "new1-header-schedule.png", clip: { x: 0, y: 0, width: 1440, height: 80 } });

console.log(JSON.stringify({
  NEW1: { hamburger, gear, wordmark, siteTab, hamburgerSched, gearSched },
  NEW2: furn,
  consoleErrors: errors,
}, null, 2));

await ctx.close();
await browser.close();
