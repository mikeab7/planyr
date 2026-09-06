/* B1168128 (×2) — "I am panning within the map... it just pans me on the whole web page" on
 * iPhone Safari, with a screenshot: the whole app translated sideways, the device status bar and
 * the module tab row overlapping, bare page background visible as a gutter down both sides.
 *
 * This is a CONTAINMENT problem (the document/app-shell can be dragged), not a map problem, so it
 * is asserted at the app-shell level across drag origins, finger counts, orientations, modules and
 * both map surfaces — never patched for one component. Uses genuine CDP touch events
 * (Input.dispatchTouchEvent), never a synthetic mouse drag or a bare resized viewport
 * (DRIVER-SCROLL-IS-NOT-APP-SCROLL / SYNTHETIC-KEYS-DONT-EDIT siblings — a driver gesture that
 * isn't the real touch pipeline proves nothing about a native-scroll defect).
 *
 * ⛔ WEBKIT GAP, stated up front so this is never cited as "verified on iPhone": this sandbox has
 * Chromium (real touch emulation via CDP) only — no Apple WebKit. B1168128's own first arc proved
 * (four passes: real touch-emulated Chromium AND a real Linux WebKit build, four widths, two
 * orientations, eight panel states) that the owner's LITERAL page-drag symptom never reproduces in
 * either engine — it is Apple-WebKit-specific native gesture handling. So every check below proves
 * the FIX (the containment CSS + touch-action wiring) is present and does not regress anything this
 * sandbox CAN drive; it cannot prove the real-device defect is gone. That confirmation is
 * `Blocker: real-device` in BACKLOG.md/VERIFICATION.md — see `src/shared/ui/pageContainmentGuard.js`
 * for the runtime self-heal + telemetry half that captures a live recurrence automatically.
 *
 * Run:  npm run build && npx vite preview --port 4173
 *       node ui-audit/verify-mobile-pan-containment.mjs
 */
import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };
const skip = (n, why) => { console.log(`  ⏭️  SKIP — ${n}  · ${why}`); };

