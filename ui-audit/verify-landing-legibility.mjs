#!/usr/bin/env node
/* LANDING LEGIBILITY GUARD — asserts the page's copy is actually RENDERED, not merely
 * "initialised". (B1384 / NEW-1.)
 *
 * WHY A NEW HARNESS. The existing checks passed while the live page showed a dark grid and
 * no words at all: `window.__landingReady === true` says the init function ran, and
 * ui-audit/verify-landing.mjs screenshots at Playwright's default 720px-tall viewport after
 * a fixed wait. Neither one ever ASKED THE BROWSER WHAT OPACITY THE HEADLINE IS. A readiness
 * flag is not a rendering assertion. This harness reads computed opacity off the real
 * elements, and it exercises the three states the old checks never did:
 *
 *   normal   — vendor scripts load, page scrolls: every line of copy ends fully opaque.
 *   starved  — the GSAP/ScrollTrigger requests are BLOCKED, standing in for the slow network,
 *              blocked file, extension, or JS error that produced the owner's wordless page.
 *              The copy must still be fully opaque, because the reveal gate releases it.
 *   nojs     — JavaScript off entirely. Same requirement.
 *
 * …at several viewport HEIGHTS, including the ~500px short laptop window from the repro.
 *
 * Run:  node ui-audit/verify-landing-legibility.mjs
 *       BASE_URL=https://planyr.io node ui-audit/verify-landing-legibility.mjs   (live)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const PAGE_URL = BASE.replace(/\/$/, "") + "/landing/";

/* Heights are the point of this file. 521 is the owner's repro window; 900 is the height the
 * old harness happened to use; 844 is a phone. Widths follow the real device shapes. */
const VIEWPORTS = [
  { name: "short-laptop", width: 1600, height: 521 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const MODES = ["normal", "starved", "nojs"];

/* Vendor scripts stood in for "the animation library never arrives". */
const VENDOR_RE = /\/landing\/vendor\/(gsap|ScrollTrigger)\.min\.js$/;

/* Copy that must be readable. Every `.reveal` element plus the surfaces whose start state
 * the choreography also drives, so a future animation can't quietly re-hide one of them. */
const COPY_SELECTOR = ".reveal, .spec-row, .spec-row .t, .crumb, #spine-vert li, .lede, .hero h1";

const MIN_OPACITY = 0.99;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(browser, vp, mode) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    javaScriptEnabled: mode !== "nojs",
    isMobile: vp.name === "phone",
    hasTouch: vp.name === "phone",
  });
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-landing-legibility");
  if (mode === "starved") await page.route(VENDOR_RE, (r) => r.abort());

  await page.goto(PAGE_URL, { waitUntil: "load", timeout: 60000 });
  // Past the reveal gate's watchdog, with room to spare, in every mode.
  await sleep(2500);

  if (mode === "normal") {
    // Walk the whole page so every scroll-triggered reveal gets its chance to fire, then
    // come back to the top — copy that only survives while scrolling is not copy.
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y <= h; y += Math.round(vp.height * 0.5)) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await sleep(140);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(900);
  }

  const result = await page.evaluate(
    ({ sel, min }) => {
      const faded = [];
      let counted = 0;
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.textContent || "").trim();
        if (!text) return;
        // `display: none` at this breakpoint is not the defect — the phone-only vertical
        // spine is legitimately absent on desktop. An element the layout has removed has no
        // client rects; an element that is merely TRANSPARENT still has them, which is
        // exactly the case this guard exists to catch. So this narrows nothing that matters.
        if (el.getClientRects().length === 0) return;
        counted++;
        // Effective opacity: an ancestor at 0 hides the child just as thoroughly.
        let op = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
          op *= Number(getComputedStyle(n).opacity);
        }
        if (op < min) faded.push({ cls: el.className || el.tagName, op: +op.toFixed(4), text: text.slice(0, 52) });
      });
      const h1 = document.querySelector(".hero h1");
      return {
        counted,
        faded,
        h1Opacity: h1 ? Number(getComputedStyle(h1).opacity) : null,
        gateReleasedBy: (window.__landingAnimGate || {}).releasedBy || null,
        ready: !!window.__landingReady,
      };
    },
    { sel: COPY_SELECTOR, min: MIN_OPACITY }
  );

  await ctx.close();
  return result;
}

/* Reaching a REAL deployed URL (planyr.io, or a Cloudflare branch preview) needs the browser
 * routed through the egress proxy, since Chromium does not read HTTPS_PROXY on its own. This
 * is correct and is what a proxied environment needs — but be warned it is NOT sufficient in
 * THIS sandbox: measured 2026-08-03, `curl` reaches planyr.pages.dev fine while Chromium is
 * reset at the socket with nothing logged on the proxy, at launch- and context-level proxy
 * config alike. So a remote run here still fails, and V676's live pass belongs to a real
 * browser on a real network. Kept because it costs nothing and self-disables for localhost. */
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
const REMOTE = /^https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(BASE);

const browser = await chromium.launch({
  ...(PROXY && REMOTE ? { proxy: { server: PROXY } } : {}),
  args: [
    "--no-sandbox",
    "--ignore-certificate-errors",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
  ],
});

let failures = 0;
console.log(`landing legibility — ${PAGE_URL}\n`);
for (const vp of VIEWPORTS) {
  for (const mode of MODES) {
    const r = await measure(browser, vp, mode);
    const label = `${vp.name} ${vp.width}×${vp.height} · ${mode}`.padEnd(38);
    const h1 = r.h1Opacity === null ? "n/a" : r.h1Opacity.toFixed(3);
    if (r.counted === 0) {
      console.log(`✗ ${label} no copy elements found — the selector or the page changed`);
      failures++;
      continue;
    }
    if (r.faded.length) {
      console.log(`✗ ${label} h1 ${h1} · ${r.faded.length}/${r.counted} below full opacity`);
      r.faded.slice(0, 6).forEach((f) => console.log(`      ${f.op.toFixed(3)}  ${f.text}`));
      if (r.faded.length > 6) console.log(`      … and ${r.faded.length - 6} more`);
      failures++;
    } else {
      console.log(`✓ ${label} h1 ${h1} · ${r.counted}/${r.counted} fully opaque` +
        (r.gateReleasedBy ? ` (gate released by ${r.gateReleasedBy})` : ""));
    }
  }
}

await browser.close();

if (failures) {
  console.error(
    `\n✗ ${failures} viewport/mode combination(s) render copy the reader cannot see.\n` +
      "  The landing page's text must never depend on JavaScript or on an animation running.\n" +
      "  Every start state that hides copy belongs behind the `html.anim` gate in the <head>."
  );
  process.exit(1);
}
console.log(`\n✓ all ${VIEWPORTS.length * MODES.length} viewport/mode combinations render every line of copy`);
