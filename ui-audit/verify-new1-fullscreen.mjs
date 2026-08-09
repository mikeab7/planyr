#!/usr/bin/env node
/* verify-new1-fullscreen — F goes to REAL fullscreen, THE HEADER STAYS, and the two can never desync.
 *
 * ⛔ THIS HARNESS WAS REWRITTEN BY B1173(×2), and the reason matters more than the diff. B1156 made
 * `f` a real browser fullscreen AND hid the header; B1173 (first pass) answered the resulting dead
 * end — no way to change plan or workspace from inside the mode — with a top-edge hover REVEAL, and
 * half of this file certified that reveal in detail. The owner's second report overrules it:
 *   "the full screen option doesn't show anything at the top to where I can switch between projects.
 *    So to switch between projects, I have to exit full screen, which is kind of annoying. That's
 *    not how it's supposed to work. I should still have the two headers at the top when I go into
 *    full screen."
 * What fullscreen reclaims is the BROWSER's chrome — tab strip, address bar, OS taskbar. It never
 * reclaimed ours honestly: switching plans is a primary action during a review, and a hover-to-
 * reveal charged a deliberate gesture for it every single time.
 *
 * Everything here is logged-out and needs no external GIS, so it is Claude-doable in the sandbox and
 * is NOT a "needs a live pass" item (VERIFICATION.md rule 4). What it CANNOT show is the part only a
 * human at a real screen can judge — that the tab strip, address bar and OS taskbar are genuinely
 * gone — because a headless browser has none of those.
 *
 * Covered:
 *   1. F requests fullscreen on the document ROOT (never a subtree — a subtree would hide every
 *      fixed-position overlay outside it).
 *   2. BOTH HEADER ROWS STAY ON SCREEN, in flow, unmoved: the breadcrumb row and the workspace-tab
 *      row, with the project/plan switcher and every module tab reachable WITHOUT a gesture.
 *   3. The header is DRIVEN BY the document: exiting through the browser (exitFullscreen, which is
 *      what Esc and the browser's own affordance do) updates it on its own.
 *   4. The row-1 toggle is the one exit control, and it reports the mode via `aria-pressed`.
 *   5. A REFUSED request SAYS SO (there is no chrome-hide fallback left to fall into, so a silent
 *      no-op is the failure mode this replaces — LOUD-FAILURE).
 *   6. Typing "f" in a text field toggles nothing.
 *   7. Switching workspace from inside fullscreen hands the mode over — exactly one header claims
 *      it, and `f` is not dead afterwards.
 *   8. The planner canvas and the Leaflet basemap stay welded to each other across the transition
 *      (VIEWPORT-STABLE / the B1122 surface).
 *
 *   node ui-audit/verify-new1-fullscreen.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

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
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout AND suspends requestAnimationFrame, so after a view change the app's state attributes
   update while the drawing never repaints — every box, position, hit test and screenshot then agrees
   with every other and describes a view the app already left. One precondition covers both, rAF
   liveness probe included; see ui-audit/lib/tabTiming.mjs. */
await assertMeasurable(page, "verify-new1-fullscreen");
await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(1200);

console.log("B1156 / B1173(×2) — real fullscreen on F, with the chrome kept\n");

