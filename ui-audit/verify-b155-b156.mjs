/* Self-verification for B155 (one shared selection picker) + B156 (pre-click hover preview),
 * driven in the REAL built app, logged-out. Two surfaces:
 *
 *   SITE PLANNER (seeded site, an UNFILLED rect markup):
 *     • hovering the rect's INTERIOR shows the pre-click hover glow ([data-hover="1"] + .mk-hover);
 *     • CLICKING that same interior point selects the rect (interior-grab, shared-rule parity);
 *     • the hover element is the markup the click grabs (hover == click, same SVG hit-testing);
 *     • moving off the markup clears the glow; a selected markup shows no hover glow.
 *
 *   DOCUMENT REVIEW (fixture PDF, a drawn rect):
 *     • the click routes through the shared pickMarkup — clicking the rect INTERIOR selects it
 *       (the single-select Delete × appears);
 *     • hovering the interior shows the glow at the exact point a click selects; moving off clears it.
 *
 * Ground truth = the live DOM the browser actually hit-tests. Run with the preview server on :4173:
 *   npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-b155-b156.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const FIXTURE = fileURLToPath(new URL("../e2e/fixtures/sample.pdf", import.meta.url));

let fail = 0;
const ok = (label, cond, extra = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? "  — " + extra : ""}`); if (!cond) fail++; };

/* ---------------- Site Planner seed: one UNFILLED rect markup, off the acreage-chip centroid ---------------- */
const DEMO_ID = "verify-b155-b156";
const rectMk = { id: "mk_rect", kind: "rect", cx: 300, cy: -200, w: 420, h: 300, rot: 0, stroke: "#c2410c", weight: 2, dash: "solid", fill: "#c2410c", fillOpacity: 0 };
const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -600 }, { x: 700, y: -600 }, { x: 700, y: 600 }, { x: -700, y: 600 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B155/B156", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [rectMk],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, colorScheme: "light" });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const isNoise = (s) => /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i.test(s);
page.on("pageerror", (e) => { if (!isNoise(String(e))) errors.push(String(e)); });
page.on("console", (m) => { if (m.type() === "error" && !isNoise(m.text())) errors.push(m.text()); });

const hoverCount = () => page.evaluate(() => document.querySelectorAll('[data-hover="1"]').length);
const panelText = () => page.evaluate(() => { const p = document.querySelector('[data-testid="property-panel"]'); return p ? p.textContent : ""; });

/* ================= SITE PLANNER ================= */
console.log("\n== SITE PLANNER — B156 hover + B155 interior-grab (shared rules) ==");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch { /* ignore */ }
await page.waitForTimeout(600);

const rectGeom = await page.evaluate(() => {
  const r = document.querySelector('rect[stroke="#c2410c"]');
  if (!r) return null;
  const b = r.getBoundingClientRect();
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, farX: b.x + b.width + 120, farY: b.y + b.height + 120 };
});
ok("unfilled rect markup rendered", !!rectGeom && rectGeom.w > 40, rectGeom ? `w=${Math.round(rectGeom.w)}` : "not found");

if (rectGeom) {
  // start well away so entering the rect is a real pointer-enter
  await page.mouse.move(rectGeom.farX, rectGeom.farY); await page.waitForTimeout(120);
  ok("no hover glow when the pointer is off any markup", await hoverCount() === 0, `${await hoverCount()} glow(s)`);

  await page.mouse.move(rectGeom.cx, rectGeom.cy); await page.waitForTimeout(150);
  const hovOnInterior = await hoverCount();
  ok("hovering the rect INTERIOR shows the pre-click glow", hovOnInterior >= 1, `${hovOnInterior} glow(s)`);
  const glowIsMkHover = await page.evaluate(() => { const g = document.querySelector('[data-hover="1"]'); return !!g && /mk-hover/.test(g.getAttribute("class") || ""); });
  ok("the glow carries the shared .mk-hover treatment", glowIsMkHover);
  await page.screenshot({ path: OUT + "b156-siteplanner-hover.png" });

  // hover == click: the SAME interior point selects the rect
  await page.mouse.click(rectGeom.cx, rectGeom.cy); await page.waitForTimeout(250);
  ok("clicking that same interior point SELECTS the rect (hover == click)", /Markup/.test(await panelText()), JSON.stringify((await panelText()).slice(0, 32)));
  ok("the selected markup shows NO hover glow (selection supersedes hover)", await hoverCount() === 0, `${await hoverCount()} glow(s)`);

  // moving off clears any glow
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.mouse.move(rectGeom.farX, rectGeom.farY); await page.waitForTimeout(150);
  ok("moving off the markup clears the glow", await hoverCount() === 0, `${await hoverCount()} glow(s)`);
}