const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
const GID = "grp-mobilepan", SID = "site-mobilepan";
// A DENSE fixture — a big building filling most of the screen, like a real plan. B1168128's own
// fourth pass found a sparse/empty-canvas fixture reproduces nothing (nothing under the finger).
const demoSite = {
  schemaVersion: 2, id: SID, groupId: GID, site: "Mobile Pan Test", name: "Concept A",
  origin: { lat: 29.78, lon: -95.8 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -400, y: -300 }, { x: 400, y: -300 }, { x: 400, y: 300 }, { x: -400, y: 300 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: 0, w: 700, h: 500, rot: 0 }],
  markups: [], measures: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, JSON.stringify(${JSON.stringify({ [SID]: demoSite })}));
  localStorage.setItem(${JSON.stringify(CUR_KEY)}, ${JSON.stringify(SID)});
} catch (e) {} })();`;

/* ── 0) STATIC SOURCE ASSERTIONS — the fix itself is really there, not just in a scratch file. */
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
check("index.css pins html,body off the native page scroller (position: fixed)",
  /html,\s*body\s*\{[^}]*position:\s*fixed/s.test(css));
check("index.css's html,body pin sets overscroll-behavior: none",
  /html,\s*body\s*\{[^}]*overscroll-behavior:\s*none/s.test(css));
const sitePlannerSrc = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
check("the planner canvas <svg> still declares touchAction: \"none\"", /touchAction:\s*"none"/.test(sitePlannerSrc));
check("the canvas WRAP div also declares touchAction: \"none\" (defence in depth over floating chrome)",
  /ref=\{wrapRef\}[\s\S]{0,200}touchAction:\s*"none"/.test(sitePlannerSrc));
const mapFinderSrc = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
check("MapFinder's Leaflet host wrapper declares touchAction: \"none\" too (the other map surface)",
  /ref=\{elRef\}/.test(mapFinderSrc) && /touchAction:\s*"none"/.test(mapFinderSrc));
const mainSrc = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
check("the page-containment self-heal/telemetry guard is wired into boot (main.jsx)",
  /installPageContainmentGuard/.test(mainSrc));

/* ── Browser-driven checks ────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function newPage(deviceOverrides = {}) {
  const iphone = { ...devices["iPhone 13"], ...deviceOverrides };
  const ctx = await browser.newContext({ ...iphone, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errs };
}

async function touchDrag(cdp, x0, y0, x1, y1, steps = 8, holdMs = 16) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push({ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0].x, y: pts[0].y }] });
  for (let i = 1; i < pts.length; i++) {
    await new Promise((r) => setTimeout(r, holdMs));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[i].x, y: pts[i].y }] });
  }
  await new Promise((r) => setTimeout(r, holdMs));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

// A synthetic 2-finger pinch (both points move toward/away from a shared center).
async function touchPinch(cdp, cx, cy, r0, r1, steps = 8, holdMs = 16) {
  const pt = (i, r) => {
    const t = i / steps, rr = r0 + (r1 - r0) * t;
    return [{ x: cx - rr, y: cy }, { x: cx + rr, y: cy }];
  };
  const p0 = pt(0, r0);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: p0.map((p) => ({ x: p.x, y: p.y })) });
  for (let i = 1; i <= steps; i++) {
    await new Promise((r) => setTimeout(r, holdMs));
    const p = pt(i, r0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: p.map((q) => ({ x: q.x, y: q.y })) });
  }
  await new Promise((r) => setTimeout(r, holdMs));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function readShellState(page) {
  return page.evaluate(() => {
    const de = document.documentElement, b = document.body;
    // The literal fixed chrome the owner's screenshot showed colliding: the device status bar
    // row (outside our control) overlapping the app's own module-tab row. `header` doesn't exist
    // on every route (the Site Planner's own chrome is a plain <div>), so prefer a real module
    // tab — present on every route this harness drives — and fall back to <header> where it
    // exists (MapFinder / Schedule), rather than silently comparing two nulls (DRIVER-SCROLL-IS-
    // NOT-APP-SCROLL §6 — a check must prove it found something before its "unchanged" is worth
    // anything).
    const chrome = document.querySelector('[data-testid^="module-tab-"]') || document.querySelector("header");
    const root = document.getElementById("root");
    const box = (el) => el ? (({ left, top, right, bottom }) => ({ left, top, right, bottom }))(el.getBoundingClientRect()) : null;
    return {
      winScrollX: window.scrollX, winScrollY: window.scrollY,
      deScrollLeft: de.scrollLeft, deScrollTop: de.scrollTop,
      bodyScrollLeft: b.scrollLeft, bodyScrollTop: b.scrollTop,
      scrollWidth: de.scrollWidth, innerWidth: window.innerWidth,
      htmlPosition: getComputedStyle(de).position, bodyPosition: getComputedStyle(b).position,
      rootRect: box(root), chromeFound: !!chrome, chromeRect: box(chrome),
      vvScale: window.visualViewport ? window.visualViewport.scale : 1,
      vvOffsetLeft: window.visualViewport ? window.visualViewport.offsetLeft : 0,
    };
  });
}

function assertContained(label, before, after) {
  check(`${label}: document scroll unchanged`, before.deScrollLeft === after.deScrollLeft && before.deScrollTop === after.deScrollTop && before.winScrollX === after.winScrollX && before.winScrollY === after.winScrollY,
    `(${before.deScrollLeft},${before.deScrollTop}) -> (${after.deScrollLeft},${after.deScrollTop})`);
  check(`${label}: #root position unchanged`, JSON.stringify(before.rootRect) === JSON.stringify(after.rootRect),
    `${JSON.stringify(before.rootRect)} -> ${JSON.stringify(after.rootRect)}`);
  if (before.chromeFound) {
    check(`${label}: fixed chrome (module tab / header) position unchanged — no collision`, JSON.stringify(before.chromeRect) === JSON.stringify(after.chromeRect),
      `${JSON.stringify(before.chromeRect)} -> ${JSON.stringify(after.chromeRect)}`);
  } else {
    skip(`${label}: fixed chrome position unchanged`, "no module-tab or header element found on this route to compare");
  }
  check(`${label}: no new horizontal overflow`, after.scrollWidth <= after.innerWidth + 2,
    `scrollWidth=${after.scrollWidth} innerWidth=${after.innerWidth}`);
}