const state = () => page.evaluate(() => {
  // Count only a header that is actually ON SCREEN. Workspaces are kept mounted-but-hidden, so an
  // inactive workspace's <header> is always in the DOM — asserting on `querySelector("header")`
  // would be asserting on a node the user cannot see. `getClientRects()` distinguishes a
  // display:none ancestor (no boxes at all) from a real one; `bottom > 0.5` is what actually
  // answers "can the user see it", and is retained deliberately: it is the assertion that would
  // catch a regression back to a header parked above the top edge.
  const onScreen = [...document.querySelectorAll("header")].filter((h) => {
    if (!h.getClientRects().length) return false;
    const r = h.getBoundingClientRect();
    return r.height > 0 && r.bottom > 0.5;
  });
  const h = onScreen[0];
  const rect = h && h.getBoundingClientRect();
  const labels = h ? [...h.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean) : [];
  const toggle = h && h.querySelector('[data-testid="toggle-fullscreen"]');
  return {
    fsElement: document.fullscreenElement ? document.fullscreenElement.tagName : null,
    isRoot: document.fullscreenElement === document.documentElement,
    header: !!h,
    headerTop: rect ? Math.round(rect.top) : null,
    headerHeight: rect ? Math.round(rect.height) : null,
    // Both ROWS, identified by something only that row carries.
    hasRow1: !!toggle,
    hasTabs: labels.includes("Site") && labels.includes("Review") && labels.includes("Library"),
    controls: labels.length,
    // Exactly one header may claim the mode — two is the "two stacked" defect this harness exists for.
    claiming: document.querySelectorAll('header[data-fullscreen="on"]').length,
    togglePressed: toggle ? toggle.getAttribute("aria-pressed") : null,
    refusedNotice: !!document.querySelector('[data-testid="fullscreen-refused"]'),
    // ⛔ The floating exit button was REMOVED with the hiding it existed for. Its reappearance would
    // mean the reveal design came back in a merge, so its ABSENCE is asserted, not its presence.
    strayExitButtons: document.querySelectorAll('[data-testid="exit-fullscreen"]').length,
    svg: (() => { const e = document.querySelector("svg[role=application]"); const r = e && e.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; })(),
    // BOTH the planner's basemap and the (hidden, display:none) Map view's Leaflet map are in the
    // DOM at once, and the hidden one measures 0×0 — so take the LARGEST, the one on screen.
    map: (() => {
      let best = null;
      for (const e of document.querySelectorAll(".leaflet-container")) {
        const r = e.getBoundingClientRect();
        if (!best || r.height > best.h) best = { w: Math.round(r.width), h: Math.round(r.height) };
      }
      return best;
    })(),
    view: window.__plannerView ? window.__plannerView.get() : null,
  };
});

const before = await state();
check("starts with both header rows shown and no fullscreen",
  before.header && before.hasRow1 && before.hasTabs && !before.fsElement && before.claiming === 0);

/* 1 — press F. Playwright's keyboard press IS a user activation, which is what the Fullscreen API
   requires; that is exactly why the request is made straight out of the key handler. */
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("f");
await page.waitForTimeout(500);
const full = await state();
check("F puts the DOCUMENT ROOT into fullscreen", full.isRoot, `fullscreenElement = ${full.fsElement}`);

/* 2 — THE ITEM ITSELF. */
console.log("\n  the owner's report: both headers stay\n");
check("the header is STILL on screen, at the very top, in flow",
  full.header && full.headerTop === 0, `top = ${full.headerTop}`);
check("…and it is the WHOLE header — row 1 and the workspace tabs, not a reduced version",
  full.hasRow1 && full.hasTabs && full.controls > 6, `${full.controls} controls`);
check("…at exactly the height it has outside fullscreen (nothing collapsed or squeezed)",
  full.headerHeight === before.headerHeight, `${before.headerHeight} → ${full.headerHeight} px`);
check("…reachable with NO gesture: it is there the instant fullscreen starts",
  full.hasTabs, "no pointer moved to the top edge before this was read");
check("exactly ONE header claims the mode (hidden workspaces' headers stay out of it)",
  full.claiming === 1, `${full.claiming} claiming`);
check("…and no floating exit button is painted over the drawing any more",
  full.strayExitButtons === 0, `${full.strayExitButtons} found`);
check("the row-1 toggle reports the mode it is in", full.togglePressed === "true");

/* 8 — the drawing must stay welded to the imagery across the transition. */
if (before.map && before.map.h > 0) {
  const reg = await page.evaluate(() => (window.__plannerView.registration ? window.__plannerView.registration() : null));
  check("the drawing stays welded to the imagery through the transition (B1141/B1122)",
    !!reg && Math.abs(reg.dx || 0) <= 1 && Math.abs(reg.dy || 0) <= 1,
    reg ? `registration shift ${(reg.dx || 0).toFixed(3)}, ${(reg.dy || 0).toFixed(3)} px` : "no registration probe");
} else {
  console.log("  · weld NOT CHECKED — no sized Leaflet container on screen (aerial off / tiles blocked)");
}

