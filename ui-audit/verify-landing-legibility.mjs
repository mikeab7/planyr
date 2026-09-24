#!/usr/bin/env node
/* LANDING LEGIBILITY GUARD — asserts the page's copy is actually RENDERED, not merely
 * "the document parsed". (B1384 / NEW-1; rewritten for the B1162800 rebuild, 2026-09-07.)
 *
 * WHY A NEW HARNESS ORIGINALLY. The 2026-08-03 page passed every existing check while showing
 * a dark grid and no words at all: a readiness flag said the init function ran, and the old
 * verify-landing.mjs screenshotted at Playwright's default 720px-tall viewport after a fixed
 * wait. Neither ever asked the browser what opacity the headline actually was.
 *
 * THE B1162800 REBUILD REMOVED THE REVEAL MECHANISM ENTIRELY rather than re-gating it — the
 * page is now plain, always-visible HTML with a decorative canvas behind it, so there is no
 * `.reveal` class, no `__landingAnimGate`, and nothing here needs to arm or starve one. What
 * this harness still has to prove, because the ORIGINAL failure mode (a slow/blocked/absent
 * third-party font request stalling the page) is still a live risk with the new Archivo/IBM
 * Plex Mono Google Fonts load:
 *
 *   normal   — the fonts request completes: every line of copy is on screen, fully opaque.
 *   starved  — the fonts stylesheet request is BLOCKED outright (stands in for a slow,
 *              filtered, or dead fonts host). The copy must be identically on screen — it is
 *              plain HTML with system-font fallbacks, never gated behind the font arriving.
 *   nojs     — JavaScript off entirely. Same requirement; the canvas simply never draws.
 *
 * …at several viewport HEIGHTS, including the ~500px short-laptop window from the original
 * B1384 repro.
 *
 * Run:  node ui-audit/verify-landing-legibility.mjs
 *       BASE_URL=https://planyr.io node ui-audit/verify-landing-legibility.mjs   (live)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const PAGE_URL = BASE.replace(/\/$/, "") + "/landing/";

const VIEWPORTS = [
  { name: "short-laptop", width: 1600, height: 521, isMobile: false },
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "short-phone", width: 375, height: 500, isMobile: true }, // phone rotated / keyboard-open case
  { name: "phone", width: 390, height: 844, isMobile: true },
];

const MODES = ["normal", "starved", "nojs"];

/* The Google Fonts stylesheet request — blocked to stand in for "the fonts host is slow, dead,
 * or filtered", the exact condition B1384's outage measured. */
const FONTS_RE = /^https:\/\/fonts\.googleapis\.com\//;

/* Every piece of copy the page actually carries. */
const COPY_SELECTOR = ".eyebrow, h1, p.sub, .matrix .row, .btn-primary, .btn-secondary, .fine-print, .legend, .footer-right .copyright";

const MIN_OPACITY = 0.99;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(browser, vp, mode) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    javaScriptEnabled: mode !== "nojs",
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
  });
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. See
     ui-audit/lib/tabTiming.mjs for why; fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-landing-legibility");
  if (mode === "starved") await page.route(FONTS_RE, (r) => r.abort());

  await page.goto(PAGE_URL, { waitUntil: "load", timeout: 60000 });
  await sleep(900); // past the font-swap window and the first animation frame, in every mode

  const result = await page.evaluate(
    ({ sel, min }) => {
      const faded = [];
      let counted = 0;
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.textContent || "").trim();
        if (!text) return;
        if (el.getClientRects().length === 0) return; // display:none at this breakpoint is legitimate layout, not the defect under test
        counted++;
        let op = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
          op *= Number(getComputedStyle(n).opacity);
        }
        if (op < min) faded.push({ cls: el.className || el.tagName, op: +op.toFixed(4), text: text.slice(0, 52) });
      });
      const h1 = document.querySelector("h1");
      return {
        counted,
        faded,
        h1Opacity: h1 ? Number(getComputedStyle(h1).opacity) : null,
        h1Text: h1 ? h1.textContent.trim() : null,
      };
    },
    { sel: COPY_SELECTOR, min: MIN_OPACITY }
  );

  await ctx.close();
  return result;
}

/* Reaching a REAL deployed URL needs the browser routed through the egress proxy — see the
 * sibling harnesses' identical note; kept for parity, self-disables for localhost. */
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
const REMOTE = /^https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(BASE);

const browser = await chromium.launch({
  ...(PROXY && REMOTE ? { proxy: { server: PROXY } } : {}),
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});

let failures = 0;
console.log(`landing legibility — ${PAGE_URL}\n`);
for (const vp of VIEWPORTS) {
  for (const mode of MODES) {
    const r = await measure(browser, vp, mode);
    const label = `${vp.name} ${vp.width}×${vp.height} · ${mode}`.padEnd(40);
    const h1 = r.h1Opacity === null ? "n/a" : r.h1Opacity.toFixed(3);
    if (r.counted === 0) {
      console.log(`✗ ${label} no copy elements found — the selector or the page changed`);
      failures++;
      continue;
    }
    if (r.h1Text !== "A workspace built around the site.") {
      console.log(`✗ ${label} h1 text unexpected: "${r.h1Text}"`);
      failures++;
    }
    if (r.faded.length) {
      console.log(`✗ ${label} h1 ${h1} · ${r.faded.length}/${r.counted} below full opacity`);
      r.faded.slice(0, 6).forEach((f) => console.log(`      ${f.op.toFixed(3)}  ${f.text}`));
      if (r.faded.length > 6) console.log(`      … and ${r.faded.length - 6} more`);
      failures++;
    } else {
      console.log(`✓ ${label} h1 ${h1} · ${r.counted}/${r.counted} fully opaque`);
    }
  }
}

await browser.close();

if (failures) {
  console.error(
    `\n✗ ${failures} viewport/mode combination(s) render copy the reader cannot see.\n` +
      "  The landing page's text must never depend on JavaScript or on the font/canvas arriving."
  );
  process.exit(1);
}
console.log(`\n✓ all ${VIEWPORTS.length * MODES.length} viewport/mode combinations render every line of copy`);
