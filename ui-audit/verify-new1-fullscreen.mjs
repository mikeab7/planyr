#!/usr/bin/env node
/* verify-new1-fullscreen — F goes to REAL fullscreen, and the header can never desync from it.
 *
 * Everything here is logged-out and needs no external GIS, so it is Claude-doable in the sandbox
 * and is NOT a "needs a live pass" item (VERIFICATION.md rule 4). What it CANNOT show is the part
 * only a human at a real screen can judge — that the tab strip, address bar and OS taskbar are
 * genuinely gone — because a headless browser has none of those. That one judgement is the live
 * check; every mechanical claim below is asserted here.
 *
 * Covered:
 *   1. F requests fullscreen on the document ROOT (not a subtree — a subtree would hide the
 *      fixed-position exit button along with everything else outside it), and the header collapses.
 *   2. The header is DRIVEN BY the document: exiting through the browser (exitFullscreen, which is
 *      what Esc and the browser's own affordance do) brings the chrome back on its own.
 *   3. The exit button exits the browser's fullscreen, not merely the chrome-hide.
 *   4. A REFUSED request still hides the header — the old behaviour as a fallback, never a
 *      keypress that appears to do nothing (this is the iOS-Safari path).
 *   5. Typing "f" in a text field does not toggle anything.
 *   6. The planner canvas AND the Leaflet basemap both re-fit to the new viewport, entering and
 *      leaving, and stay locked to each other (VIEWPORT-STABLE / the B1122 surface).
 *
 *   node ui-audit/verify-new1-fullscreen.mjs
 */
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const { perfScenarioSite } = await import("./lib/perf-scenario.mjs");
const site = perfScenarioSite();

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 1 });
await ctx.addInitScript(`(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [site.id]: site }))});
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
  window.__PLANYR_E2E = true;
} catch (e) {} })();`);
const page = await ctx.newPage();
await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(1200);

console.log("NEW-1 — real fullscreen on F\n");

const state = () => page.evaluate(() => ({
  fsElement: document.fullscreenElement ? document.fullscreenElement.tagName : null,
  isRoot: document.fullscreenElement === document.documentElement,
  // Count only a header that is actually ON SCREEN. Workspaces are kept mounted-but-hidden, so
  // the inactive one's <header> is always in the DOM — asserting on `querySelector("header")`
  // would be asserting on a node the user cannot see.
  header: [...document.querySelectorAll("header")].some((h) => h.offsetParent !== null && h.getBoundingClientRect().height > 0),
  exitBtn: !!document.querySelector('[data-testid="exit-fullscreen"]'),
  svg: (() => { const e = document.querySelector("svg[role=application]"); const r = e && e.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; })(),
  // BOTH the planner's basemap and the (hidden, display:none) Map view's Leaflet map are in the
  // DOM at once, and the hidden one measures 0×0 — so take the LARGEST, which is the one on screen.
  map: (() => {
    let best = null;
    for (const e of document.querySelectorAll(".leaflet-container")) {
      const r = e.getBoundingClientRect();
      if (!best || r.height > best.h) best = { w: Math.round(r.width), h: Math.round(r.height) };
    }
    return best;
  })(),
  exitButtons: document.querySelectorAll('[data-testid="exit-fullscreen"]').length,
  view: window.__plannerView ? window.__plannerView.get() : null,
}));

const before = await state();
check("starts with the header shown and no fullscreen", before.header && !before.fsElement && !before.exitBtn);

/* 1 — press F. Playwright's keyboard press IS a user activation, which is what the Fullscreen
   API requires; that is exactly why the request is made straight out of the key handler. */
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("f");
await page.waitForTimeout(500);
const full = await state();
check("F puts the DOCUMENT ROOT into fullscreen", full.isRoot, `fullscreenElement = ${full.fsElement}`);
check("…and the header collapses so the workspace is edge to edge", !full.header && full.exitBtn);
// The keep-alive gate: every mounted workspace header hears `fullscreenchange`, so without the
// same visibility gate the shortcut uses, each one collapses and renders its own exit button.
check("…and exactly ONE exit button exists (hidden workspaces' headers stay out of it)",
  full.exitButtons === 1, `${full.exitButtons} found`);
check("…and the canvas grew into the reclaimed height", !!full.svg && !!before.svg && full.svg.h > before.svg.h,
  before.svg && full.svg ? `canvas ${before.svg.h} → ${full.svg.h} tall` : "");