/* 3 — exiting through the BROWSER (what Esc and the browser's own affordance do) must update the
   header on its own. This is the desync the fullscreenchange listener exists to prevent. */
await page.evaluate(() => document.exitFullscreen());
await page.waitForTimeout(500);
const back = await state();
check("exiting via the browser is noticed without us being told",
  back.header && !back.fsElement && back.claiming === 0 && back.togglePressed === "false");
check("…and the canvas is unchanged by the round trip", back.svg.h === before.svg.h, `canvas ${back.svg.h} tall`);
check("…and the view transform is untouched (VIEWPORT-STABLE)",
  !!back.view && !!before.view && Math.abs(back.view.ppf - before.view.ppf) < 1e-9,
  back.view ? `ppf ${before.view.ppf} → ${back.view.ppf}` : "no view probe");

/* 4 — the row-1 toggle exits real fullscreen. */
await page.keyboard.press("f");
await page.waitForTimeout(400);
await page.locator('[data-testid="toggle-fullscreen"]:visible').first().click();
await page.waitForTimeout(500);
const afterBtn = await state();
check("the row-1 toggle leaves REAL fullscreen", afterBtn.header && !afterBtn.fsElement);

/* 5 — a REFUSED request (or a browser with no API at all — iOS Safari on a non-video element).
   There is no chrome-hide fallback left, so the obligation is to SAY SO. */
await page.evaluate(() => {
  window.__origReq = Element.prototype.requestFullscreen;
  Element.prototype.requestFullscreen = () => Promise.reject(new Error("refused"));
  Element.prototype.webkitRequestFullscreen = undefined;
});
await page.keyboard.press("f");
await page.waitForTimeout(500);
const refused = await state();
check("a REFUSED request says so instead of doing nothing (LOUD-FAILURE)", refused.refusedNotice);
check("…and claims no mode the document is not in", !refused.fsElement && refused.claiming === 0);
check("…and leaves the chrome exactly where it was", refused.header && refused.headerTop === 0);
await page.evaluate(() => { Element.prototype.requestFullscreen = window.__origReq; });

/* 6 — typing in a field must never trigger the shortcut. */
const typed = await page.evaluate(() => {
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.focus();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  const still = !document.fullscreenElement;
  input.remove();
  return still;
});
check("typing “f” in a text field toggles nothing", typed);

/* 7 — THE CASE THE ITEM IS ABOUT: actually using the tabs, from inside fullscreen, with no
   gesture first. Every workspace owns its own AppHeader, and the incoming one was display:none
   when `f` was pressed, so it never heard the fullscreenchange. Without the hand-over it arrives
   convinced it is not fullscreen, with `f` dead (requesting fullscreen on an already-fullscreen
   document resolves without firing another event) and the toggle showing the wrong label. */
console.log("\n  switching workspace from inside fullscreen\n");
await page.waitForTimeout(300);
await page.keyboard.press("f");
await page.waitForTimeout(500);
check("in fullscreen, with the tabs right there", (await state()).isRoot && (await state()).hasTabs);
await page.evaluate(() => {
  const h = [...document.querySelectorAll("header")].find((x) => x.getClientRects().length && x.getBoundingClientRect().bottom > 0.5);
  [...h.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Review")?.click();
});
await page.waitForTimeout(900);
const switched = await state();
check("switching workspace from inside fullscreen keeps the DOCUMENT in fullscreen", switched.isRoot);
check("…and the incoming header is on screen with both rows", switched.header && switched.hasRow1 && switched.hasTabs);
check("…with exactly ONE header claiming the mode (the outgoing one relinquished)",
  switched.claiming === 1, `${switched.claiming} claiming`);
await page.keyboard.press("f");
await page.waitForTimeout(600);
const outAgain = await state();
check("…and `f` still exits from there (the key is not dead after a switch)",
  outAgain.header && !outAgain.fsElement);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("  failed: " + failed.map((f) => f.name).join("; ")); process.exit(1); }
console.log("  Still owed by a human at a real screen: that the browser tab strip, address bar and OS");
console.log("  taskbar are genuinely gone. A headless browser has none of them to hide.");