/* ================= DOCUMENT REVIEW ================= */
console.log("\n== DOCUMENT REVIEW — B155 click routes through shared pickMarkup + B156 hover ==");
const tab = page.locator('[data-testid="module-tab-doc-review"]:visible').first();
if (await tab.count()) { await tab.click(); await page.waitForTimeout(2500); }
await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(FIXTURE).catch(() => {});
const rail = page.locator('[data-testid="markup-rail"]');
await rail.waitFor({ state: "visible", timeout: 45000 }).catch(() => {});
ok("fixture PDF opened — the Markup tool rail rendered", await rail.isVisible().catch(() => false));

await page.locator('[data-testid="tool-fitP"]').click().catch(() => {});
await page.waitForTimeout(500);
const ob = await page.evaluate(() => { const s = document.querySelector('[data-testid="markup-overlay"]'); if (!s) return null; const b = s.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
ok("the sheet area is on screen", !!ob && ob.w > 50);

if (ob) {
  const arm = async (id) => { await page.locator(`[data-testid="tool-${id}"]`).click().catch(() => {}); await page.waitForTimeout(150); };
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2); await page.mouse.move(b.x, b.y); await page.mouse.move(b.x, b.y); await page.mouse.up(); await page.waitForTimeout(250); };
  // one rect across the middle of the sheet
  await arm("rect");
  await drag({ x: ob.x + ob.w * 0.30, y: ob.y + ob.h * 0.34 }, { x: ob.x + ob.w * 0.66, y: ob.y + ob.h * 0.62 });
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await arm("select");

  const dr = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="markup-overlay"] rect');
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, farX: b.x - 80, farY: b.y - 80 };
  });
  ok("a rect markup was drawn on the sheet", !!dr && dr.w > 30, dr ? `w=${Math.round(dr.w)}` : "not found");

  if (dr) {
    await page.mouse.move(dr.farX, dr.farY); await page.waitForTimeout(120);
    ok("no hover glow off the markup", await hoverCount() === 0, `${await hoverCount()} glow(s)`);

    await page.mouse.move(dr.cx, dr.cy); await page.waitForTimeout(150);
    ok("hovering the rect interior shows the glow (Document Review)", await hoverCount() >= 1, `${await hoverCount()} glow(s)`);
    await page.screenshot({ path: OUT + "b156-docreview-hover.png" });

    // click the SAME interior point → routes through shared pickMarkup → selects (Delete × appears)
    await page.mouse.click(dr.cx, dr.cy); await page.waitForTimeout(250);
    const selected = await page.locator('button[aria-label="Delete this markup"]').count() > 0;
    ok("clicking the interior selects it via the shared picker (single-select × shown)", selected);
    await page.mouse.move(dr.farX, dr.farY); await page.waitForTimeout(120);
    ok("moving off clears the glow (Document Review)", await hoverCount() === 0, `${await hoverCount()} glow(s)`);
  }
}

ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.screenshot({ path: OUT + "b155-b156-final.png" }).catch(() => {});
await ctx.close();
await browser.close();
console.log(`\n${fail === 0 ? "✅ ALL B155/B156 CHECKS PASSED" : `❌ ${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
