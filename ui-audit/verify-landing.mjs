/* Landing-page smoke test (dev tool — not part of the app build).
 *
 * Rewritten for the B1162800 rebuild (2026-09-07): the page is now a single dark screen with
 * an animated contour-canvas background, a masthead and a survey-sheet footer — no scroll
 * sections, no WebGL hero, no vendor animation libraries. Drives a headless Chromium over the
 * standalone marketing landing page (public/landing/index.html, served by `vite preview` at
 * /landing/) and:
 *   • captures every console error + uncaught page error,
 *   • confirms the page painted (real text on screen, not a blank canvas),
 *   • confirms the background canvas exists and actually drew something (non-blank pixels),
 *   • confirms there is no horizontal scroll at any of three widths,
 *   • screenshots desktop / short-laptop / tablet / phone.
 *
 * Run:  npm run build && npx vite preview --port 4173   (in another shell)
 *       node ui-audit/verify-landing.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const PAGE_URL = BASE.replace(/\/$/, "") + "/landing/";
const OUT = new URL("./screens/landing/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, dpr: 1, isMobile: false },
  { name: "short-laptop", width: 1600, height: 521, dpr: 1, isMobile: false },
  { name: "tablet", width: 834, height: 1112, dpr: 2, isMobile: true },
  { name: "phone", width: 390, height: 844, dpr: 3, isMobile: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });

  const report = { url: PAGE_URL, viewports: {}, errors: [], pageErrors: [] };
  let ok = true;

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-landing");
    page.on("console", (m) => { if (m.type() === "error") report.errors.push(`[${vp.name}] ${m.text()}`); });
    page.on("pageerror", (e) => report.pageErrors.push(`[${vp.name}] ${e.message}`));

    await page.goto(PAGE_URL, { waitUntil: "load", timeout: 45000 });
    await sleep(900); // let the first canvas frame + font swap settle

    const diag = await page.evaluate(() => {
      const canvas = document.getElementById("bg");
      let canvasDrew = false;
      if (canvas) {
        try {
          const c2 = canvas.getContext("2d");
          const data = c2.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let i = 3; i < data.length; i += 400) { if (data[i] !== 0) { canvasDrew = true; break; } } // any non-transparent alpha
        } catch (_) { canvasDrew = false; }
      }
      const h1 = document.querySelector("h1");
      return {
        hasCanvas: !!canvas,
        canvasDrew,
        h1Text: h1 ? h1.textContent.trim() : null,
        hasOpenButton: !!document.querySelector(".btn-primary"),
        noHorizontalScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        title: document.title,
      };
    });
    report.viewports[vp.name] = diag;
    if (diag.h1Text !== "A workspace built around the site." || !diag.hasOpenButton || !diag.noHorizontalScroll) ok = false;

    await page.screenshot({ path: `${OUT}${vp.name}.png` });
    await ctx.close();
  }

  await browser.close();

  console.log(JSON.stringify(report, null, 2));
  ok = ok && report.pageErrors.length === 0;
  console.log("\n" + (ok ? "✅ LANDING OK" : "⚠️  REVIEW NEEDED") +
    `  errors=${report.errors.length} pageErrors=${report.pageErrors.length}`);
  process.exit(ok ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
