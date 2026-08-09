#!/usr/bin/env node
/* verify-new2-vertex-drag — frame time during a scripted PARCEL-VERTEX drag.
 *
 * The owner's report is specific: "dragging a polygon vertex lags". The standing perf harness
 * (ui-audit/perf-harness.mjs) drags the CANVAS, which is a different code path — a pan writes
 * `view` and repaints, while a vertex drag invalidates the geometry the render body derives
 * (parcel overlap + dissolve, the element metrics loop) on every single pointermove. So this
 * measures the gesture that was actually reported.
 *
 * It reuses the standing harness's machinery deliberately:
 *   • the same committed reference scenario (ui-audit/lib/perf-scenario.mjs);
 *   • the same continuously-running frame sampler;
 *   • and, most importantly, the same REFUSAL TO REPORT A NUMBER IT CANNOT STAND BEHIND —
 *     ui-audit/lib/frameSampling.mjs. requestAnimationFrame is suspended in a backgrounded tab
 *     and says nothing about it, and a PARTLY throttled run still yields a plausible-looking
 *     median from a starved sample. That is the B1086 trap, and the whole point of the shared
 *     rule: tab must be visible, observed frame rate must clear MIN_PLAUSIBLE_FPS, or the run
 *     reports UNRELIABLE and exits non-zero rather than printing a median.
 *
 * Usage (a preview server must be serving the build under test):
 *   node ui-audit/verify-new2-vertex-drag.mjs
 *   BASE_URL=https://planyr.io node ui-audit/verify-new2-vertex-drag.mjs
 *   node ui-audit/verify-new2-vertex-drag.mjs --json
 *
 * To compare before/after, build each revision, serve it, and run this against both — the
 * scenario, the gesture and the sampler are fixed, so the two runs are comparable.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const MOVES = 60; // pointermove events in the scripted drag

const { perfScenarioSite, SCENARIO_ID } = await import("./lib/perf-scenario.mjs");
const { frameSamplingFault, observedFps } = await import("./lib/frameSampling.mjs");

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", "--enable-precise-memory-info"],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
/* The SAME committed reference scenario, with ONE documented deviation: `settings.parcelSelect`
 * is turned on. B311 made parcels click-through by default, so with the stock seed a press on the
 * boundary falls through to a canvas pan and this harness would measure the wrong gesture
 * entirely (it aborts rather than do that — see below). Nothing else about the scenario changes,
 * so the geometry, element count and derivation load are the standing reference's. */
