/* Headless measurement of the Row-1 header overlap. Drives the real AppHeader
 * (header-overlap-harness.html) across several viewport widths and checks that the
 * three Row-1 zones (left breadcrumb · center badge · right controls) never overlap
 * horizontally. Also screenshots each width for eyeballing. Not part of the app build.
 *
 * Run:  npm run dev -- --port 5199 --strictPort   (background)
 *       node ui-audit/header-overlap-verify.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const URL = `${BASE}/ui-audit/header-overlap-harness.html`;
const OUT = "ui-audit/out";
mkdirSync(OUT, { recursive: true });

const WIDTHS = [1280, 1024, 900, 820, 780, 720, 480];
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });
  ok("no page errors while rendering", errors.length === 0, errors.join(" | "));

  // For a given scope ("long" | "short"), return the three Row-1 zone rects + the badge pill
  // rect. overflow:hidden clips a zone's content to its box, so VISIBLE overlap = box overlap
  // (a zone can never paint past its own clipped edge). We also grab the badge's own rect to
  // confirm it stays visible (not clipped to nothing) and roughly centered.
  const measure = (scope) =>
    page.evaluate((scope) => {
      const root = document.querySelector(`[data-scope="${scope}"]`);
      const row = root.querySelector("header > div"); // Row 1 is the first child div of <header>
      const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
      const zones = Array.from(row.children).map(rect);
      const badge = root.querySelector('[data-testid="jurisdiction-badge"]');
      return { zones, badge: badge ? rect(badge) : null, vw: window.innerWidth };
    }, scope);

  const overlapPx = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 300 });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${OUT}/header-${w}.png` });

    for (const scope of ["long", "short"]) {
      const { zones, badge, vw } = await measure(scope);
      const [L, C, R] = zones;
      const lcBox = overlapPx(L, C);
      const crBox = overlapPx(C, R);
      const bad = lcBox > 1 || crBox > 1;
      ok(`w=${w} ${scope}: no zone overlap`, !bad, `L↔C=${lcBox.toFixed(0)} C↔R=${crBox.toFixed(0)}`);
      // The badge must stay visible (never clipped away to nothing) whenever it has room —
      // above the narrow breakpoint that means at least a readable stub is on screen.
      if (badge) {
        const offCenter = Math.abs((badge.left + badge.right) / 2 - vw / 2);
        ok(`w=${w} ${scope}: badge visible (${badge.width.toFixed(0)}px, off-center ${offCenter.toFixed(0)}px)`, badge.width > 24);
      }
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : `  →  ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
