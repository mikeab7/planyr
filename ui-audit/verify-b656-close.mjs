/* Self-verification for the B656 follow-up — a Close (✕) on the Element companion.
 *
 * Owner ask (2026-07-06): the companion Properties panel needs an explicit close on desktop; the
 * ✕ must HIDE the panel but KEEP the element selected (handles stay), and re-clicking the element
 * reopens it. It must coexist with an open panel (close props → Yield stays) and must NOT leave a
 * blank rail column / phantom offset behind.
 *
 * Run: node ui-audit/verify-b656-close.mjs   (preview server up on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-b656-close";

const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -450 }, { x: 900, y: -450 }, { x: 900, y: 450 }, { x: -900, y: 450 }] };
const building = { id: "e1", type: "building", cx: 0, cy: 0, w: 460, h: 300, rot: 0 };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B656 close", name: "Plan 1", status: "active", origin: null, county: null,
  parcels: [parcel], els: [building], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// the building is a filled, clickable <rect> in the canvas SVG; the panel shift-compensation keeps
// the drawing visually stationary, so its baseline screen centre stays a valid click target throughout.
const buildingCenter = () => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].sort((a, b) => { const ba = a.getBoundingClientRect(), bb = b.getBoundingClientRect(); return bb.width * bb.height - ba.width * ba.height; })[0];
  const sb = svg.getBoundingClientRect();
  const cx = sb.x + sb.width / 2, cy = sb.y + sb.height / 2;
  let best = null, bestD = Infinity;
  for (const r of svg.querySelectorAll("rect")) {
    if (getComputedStyle(r).pointerEvents !== "auto") continue;
    const f = (r.getAttribute("fill") || "").toLowerCase();
    if (!f || f === "none") continue;
    const b = r.getBoundingClientRect();
    if (b.width < 40 || b.height < 40) continue;
    const mx = b.x + b.width / 2, my = b.y + b.height / 2;
    const d = (mx - cx) ** 2 + (my - cy) ** 2;
    if (d < bestD) { bestD = d; best = { x: Math.round(mx), y: Math.round(my) }; }
  }
  return best;
});
const panelVisible = () => page.locator('[data-testid="property-panel"]').count().then((n) => n > 0);
// selection chrome uses SEL_BLUE (#2563eb / rgb(37,99,235)); >0 ⇒ an element is selected
const selChromeCount = () => page.evaluate(() => {
  let n = 0;
  for (const el of document.querySelectorAll("svg *")) {
    const s = (el.getAttribute("stroke") || "").toLowerCase();
    if (s === "#2563eb") n++;
  }
  return n;
});
// the open left-menu column is the flyout mounted beside the 54px rail; it carries
// data-testid="left-menu-panel" and is unmounted when no panel is open (B689 — was a
// brittle match on the panel's surface colour, which broke once the shell shared it).
const panelColumnWidth = () => page.evaluate(() => {
  const d = document.querySelector('[data-testid="left-menu-panel"]');
  if (!d) return 0;
  const b = d.getBoundingClientRect();
  return (b.width > 120 && b.height > 300) ? Math.round(b.width) : 0;
});
// capture the building's baseline screen centre once; compensation keeps it a valid target
const B = await buildingCenter();
if (!B) { console.log("✗ could not locate the building rect to click"); await browser.close(); process.exit(1); }
// click OFF-centre — the centred element label box eats a dead-centre click
const clickBuilding = async () => { await page.mouse.click(B.x - 60, B.y - 40); await page.waitForTimeout(300); };

log(!(await panelVisible()), "baseline: no property panel when nothing is selected");

// ---- 1. select the building → companion appears
await clickBuilding();
const selAfterClick = await selChromeCount();
log(await panelVisible(), "select element → Element companion appears (property-panel present)");
log(selAfterClick > 0, `select element → selection chrome present (${selAfterClick} node(s))`);

// ---- 2. click the ✕ → companion hides, element STAYS selected
const closeBtn = page.locator('button[aria-label="Close properties"]');
log(await closeBtn.count() > 0, "close (✕) button is present in the companion header on desktop");
await closeBtn.first().click();
await page.waitForTimeout(300);
log(!(await panelVisible()), "after ✕ → property panel is gone");
const selAfterClose = await selChromeCount();
log(selAfterClose > 0, `after ✕ → element STAYS selected (selection chrome still ${selAfterClose} node(s))`);
log(await panelColumnWidth() === 0, "after ✕ (no other panel open) → no leftover panel column / blank rail");

// ---- 3. click the element again → companion reopens
await clickBuilding();
log(await panelVisible(), "click the element again → companion reopens");

// ---- 4. coexistence: Yield open + selection, then ✕ leaves Yield untouched
// close companion first, open Yield from the rail
await page.locator('button[aria-label="Close properties"]').first().click().catch(() => {});
await page.waitForTimeout(200);
// click the Yield rail button (glyph ∑ + label Yield)
const yieldBtn = page.locator('button', { hasText: "Yield" }).first();
await yieldBtn.click();
await page.waitForTimeout(300);
const yieldOpen = await panelColumnWidth();
log(yieldOpen > 0, `Yield panel opens (column width ${yieldOpen}px)`);
await clickBuilding(); // select building while Yield is open
log(await panelVisible(), "with Yield open, selecting an element shows BOTH (property-panel + Yield coexist)");
// ✕ should hide props but keep Yield
await page.locator('button[aria-label="Close properties"]').first().click();
await page.waitForTimeout(300);
log(!(await panelVisible()), "with Yield open, ✕ hides props");
log(await panelColumnWidth() > 0, "with Yield open, ✕ leaves the Yield panel in place (no gap/collapse)");
const selWithYield = await selChromeCount();
log(selWithYield > 0, `with Yield open, ✕ keeps the element selected (${selWithYield} node(s))`);

await page.screenshot({ path: OUT + "b656-close-after.png" });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