const site = { ...perfScenarioSite(), settings: { parcelSelect: true } };
await ctx.addInitScript(`(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [site.id]: site }))});
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
  window.__PLANYR_E2E = true;   // the sanctioned read-only view probe (window.__plannerView)
} catch (e) {} })();`);
await ctx.addInitScript(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-new2-vertex-drag");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(1500); // let the scenario settle (layout, labels, first derivations)

const svg = page.locator("svg[role=application]");
const box = await svg.boundingBox();

/* Control-point selector. `[data-testid="vtx-handle"]` is the one this repo ships; the geometric
 * fallback (a 10×10 review-chrome rect) is what lets this harness run unchanged against an OLDER
 * build — which is the entire point of a before/after measurement, and would be impossible if the
 * only selector were an attribute the baseline does not carry. */
const HANDLE = 'rect[data-testid="vtx-handle"], rect[data-export="skip"][width="10"][height="10"]';

/* Select the parcel so its control points render. A press only selects when it lands on the
 * boundary's own hit-stroke, so the screen position is COMPUTED from the scenario's known
 * geometry through the app's read-only view probe (ppf/offX/offY + the B1141 registration
 * shift) rather than guessed at a fraction of the viewport. Several vertices are tried, because
 * a harness that depends on one exact pixel is how a harness starts lying about what it ran. */
const toScreen = async (pt) => page.evaluate(({ p, ox, oy }) => {
  const v = window.__plannerView.get();
  const r = window.__plannerView.registration ? window.__plannerView.registration() : { dx: 0, dy: 0 };
  return { x: ox + v.offX + p.x * v.ppf + (r.dx || 0), y: oy + v.offY + p.y * v.ppf + (r.dy || 0) };
}, { p: pt, ox: box.x, oy: box.y });

async function selectParcel() {
  const pts = site.parcels[0].points;
  for (const i of [0, 6, 12, 18, 20, 3, 9]) {
    const p = pts[i % pts.length];
    const s = await toScreen(p);
    if (s.x < box.x + 4 || s.x > box.x + box.width - 4 || s.y < box.y + 4 || s.y > box.y + box.height - 4) continue;
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(150);
    if (await page.locator(HANDLE).count() > 0) return true;
  }
  return false;
}

const selected = await selectParcel();
if (!selected) {
  console.error("✗ could not select the scenario parcel — no vertex handles rendered. Aborting rather than reporting a canvas-pan number as a vertex drag.");
  await browser.close();
  process.exit(2);
}

const handles = page.locator(HANDLE);
const handleCount = await handles.count();
// Grab a FRONTAGE vertex (the undulating north edge carries most of the boundary's points), so
// the drag is over the part of the geometry with the most downstream work behind it.
const grab = await handles.nth(Math.min(4, handleCount - 1)).boundingBox();
const gx = grab.x + grab.width / 2, gy = grab.y + grab.height / 2;

/* ---- COMMITS PER GESTURE ---------------------------------------------------------------
 * Frame time alone cannot separate these builds on this scenario, and saying otherwise would be
 * dishonest: the stand-in is deliberately LIGHTER than the owner's real plan (see the reference
 * scenario's own header), so both sit on the 60 Hz vsync floor and the median reads 16.7 ms
 * either way. What the change actually does is reduce how many times the render body runs per
 * gesture — so measure THAT, directly, and let it be the attributable number.
 *
 * A React commit applies its DOM writes synchronously in one batch, so one MutationObserver
 * callback ≈ one commit. This needs no app instrumentation at all, which is what lets the exact
 * same harness run against an older build — a probe that only exists after the change can never
 * produce a before number. Long tasks are counted alongside: they are the frames a real, heavier
 * plan would actually drop. */
await page.evaluate(() => {
  window.__commits = 0; window.__mutations = 0; window.__moves = 0; window.__longTasks = [];
  const svgEl = document.querySelector("svg[role=application]");
  window.__mo = new MutationObserver((recs) => { window.__commits += 1; window.__mutations += recs.length; });
  window.__mo.observe(svgEl, { attributes: true, childList: true, subtree: true, characterData: true });
  window.__moveCount = (e) => { if (e.buttons) window.__moves += 1; };
  svgEl.addEventListener("pointermove", window.__moveCount, true);
  try {
    window.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(e.duration); });
    window.__po.observe({ entryTypes: ["longtask"] });
  } catch (_) { window.__po = null; }
});

await page.evaluate(() => { window.__frames.length = 0; });
const t0 = Date.now();
await page.mouse.move(gx, gy);
await page.mouse.down();
for (let i = 0; i < MOVES; i++) {
  // A tight orbit around the grabbed point: a real reshape gesture, and it keeps the vertex
  // inside the boundary so the drag never degenerates into a self-crossing revert.
  await page.mouse.move(gx + Math.sin(i / 4) * 90, gy + Math.cos(i / 6) * 70, { steps: 2 });
}
const gestureMs = Date.now() - t0;   // the pointer stays DOWN for the burst phase below
await page.waitForTimeout(120);      // let the last commit of the scripted phase land
const raw = await page.evaluate(() => window.__frames.slice());
const work = await page.evaluate(() => ({
  commits: window.__commits, mutations: window.__mutations, moves: window.__moves,
  longTasks: window.__longTasks.length, longTaskMs: +window.__longTasks.reduce((a, b) => a + b, 0).toFixed(1),
}));

/* ---- THE BURST — the case the coalescing exists for ------------------------------------
 * Playwright's mouse.move awaits between events, so a scripted drag delivers at best ONE move
 * per painted frame — which is precisely the case where coalescing has nothing to coalesce, and
 * why the phase above reads identically on either build. Real hardware does not behave like
 * that: a 120 Hz trackpad (and Chrome's own coalesced pointer events, which run higher still)
 * delivers several moves inside a single frame, and THAT is the lag the owner reported.
 *
 * So reproduce it honestly: with the drag genuinely held (a real pointerdown, real pointer
 * capture), dispatch a tight burst of pointermove events inside ONE task, then count the commits
 * they produced. Uncoalesced, every move re-runs the render body and writes the DOM — the count
 * tracks the burst. Coalesced, the burst collapses to the frames that were actually painted. */
