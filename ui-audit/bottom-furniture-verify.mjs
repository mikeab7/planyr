/* Headless check for B881 / NEW-1: the bottom map furniture must never overlap, even when a
 * docked left panel narrows the map pane. Drives the real furniture (bottom-furniture-harness)
 * and asserts that the four bottom items — scale bar, "● Scaled" calibration badge, north
 * arrow, coordinate chip — plus the zoom controls have no pairwise bounding-box overlap at
 * several narrow pane widths. Screenshots each pane for eyeballing. Not part of the app build.
 *
 * Run:  npm run dev -- --port 5199 --strictPort   (background)
 *       node ui-audit/bottom-furniture-verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const URL = `${BASE}/ui-audit/bottom-furniture-harness.html`;
const OUT = "ui-audit/out";
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 900, height: 1800 });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });
  await page.waitForTimeout(150); // let the badge measure + reflow settle (useLayoutEffect)
  ok("no page errors while rendering", errors.length === 0, errors.join(" | "));

  const data = await page.evaluate(() => {
    const items = ["scalebar", "badge", "north", "coord", "zoom"];
    const panes = Array.from(document.querySelectorAll("[data-pane]"));
    return panes.map((pane) => {
      const pr = pane.getBoundingClientRect();
      const rects = {};
      for (const id of items) {
        const el = pane.querySelector(`[data-testid="${id}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        rects[id] = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
      return { width: pane.getAttribute("data-pane"), paneRight: pr.right, rects };
    });
  });

  const overlapArea = (a, b) => {
    const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return ox * oy;
  };

  for (const pane of data) {
    const ids = Object.keys(pane.rects);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const area = overlapArea(pane.rects[a], pane.rects[b]);
        ok(`w=${pane.width}: ${a} ∩ ${b} clear`, area <= 2, `overlap=${area.toFixed(0)}px²`);
      }
      // every item stays inside the pane's right edge
      ok(`w=${pane.width}: ${ids[i]} within pane`, pane.rects[ids[i]].right <= pane.paneRight + 1.5,
        `right=${pane.rects[ids[i]].right.toFixed(0)} paneRight=${pane.paneRight.toFixed(0)}`);
    }
  }

  await page.screenshot({ path: `${OUT}/bottom-furniture.png`, fullPage: true });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : `  →  ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
