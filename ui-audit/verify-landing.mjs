/* Landing-page verification harness (dev tool — not part of the app build).
 *
 * Drives a headless Chromium over the standalone marketing landing page
 * (public/landing/index.html, served by `vite preview` at /landing/) and:
 *   • captures every console error + uncaught page error,
 *   • confirms the page signalled init-complete and a WebGL hero canvas exists,
 *   • screenshots the page at desktop / tablet / phone widths, scrolling through
 *     each scroll-triggered section, into ui-audit/screens/landing/.
 *
 * WebGL in headless Chromium needs software rasterisation flags (SwiftShader) — the
 * sandbox has no GPU. The TLS-inspection proxy means we also pass
 * --ignore-certificate-errors (see CLAUDE.md → "Playwright / ui-audit in the sandbox").
 *
 * Run:  npm install --no-save playwright
 *       npm run build && npx vite preview --port 4173   (in another shell)
 *       node ui-audit/verify-landing.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const URL = BASE.replace(/\/$/, "") + "/landing/";
const OUT = new URL("./screens/landing/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, dpr: 1 },
  { name: "tablet", width: 834, height: 1112, dpr: 2 },
  { name: "phone", width: 390, height: 844, dpr: 3 },
];
// Scroll positions (fraction of scrollable height) to capture per viewport.
const STOPS = [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--ignore-certificate-errors",
      // Software WebGL so the Three.js hero renders without a GPU.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
    ],
  });

  const report = { url: URL, viewports: {}, errors: [], pageErrors: [], diagnostics: null };

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      isMobile: vp.name !== "desktop",
      hasTouch: vp.name !== "desktop",
    });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") report.errors.push(`[${vp.name}] ${m.text()}`);
    });
    page.on("pageerror", (e) => report.pageErrors.push(`[${vp.name}] ${e.message}`));

    await page.goto(URL, { waitUntil: "load", timeout: 45000 });
    // Give GSAP/Three a beat to initialise, then read the page's own diagnostics hook.
    await sleep(1600);
    const diag = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      let webgl = false;
      if (canvas) {
        try {
          webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
        } catch (_) { webgl = false; }
      }
      return {
        ready: !!window.__landingReady,
        hasCanvas: !!canvas,
        webgl,
        webglFallback: !!window.__landingWebglFallback,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        scrollHeight: document.documentElement.scrollHeight,
        title: document.title,
      };
    });
    if (vp.name === "desktop") report.diagnostics = diag;
    report.viewports[vp.name] = diag;

    // Scroll through the page, screenshotting each stop.
    const scrollH = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    for (let i = 0; i < STOPS.length; i++) {
      const y = Math.round(scrollH * STOPS[i]);
      await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
      await sleep(650); // let ScrollTrigger settle the scrubbed timelines
      await page.screenshot({ path: `${OUT}${vp.name}-${String(i).padStart(2, "0")}-${Math.round(STOPS[i] * 100)}.png` });
    }
    // One full-page capture (desktop only — phones make absurdly tall PNGs).
    if (vp.name === "desktop") {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await sleep(300);
      await page.screenshot({ path: `${OUT}desktop-fullpage.png`, fullPage: true });
    }
    await ctx.close();
  }

  await browser.close();

  console.log(JSON.stringify(report, null, 2));
  const ok = report.pageErrors.length === 0 && report.diagnostics && report.diagnostics.ready;
  console.log("\n" + (ok ? "✅ LANDING OK" : "⚠️  REVIEW NEEDED") +
    `  errors=${report.errors.length} pageErrors=${report.pageErrors.length} ` +
    `ready=${report.diagnostics?.ready} webgl=${report.diagnostics?.webgl} fallback=${report.diagnostics?.webglFallback}`);
  process.exit(ok ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(2); });
