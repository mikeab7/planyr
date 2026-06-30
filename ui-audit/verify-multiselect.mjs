/* Self-verification for B569 (multi-select in the default pointer) + B570 (marquee box-select tool).
 *   B569 — Ctrl/⌘-click toggles an object in/out of the selection; the neutral hue-free chrome
 *          (light casing + dark line + corner grips) renders; multi-move + multi-delete (one undo).
 *   B570 — a dedicated Marquee rail tool with a LIT active state; drag a box → everything it
 *          touches is selected into the same set; then move/delete come for free from B569.
 * Seeds a plan with two separated elements (building + parking), boots the planner logged-out,
 * and drives the SVG canvas. (Logged-out is fine — the planner is fully usable signed-out.)
 * Plan-style fills: building #f3ece1 · parking #cdd7dd · neutral selection line #1B1E26. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const A_ID = "verify-msel";
const mkSite = () => ({ id: A_ID, groupId: A_ID, site: "Verify Multiselect", name: "Plan 1", origin: null, county: null,
  parcels: [], els: [
    { id: "b1", type: "building", cx: 60, cy: 0, w: 180, h: 140, rot: 0, dock: "none" },
    { id: "p1", type: "parking", cx: 380, cy: 0, w: 180, h: 140, rot: 0 },
  ], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() });

const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [A_ID]: mkSite() })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(A_ID)});
  localStorage.setItem('planyr.theme', 'light'); // deterministic theme so --sel-line resolves to #1B1E26
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seedScript);
const page = await ctx.newPage();
const errors = [];
// Ignore sandbox network noise — the TLS-inspection proxy blocks external tiles/resources, which
// surface as ERR_TUNNEL/ERR_CONNECTION console errors that have nothing to do with the app.
const isNetNoise = (s) => /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource/i.test(s);
page.on("pageerror", (e) => { if (!isNetNoise(String(e))) errors.push(String(e)); });
page.on("console", (m) => { if (m.type() === "error" && !isNetNoise(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);

const fit = async () => { try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(400); };
const centerOf = (fill) => page.evaluate((f) => {
  let best = null;
  for (const r of document.querySelectorAll("svg rect")) {
    if ((r.getAttribute("fill") || "").toLowerCase() !== f) continue;
    const b = r.getBoundingClientRect();
    if (b.width < 8 || b.height < 8) continue;
    if (!best || b.width * b.height > best.area) best = { x: b.x + b.width / 2, y: b.y + b.height / 2, area: b.width * b.height };
  }
  return best;
}, fill);
// Count the neutral selection-chrome outline rects (fill:none, stroke = the --sel-line ink in
// either theme: #1B1E26 light / #15171C dark) = one per selected member.
const selChromeCount = () => page.evaluate(() => {
  const ink = new Set(["#1b1e26", "#15171c"]);
  let n = 0;
  for (const r of document.querySelectorAll("svg rect")) {
    const stroke = (r.getAttribute("stroke") || "").toLowerCase();
    const fill = (r.getAttribute("fill") || "").toLowerCase();
    if (ink.has(stroke) && fill === "none") n++;
  }
  return n;
});
const bbox = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; }, sel);
const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2); await page.mouse.move(to.x, to.y); await page.mouse.move(to.x, to.y); await page.mouse.up(); await page.waitForTimeout(300); };
const modClick = async (pt, key) => { await page.keyboard.down(key); await page.mouse.click(pt.x, pt.y); await page.keyboard.up(key); await page.waitForTimeout(200); };

await fit();

/* ───────────── B570 — the dedicated Marquee rail tool ───────────── */
const marqueeBtn = page.locator('[data-testid="tool-marquee"]');
log(await marqueeBtn.count() > 0, "B570 the Marquee tool has its own rail button (data-testid=tool-marquee)");
await marqueeBtn.click();
await page.waitForTimeout(200);
log((await marqueeBtn.getAttribute("aria-pressed")) === "true", "B570 selecting Marquee LIGHTS the button (aria-pressed=true) — clear active feedback");

// Drag a box around BOTH elements → both selected into the shared set.
let b = await centerOf("#f3ece1"), p = await centerOf("#cdd7dd");
log(!!b && !!p, `two separate elements present (building ${!!b}, parking ${!!p})`);
const box = await bbox("svg");
// from just outside the top-left of the building to just past the bottom-right of the parking
await drag({ x: Math.min(b.x, p.x) - 70, y: Math.min(b.y, p.y) - 90 }, { x: Math.max(b.x, p.x) + 70, y: Math.max(b.y, p.y) + 90 });
const after = await selChromeCount();
log(after >= 2, `B570 marquee drag selected BOTH elements — neutral multi-select chrome rendered (${after} member outlines)`);

/* ───────────── B569 — neutral chrome, multi-move, multi-delete + one-step undo ───────────── */
// Multi-move: the marquee handed the set to Select; dragging one member moves BOTH.
b = await centerOf("#f3ece1"); p = await centerOf("#cdd7dd");
const b0 = { ...b }, p0 = { ...p };
await drag(b, { x: b.x + 70, y: b.y + 80 });
const b1 = await centerOf("#f3ece1"), p1 = await centerOf("#cdd7dd");
const bMoved = Math.hypot(b1.x - b0.x, b1.y - b0.y), pMoved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
log(bMoved > 30 && pMoved > 30, `B569 multi-MOVE: dragging one member moved the WHOLE selection (building Δ=${bMoved.toFixed(0)}px, parking Δ=${pMoved.toFixed(0)}px)`);

// Multi-delete: Delete removes both; Ctrl+Z restores both in ONE undo step.
await page.keyboard.press("Delete");
await page.waitForTimeout(300);
const goneB = await centerOf("#f3ece1"), goneP = await centerOf("#cdd7dd");
log(!goneB && !goneP, "B569 multi-DELETE removed both selected elements");
await page.keyboard.press("Control+z");
await page.waitForTimeout(400);
const backB = await centerOf("#f3ece1"), backP = await centerOf("#cdd7dd");
log(!!backB && !!backP, "B569 a SINGLE undo restored BOTH (multi-delete is one undo step)");

/* ───────────── B569 — Ctrl/⌘-click toggle in the default pointer ───────────── */
await page.locator('[title="Zoom to fit"]').first().click().catch(() => {});
await page.waitForTimeout(300);
// Back to the Select tool
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /(^|\s)Select(\s|$)/.test((x.textContent || "").trim())); if (b) b.click(); });
await page.waitForTimeout(200);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
b = await centerOf("#f3ece1"); p = await centerOf("#cdd7dd");
await page.mouse.click(b.x, b.y);            // single-select the building
await page.waitForTimeout(150);
await modClick(p, "Control");                // Ctrl-click adds the parking → {building, parking}
const both = await selChromeCount();
log(both >= 2, `B569 Ctrl/⌘-click ADDED a second object to the selection (${both} member outlines)`);
await modClick(p, "Control");                // Ctrl-click again toggles the parking back OUT
const oneLeft = await selChromeCount();
log(oneLeft < both, `B569 Ctrl/⌘-click again TOGGLED that object back out of the selection (${both} → ${oneLeft})`);

await page.screenshot({ path: OUT + "multiselect.png" });
console.log(errors.length ? `page errors:\n${errors.slice(0, 6).join("\n")}` : "(no page errors)");
if (errors.length) fail++;

await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL B569/B570 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
