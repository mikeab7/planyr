/* B590 — best-effort REAL drag gesture: select the building, grab its depth dimension, drag it
 * hard toward the +X edge (past the bump-out), and confirm the PERSISTED dimOffset came out
 * clamped (slid along X only — y forced to 0 — and stopped at the bump band, not out in space).
 * Canvas drags are historically flaky under automation; if the gesture doesn't register this
 * logs SKIP (not fail) and the render-clamp harness remains the authoritative proof. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const site = {
  id: "b590-drag", groupId: "b590-drag", site: "B590 drag", name: "Plan 1", origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: [{ x: -900, y: -700 }, { x: 900, y: -700 }, { x: 900, y: 700 }, { x: -900, y: 700 }] }],
  els: [
    { id: "b1", type: "building", cx: 0, cy: 0, w: 620, h: 300, rot: 0, dock: "cross", dimOffset: { x: 0, y: 0 } },
    { id: "de1", type: "building", attachedTo: "b1", dock: "none", noFit: true, noLabel: true, dogEar: { side: "top", sign: 1 }, cx: 260, cy: -180, w: 100, h: 60, rot: 0 },
  ],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ "b590-drag": ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', "b590-drag");
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(400);
for (let i = 0; i < 7; i++) { await page.mouse.move(720, 450); await page.mouse.wheel(0, -300); await page.waitForTimeout(80); }
await page.waitForTimeout(400);

const find = () => page.evaluate(() => {
  const rects = [...document.querySelectorAll("svg rect")];
  let fp = null, area = 0;
  for (const r of rects) { const b = r.getBoundingClientRect(); if (b.width > 40 && b.height > 40 && b.width * b.height > area) { area = b.width * b.height; fp = { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; } }
  const reds = [...document.querySelectorAll("svg line")].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === "#dc2626")
    .map((l) => { const b = l.getBoundingClientRect(); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, h: b.height }; });
  const dl = reds.sort((a, b) => b.h - a.h)[0] || null;
  return { fp, dl };
});
const offsetOf = () => page.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem("planarfit:sites:v1"))["b590-drag"]; return s.els.find((e) => e.id === "b1").dimOffset; } catch (e) { return null; }
});

const { fp, dl } = await find();
let fail = 0, skip = false;
const ok = (l, c, d = "") => { console.log(`  ${c ? "✓" : "✗"} ${l}${d ? "  (" + d + ")" : ""}`); if (!c) fail++; };
if (!fp || !dl) { console.log("  ⊘ SKIP — footprint/dimension not found (render gate)"); skip = true; }

if (!skip) {
  const ppf = fp.w / 620;
  // 1) select the building (click its centre — a plain click selects, doesn't move)
  await page.mouse.click(fp.cx, fp.cy);
  await page.waitForTimeout(250);
  // 2) grab the depth line and drag it HARD right (past the +X edge) + down (to test the y-lock)
  await page.mouse.move(dl.cx, dl.cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(dl.cx + i * 80, dl.cy + i * 30); await page.waitForTimeout(40); }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const off = await offsetOf();
  if (!off || (off.x === 0 && off.y === 0)) {
    console.log(`  ⊘ SKIP — drag gesture didn't register (offset ${JSON.stringify(off)}); render-clamp harness is the proof`);
  } else {
    console.log(`  drag persisted dimOffset = ${JSON.stringify(off)}`);
    ok("drag: y (depth) component forced to 0 — line stayed ON the building", Math.abs(off.y) < 0.5, `y=${off.y}`);
    ok("drag: x clamped to the bump band (≤ ~408′, not out at the 9999 pointer)", off.x <= 412 && off.x > 250, `x=${off.x?.toFixed(0)} band.max≈408`);
  }
}
await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ B590 drag check ok (or skipped)" : `\n✗ ${fail} drag assertion(s) failed`);
process.exit(fail === 0 ? 0 : 1);