const BURST = 40;
await page.evaluate(() => { window.__commits = 0; window.__mutations = 0; window.__moves = 0; });
await page.evaluate(({ n, x, y }) => new Promise((done) => {
  const svgEl = document.querySelector("svg[role=application]");
  /* Each move must be its OWN TASK, exactly as the browser delivers real input — dispatching the
     whole burst inside one task would let React's automatic batching collapse it for free, which
     is not what happens on real hardware and would make both builds look identical for the wrong
     reason. A MessageChannel yields a fresh macrotask with no 4 ms clamp, so this delivers moves
     far faster than the display refreshes: the 120–240 Hz case, reproduced. */
  const ch = new MessageChannel();
  let i = 0;
  ch.port1.onmessage = () => {
    if (i >= n) { requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 80))); return; }
    svgEl.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1,
      clientX: x + Math.sin(i / 3) * 60, clientY: y + Math.cos(i / 4) * 45,
    }));
    i += 1;
    ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
}), { n: BURST, x: gx, y: gy });
const burst = await page.evaluate(() => ({ commits: window.__commits, mutations: window.__mutations }));

await page.mouse.up();
await page.waitForTimeout(200);
await page.evaluate(() => {
  try { window.__mo.disconnect(); } catch (_) {}
  try { if (window.__po) window.__po.disconnect(); } catch (_) {}
  const svgEl = document.querySelector("svg[role=application]");
  if (svgEl && window.__moveCount) svgEl.removeEventListener("pointermove", window.__moveCount, true);
});
const frames = raw.slice(1); // the first delta spans the idle gap before the gesture
const visibility = await page.evaluate(() => document.visibilityState);
const fault = frameSamplingFault({ visibility, samples: frames.length, gestureMs });
const fps = observedFps(frames.length, gestureMs);

const out = {
  scenario: SCENARIO_ID,
  gesture: "parcel-vertex-drag",
  handles: handleCount,
  moves: MOVES,
  gestureMs,
  samples: frames.length,
  observedFps: fps,
  visibility,
  frameMedianMs: fault ? null : (frames.length ? +pct(frames, 50).toFixed(1) : null),
  frameP90Ms: fault ? null : (frames.length ? +pct(frames, 90).toFixed(1) : null),
  frameMaxMs: fault ? null : (frames.length ? +Math.max(...frames).toFixed(1) : null),
  unreliable: fault,
  ...work,
  commitsPerMove: work.moves ? +(work.commits / work.moves).toFixed(2) : null,
  burstMoves: BURST,
  burstCommits: burst.commits,
  burstMutations: burst.mutations,
};

await browser.close();

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(fault ? 1 : 0); }

console.log("Vertex-drag frame timing (NEW-2)");
console.log(`  target: ${BASE}`);
console.log(`  scenario: ${out.scenario} — ${out.handles} boundary control points`);
console.log(`  gesture: ${out.moves} pointermoves over ${out.gestureMs} ms`);
console.log(`  frame samples: ${out.samples} (${out.observedFps} fps, tab "${out.visibility}")`);
if (fault) {
  console.log(`\n  ✗ UNRELIABLE MEASUREMENT — ${fault}`);
  console.log("     No median is reported. A starved sample still produces a plausible-looking number,");
  console.log("     and that is exactly how a wrong figure gets quoted (B1086).");
  process.exit(1);
}
console.log(`\n  frameMedian ${out.frameMedianMs} ms · frameP90 ${out.frameP90Ms} ms · worst ${out.frameMaxMs} ms`);
console.log(`  DOM commits during the drag: ${out.commits} over ${out.moves} pointermoves (${out.commitsPerMove} per move, ${out.mutations} attribute/node writes)`);
console.log(`  long tasks: ${out.longTasks} totalling ${out.longTaskMs} ms`);
console.log(`\n  BURST (${out.burstMoves} pointermoves, one per task, faster than the display refreshes):`);
console.log(`    commits ${out.burstCommits} · DOM writes ${out.burstMutations}`);
console.log(`    Uncoalesced this tracks the move count; coalesced it collapses to the painted frames.`);
console.log("\n  (Compare against the same command run on the base revision — the scenario, the gesture");
console.log("   and the sampler are all fixed, so the two runs are directly comparable.)");