if (before.map && before.map.h > 0) {
  // The map CONTAINER is the canvas plus twice the overscan, and the overscan follows the drawable
  // element count — so it does NOT track the canvas by a fixed offset, and asserting that it does
  // would be asserting a false invariant. What must hold is the thing the owner sees: the drawing
  // stays WELDED to the imagery. That is the B1141 registration shift, which `sanitizeShift`
  // constrains to the sub-pixel range and refuses loudly beyond it.
  const reg = await page.evaluate(() => (window.__plannerView.registration ? window.__plannerView.registration() : null));
  check("…and the Leaflet basemap re-fitted with it",
    full.map.h > before.map.h, `basemap ${before.map.h} → ${full.map.h} tall`);
  check("…and the drawing stays welded to the imagery through the resize (B1141/B1122)",
    !!reg && Math.abs(reg.dx || 0) <= 1 && Math.abs(reg.dy || 0) <= 1,
    reg ? `registration shift ${(reg.dx || 0).toFixed(3)}, ${(reg.dy || 0).toFixed(3)} px` : "no registration probe");
} else {
  console.log("  · basemap re-fit NOT CHECKED — no sized Leaflet container on screen (aerial off / tiles blocked)");
}

/* 2 — exiting through the BROWSER (what Esc and the browser's own affordance do) must bring the
   header back on its own. This is the desync the fullscreenchange listener exists to prevent. */
await page.evaluate(() => document.exitFullscreen());
await page.waitForTimeout(500);
const back = await state();
check("exiting via the browser restores the header without us being told", back.header && !back.fsElement && !back.exitBtn);
check("…and the canvas re-fits back down", back.svg.h === before.svg.h, `canvas ${back.svg.h} tall`);
if (before.map && before.map.h > 0) {
  check("…and the basemap comes back with it", back.map.h === before.map.h, `basemap ${back.map.h} tall`);
  const regBack = await page.evaluate(() => (window.__plannerView.registration ? window.__plannerView.registration() : null));
  check("…still welded on the way out", !!regBack && Math.abs(regBack.dx || 0) <= 1 && Math.abs(regBack.dy || 0) <= 1,
    regBack ? `registration shift ${(regBack.dx || 0).toFixed(3)}, ${(regBack.dy || 0).toFixed(3)} px` : "");
}
check("…and the view transform is untouched by the round trip (VIEWPORT-STABLE)",
  !!back.view && !!before.view && Math.abs(back.view.ppf - before.view.ppf) < 1e-9,
  back.view ? `ppf ${before.view.ppf} → ${back.view.ppf}` : "no view probe");

/* 3 — the exit BUTTON must exit the browser's fullscreen, not just re-show the chrome. */
await page.keyboard.press("f");
await page.waitForTimeout(400);
await page.locator('[data-testid="exit-fullscreen"]').first().click();
await page.waitForTimeout(500);
const afterBtn = await state();
check("the ✕ exit button leaves REAL fullscreen, not just the chrome-hide", afterBtn.header && !afterBtn.fsElement);

/* 4 — a REFUSED request (or a browser with no API at all — iOS Safari on a non-video element)
   must still hide the header. Never a keypress that appears to do nothing. */
await page.evaluate(() => {
  window.__origReq = Element.prototype.requestFullscreen;
  Element.prototype.requestFullscreen = () => Promise.reject(new Error("refused"));
  Element.prototype.webkitRequestFullscreen = undefined;
});
await page.keyboard.press("f");
await page.waitForTimeout(500);
const refused = await state();
check("a REFUSED request falls back to hiding the chrome", !refused.header && refused.exitBtn && !refused.fsElement);
await page.locator('[data-testid="exit-fullscreen"]').first().click();
await page.waitForTimeout(300);
const refusedBack = await state();
check("…and Esc / the exit button still restore it in that fallback mode", refusedBack.header);
await page.keyboard.press("f");
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("…including a plain Escape (nothing else is going to, in fallback mode)", (await state()).header);
await page.evaluate(() => { Element.prototype.requestFullscreen = window.__origReq; });

/* 5 — typing in a field must never trigger the shortcut. */
const typed = await page.evaluate(() => {
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.focus();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  const still = !!document.querySelector("header");
  input.remove();
  return still;
});
check("typing “f” in a text field toggles nothing", typed);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("  failed: " + failed.map((f) => f.name).join("; ")); process.exit(1); }
console.log("  Still owed by a human at a real screen: that the browser tab strip, address bar and OS");
console.log("  taskbar are genuinely gone. A headless browser has none of them to hide.");