// ── 1) Portrait: the Site Planner canvas, several drag origins ─────────────────────────────
{
  const { ctx, page, cdp, errs } = await newPage();
  await page.goto(`${BASE}#/project/${GID}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  await assertMeasurable(page, "verify-mobile-pan-containment");

  const inPlanner = await page.evaluate(() => !!document.querySelector('[data-testid="planner-canvas"]'));
  check("boots into the planner canvas (portrait)", inPlanner);
  const state0 = await readShellState(page);
  check("html/body are actually pinned (position: fixed) in the live app", state0.htmlPosition === "fixed" && state0.bodyPosition === "fixed",
    `html=${state0.htmlPosition} body=${state0.bodyPosition}`);

  if (inPlanner) {
    const svgBox = await page.evaluate(() => document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect().toJSON());

    // (a) drag starting ON the building (dense fixture — the case that actually reproduced Fix 1's
    // mechanism last time; also the case a page-drag defect would show through the strongest).
    let before = await readShellState(page);
    await touchDrag(cdp, svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2, svgBox.x + svgBox.width / 2 - 120, svgBox.y + svgBox.height / 2 - 80);
    await page.waitForTimeout(250);
    assertContained("drag starting ON the building", before, await readShellState(page));

    // (b) drag starting on EMPTY canvas (inside the parcel, outside the building).
    before = await readShellState(page);
    await touchDrag(cdp, svgBox.x + svgBox.width * 0.12, svgBox.y + svgBox.height * 0.12, svgBox.x + svgBox.width * 0.12 + 140, svgBox.y + svgBox.height * 0.12 + 90);
    await page.waitForTimeout(250);
    assertContained("drag starting on EMPTY canvas", before, await readShellState(page));

    // (c) drag starting right at the LEFT EDGE of the screen — the zone a native edge-swipe-back
    // gesture would claim, and where CSS rubber-banding is most likely to show through.
    before = await readShellState(page);
    await touchDrag(cdp, 3, svgBox.y + svgBox.height / 2, 160, svgBox.y + svgBox.height / 2);
    await page.waitForTimeout(250);
    assertContained("drag starting at the LEFT screen edge", before, await readShellState(page));

    // (d) drag starting right at the RIGHT edge (the mirror case — reveals a right-side gutter
    // in the owner's screenshot).
    before = await readShellState(page);
    const vw = await page.evaluate(() => window.innerWidth);
    await touchDrag(cdp, vw - 3, svgBox.y + svgBox.height / 2, vw - 160, svgBox.y + svgBox.height / 2);
    await page.waitForTimeout(250);
    assertContained("drag starting at the RIGHT screen edge", before, await readShellState(page));

    // (e) a real two-finger PINCH on the canvas — must zoom the map, never pan/zoom the PAGE.
    before = await readShellState(page);
    await touchPinch(cdp, svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2, 40, 140);
    await page.waitForTimeout(250);
    const afterPinch = await readShellState(page);
    check("two-finger pinch on the canvas: page scroll unchanged", afterPinch.winScrollX === before.winScrollX && afterPinch.winScrollY === before.winScrollY);
    check("two-finger pinch on the canvas: page visualViewport scale unchanged (canvas owns its own zoom)",
      Math.abs(afterPinch.vvScale - before.vvScale) < 0.01, `${before.vvScale} -> ${afterPinch.vvScale}`);

    // (f) drag starting on the HEADER chrome (module tab row band, top of screen).
    before = await readShellState(page);
    await touchDrag(cdp, vw / 2, 40, vw / 2 - 100, 40);
    await page.waitForTimeout(250);
    assertContained("drag starting on the HEADER", before, await readShellState(page));

    await page.screenshot({ path: OUT + "mobilepan-containment-portrait.png" });
  }

  // (g) LIVE WIRING PROOF — the runtime guard is actually installed and actually self-heals, in
  // the real running app (not just the unit-mocked window). Idle-deferred, so wait for it.
  await page.waitForFunction(() => window.__PLANYR_PAGE_CONTAINMENT_GUARD_INSTALLED === true, { timeout: 12000 }).catch(() => {});
  const installed = await page.evaluate(() => !!window.__PLANYR_PAGE_CONTAINMENT_GUARD_INSTALLED);
  check("the page-containment guard installs itself on a real boot", installed);
  if (installed) {
    await page.evaluate(() => { window.scrollTo(37, 51); window.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(50);
    const healed = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    check("DANGEROUS-MEANS-UNOBSERVABLE proof: forcing a scroll on the real page is caught and self-healed",
      healed.x === 0 && healed.y === 0, `after forced (37,51): (${healed.x},${healed.y})`);
  }

  check("no uncaught page errors (portrait canvas pass)", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── 2) Landscape: same core drag, different orientation ────────────────────────────────────
{
  const { ctx, page, cdp, errs } = await newPage({ viewport: { width: 844, height: 390 } });
  await page.goto(`${BASE}#/project/${GID}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  await assertMeasurable(page, "verify-mobile-pan-containment");
  const inPlanner = await page.evaluate(() => !!document.querySelector('[data-testid="planner-canvas"]'));
  check("boots into the planner canvas (landscape)", inPlanner);
  if (inPlanner) {
    const svgBox = await page.evaluate(() => document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect().toJSON());
    const before = await readShellState(page);
    await touchDrag(cdp, svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2, svgBox.x + svgBox.width / 2 - 150, svgBox.y + svgBox.height / 2 - 60);
    await page.waitForTimeout(250);
    assertContained("landscape drag on the building", before, await readShellState(page));
    await page.screenshot({ path: OUT + "mobilepan-containment-landscape.png" });
  }
  check("no uncaught page errors (landscape pass)", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── 3) The OTHER map surface — the account/site-picker map (MapFinder, no project selected) ─
{
  const { ctx, page, cdp, errs } = await newPage();
  await page.goto(`${BASE}#/site`, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  await assertMeasurable(page, "verify-mobile-pan-containment");
  const hasLeaflet = await page.evaluate(() => !!document.querySelector(".leaflet-container"));
  check("boots into a Leaflet map surface (site picker / MapFinder)", hasLeaflet);
  if (hasLeaflet) {
    const box = await page.evaluate(() => document.querySelector(".leaflet-container").getBoundingClientRect().toJSON());
    const before = await readShellState(page);
    await touchDrag(cdp, box.x + box.width / 2, box.y + box.height / 2, box.x + box.width / 2 - 130, box.y + box.height / 2 - 70);
    await page.waitForTimeout(250);
    assertContained("drag on the account map (MapFinder)", before, await readShellState(page));
    await page.screenshot({ path: OUT + "mobilepan-containment-mapfinder.png" });
  }
  check("no uncaught page errors (MapFinder pass)", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── 4) A non-map module — proves the fix is app-shell-level, not Site-Planner-specific ──────
{
  const { ctx, page, cdp, errs } = await newPage();
  await page.goto(`${BASE}#/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  await assertMeasurable(page, "verify-mobile-pan-containment");
  const state0 = await readShellState(page);
  check("html/body stay pinned on the Schedule module too", state0.htmlPosition === "fixed" && state0.bodyPosition === "fixed");
  const before = await readShellState(page);
  const vw = await page.evaluate(() => window.innerWidth), vh = await page.evaluate(() => window.innerHeight);
  await touchDrag(cdp, vw / 2, vh / 2, vw / 2 - 120, vh / 2 - 60);
  await page.waitForTimeout(250);
  assertContained("drag on the Schedule module", before, await readShellState(page));
  check("no uncaught page errors (Schedule pass)", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();

/* ── Known gaps, named rather than silently skipped (WEBKIT-GAP / FOREGROUND-OR-VOID discipline) */
skip("Safari URL-bar expanded vs collapsed mid-gesture", "no headless browser here can produce Mobile Safari's real collapsing toolbar (B1168128 third pass)");
skip("behaviour after the on-screen keyboard opens/dismisses", "no headless browser here renders a real virtual keyboard or its visualViewport resize");
skip("the owner's LITERAL reported page-drag, reproduced directly", "Apple-WebKit-only native gesture handling; unreproducible in Chromium or Linux WebKit (B1168128 first arc, 4 passes) — see Blocker: real-device in BACKLOG.md/VERIFICATION.md");

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
