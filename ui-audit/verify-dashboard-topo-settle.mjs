/* B1617217 (NEW-2, 2026-09-17, owner ask) — "the background topo should have some lag to it."
 *
 * Proves the actual MECHANISM (not just a vibe): after the cursor makes a sudden jump, the
 * canvas's coral cursor-highlight does NOT snap to the new point — it stays mostly at the OLD
 * point for a beat, then gradually migrates to the new one, monotonically (no oscillation/
 * overshoot — a lerp can't produce one). Measured by sampling the canvas's own drawn pixel color
 * (2D `getImageData`, the same technique V943808 used) at both the old and new cursor points at
 * several times after the jump.
 *
 * Signed out, no external GIS, no real project data — pure animation/interaction behaviour, same
 * reasoning as this component's three prior live-verifies (V943808/V979696/V1010224): Claude-
 * doable per ATTEMPT-BEFORE-YOU-PARK, must not be filed as needing a human pass.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-dashboard-topo-settle.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

// Coral-channel "how much tint is here" reading. Two things make a single-pixel read useless:
// the highlight composites BRAND.coral over whatever's already drawn with `globalCompositeOperation
// = "source-atop"`, which means it paints ONLY where a contour line already left non-transparent
// ink — most of the canvas is fully transparent, so an arbitrary single pixel almost always reads
// zero regardless of cursor position. So this averages (r - b) — a cheap, theme-agnostic "how
// coral" proxy, since coral is high-R/low-B relative to this app's neutral line/background tones —
// over a real box wide enough to contain several contour-line segments (the grid cell is ~10-13
// CSS px, so an 80px box spans roughly 6-8 cells in each direction).
async function coralIntensity(page, x, y, boxPx = 80) {
  return page.evaluate(([px, py, box]) => {
    const canvas = document.querySelector('[data-testid="dashboard-topo-background"]');
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const half = Math.round((box / 2) * dpr);
    const cx = Math.round(px * dpr), cy = Math.round(py * dpr);
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
    const w = Math.min(canvas.width, cx + half) - x0, h = Math.min(canvas.height, cy + half) - y0;
    const data = ctx.getImageData(x0, y0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) { sum += data[i] - data[i + 2]; n++; }
    return n ? sum / n : 0;
  }, [x, y, boxPx]);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
await page.route(/supabase\.co/, (r) => r.abort()); // topo background needs no data at all
await assertMeasurable(page, "verify-dashboard-topo-settle");
await page.goto(`${BASE}#/`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="dashboard-topo-background"]', { timeout: 20_000 });

const A = { x: 500, y: 400 };
const B = { x: 1100, y: 800 }; // far enough from A that the radial highlight (radius 340) doesn't overlap both

// ── 1. Settle fully at A first (a real ramp-up, not an instant snap on entry).
await page.mouse.move(A.x, A.y);
await pacedWait(page, 1600);
const baselineA = await coralIntensity(page, A.x, A.y);
const baselineB = await coralIntensity(page, B.x, B.y);
ok(baselineA !== null, "the topo canvas is readable via getImageData");
// Ambient (no-cursor) contour ink reads slightly negative on this proxy (this app's line tokens
// lean cooler than warm), so "a real coral tint" is judged against baselineB (the untouched,
// no-highlight point) rather than an absolute magic number.
ok(baselineA > baselineB + 3, `settled at A shows a real coral tint above the untouched-point baseline (A=${baselineA}, untouched B=${baselineB})`);

// ── 2. Sudden jump A → B. Sample IMMEDIATELY (one input event, no settle time) and confirm the
//    highlight has NOT snapped — most of the tint is still at A, not yet at B.
await page.mouse.move(B.x, B.y);
const rightAfterJumpA = await coralIntensity(page, A.x, A.y);
const rightAfterJumpB = await coralIntensity(page, B.x, B.y);
ok(rightAfterJumpA > baselineA * 0.5, `A still shows most of its tint immediately after the jump (before: ${baselineA}, after: ${rightAfterJumpA})`);
ok(rightAfterJumpB < baselineA * 0.3, `B has NOT snapped to full tint immediately after the jump (got r-b=${rightAfterJumpB}, would be ~${baselineA} if lockstep)`);

// ── 3. Gradual, monotonic migration — sample a few times through the settle window and confirm
//    B climbs while A falls, with no oscillation (a lerp cannot overshoot).
const samples = [];
for (const waitMs of [150, 350, 700, 1600]) {
  await pacedWait(page, waitMs);
  samples.push({ t: waitMs, a: await coralIntensity(page, A.x, A.y), b: await coralIntensity(page, B.x, B.y) });
}
console.log("  · migration samples:", samples.map((s) => `t+${s.t}ms A=${s.a} B=${s.b}`).join(" | "));

let monotonicA = true, monotonicB = true;
let prev = { a: rightAfterJumpA, b: rightAfterJumpB };
for (const s of samples) {
  if (s.a > prev.a + 2) monotonicA = false; // allow ±2 for antialiasing/dpr rounding noise
  if (s.b < prev.b - 2) monotonicB = false;
  prev = s;
}
ok(monotonicA, "A's tint falls monotonically (no oscillation) as the highlight leaves it");
ok(monotonicB, "B's tint rises monotonically (no oscillation) as the highlight arrives");

const final = samples[samples.length - 1];
ok(final.b > baselineA * 0.6, `B reaches a strong tint once fully settled (got r-b=${final.b}, baseline was ${baselineA})`);
ok(final.a < baselineA * 0.3, `A fades back down once the highlight has moved on (got r-b=${final.a})`);

// ── 4. prefers-reduced-motion still renders exactly one static frame — untouched by this item
//    (the SETTLE easing lives entirely inside the rAF loop, which reduced-motion never starts),
//    reconfirmed directly rather than only cited from prior sessions' passes on this component.
const reduceCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: "reduce" });
const reducePage = await reduceCtx.newPage();
await reducePage.route(/supabase\.co/, (r) => r.abort());
await reducePage.goto(`${BASE}#/`, { waitUntil: "load" });
await reducePage.waitForSelector('[data-testid="dashboard-topo-background"]', { timeout: 20_000 });
const frame1 = await reducePage.evaluate(() => document.querySelector('[data-testid="dashboard-topo-background"]').toDataURL());
await pacedWait(reducePage, 900);
const frame2 = await reducePage.evaluate(() => document.querySelector('[data-testid="dashboard-topo-background"]').toDataURL());
ok(frame1 === frame2, "prefers-reduced-motion still renders exactly one static frame (untouched by this item)");
await reduceCtx.close();

// ── 5. Dark theme still renders the canvas with no crash (color tokens are untouched by this item).
const darkCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, colorScheme: "dark" });
const darkPage = await darkCtx.newPage();
await darkPage.route(/supabase\.co/, (r) => r.abort());
await darkPage.goto(`${BASE}#/`, { waitUntil: "load" });
await darkPage.waitForSelector('[data-testid="dashboard-topo-background"]', { timeout: 20_000 });
await darkPage.mouse.move(500, 400);
await pacedWait(darkPage, 1000);
const darkTint = await coralIntensity(darkPage, 500, 400);
ok(darkTint !== null && darkTint > 0, `dark theme still renders a live, cursor-following canvas (got r-b=${darkTint})`);
await darkCtx.close();

// ── 6. Perf — this item only renames existing inline numbers and swaps three duplicated inline
//    lerp lines for one shared `easeToward` call (same arithmetic, same call count per frame), so
//    there is no plausible mechanism for a cost regression — but "check it, don't guess"
//    (CLAUDE.md) applies, so this measures real frame deltas during an active cursor-follow
//    gesture and checks them against perfTrigger.js's own FLOOR_MS (33ms — two frames of a 60Hz
//    budget) rather than reasoning about it in the abstract.
await page.mouse.move(700, 500);
await pacedWait(page, 500); // let ptr.s ramp up so the highlight/gradient draw is actually active
const frameDeltas = await page.evaluate(() => new Promise((resolve) => {
  const deltas = [];
  let last = performance.now();
  let x = 700;
  function tick(now) {
    deltas.push(now - last);
    last = now;
    x = x > 1000 ? 700 : x + 15; // synthetic in-page movement isn't needed for the app's own
    // cursor state (already following real mouse input above) — this loop just samples the
    // frame cadence while that real animation runs.
    if (deltas.length < 90) requestAnimationFrame(tick);
    else resolve(deltas);
  }
  requestAnimationFrame(tick);
}));
const meanDelta = frameDeltas.reduce((s, d) => s + d, 0) / frameDeltas.length;
const maxDelta = Math.max(...frameDeltas);
ok(meanDelta < 33, `mean frame delta during an active cursor-follow gesture stays well under perfTrigger's FLOOR_MS (got ${meanDelta.toFixed(2)}ms)`);
console.log(`  · frame timing: mean=${meanDelta.toFixed(2)}ms max=${maxDelta.toFixed(2)}ms over ${frameDeltas.length} frames`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
