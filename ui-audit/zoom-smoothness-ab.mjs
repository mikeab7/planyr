#!/usr/bin/env node
/* zoom-smoothness-ab — THE SAME WHEEL GESTURE, BEFORE AND AFTER (B1449, step 5 of the plan).
 *
 * The owner asked to judge the real thing rather than a description, and said plainly what the
 * acceptance criterion is: *"I don't really care what the process is as long as the end result is
 * smooth and professional… world class quality."* So this records A VIDEO of one scripted wheel
 * gesture in each arm and hands him both, and the numbers below exist only to explain what he is
 * looking at — they are not the bar.
 *
 * THE TWO ARMS, and why this A/B is honest:
 *   • `off` — Smooth zoom turned off. That IS the pre-B1449 render path: no anchor arms, so every
 *     wheel notch re-emits the whole plan at the new px-per-foot, exactly as before.
 *   • `on`  — the anchored render.
 * Both arms are the SAME BUILD driven by the SAME dispatched events, so nothing but the anchor
 * differs. (The proportional wheel factor is NOT gated by the setting and is live in both arms —
 * stated because pretending otherwise would make this A/B claim more than it measures. Its own
 * before/after is numeric and lives in test/viewAnchor.test.js: the old rule gave a 4-pixel
 * trackpad nudge the same 12% jump as a full mouse detent.)
 *
 * WHAT IS COUNTED, and why counts rather than milliseconds (the house idiom):
 *   • `mutations`  — DOM mutation records the canvas emits across the gesture. This is the same
 *     measure B1440's pan increment was proven on (101,267 → 2,194) and it is the thing the owner
 *     feels as "it's recomputing".
 *   • `firstChangeMs` — ONE wheel event to the DOM reflecting it. This is his "there's a delay",
 *     measured as its own number rather than folded into a throughput figure, exactly as asked.
 *   • `settleMs`   — the last notch to the re-baked frame, i.e. how long the drawing holds the
 *     anchor's line weights before it snaps sharp. The cost side of the trade.
 *
 *   node ui-audit/zoom-smoothness-ab.mjs --build
 *   node ui-audit/zoom-smoothness-ab.mjs --json
 *
 * Reports; does not gate. The gate is ui-audit/verify-midgesture-zoom.mjs.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertForeground } from "./lib/tabTiming.mjs";

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const DO_BUILD = process.argv.includes("--build");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = Number(argOf("--port", 4195));
const BASE = `http://localhost:${PORT}/`;
const OUTDIR = path.resolve(argOf("--out", "ui-audit/out/zoom-ab"));
const NOTCHES = Number(argOf("--notches", 8));
const NOTCH_MS = Number(argOf("--notch-ms", 55));   // a brisk but human wheel sweep

if (DO_BUILD) execFileSync("npx", ["vite", "build"], { stdio: JSON_OUT ? "ignore" : "inherit" });
if (!fs.existsSync("dist/index.html")) { console.error("⛔ No build at dist/. Run with --build."); process.exit(2); }
fs.mkdirSync(OUTDIR, { recursive: true });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch { /* already gone */ } });
const up = await (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try { const r = await fetch(BASE); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})();
if (!up) { server.kill(); console.error("⛔ preview server never came up"); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function arm(on) {
  const dir = path.join(OUTDIR, on ? "after-smooth-zoom" : "before-smooth-zoom");
  fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: 1280, height: 800 } },
  });
  await ctx.addInitScript(perfScenarioSeed());
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.addInitScript(`try { localStorage.setItem("planarfit:smoothZoom", ${JSON.stringify(on ? "1" : "0")}); } catch {}`);
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  /* ⛔ A wall-clock reading from a BACKGROUND tab is void — a hidden tab clamps setTimeout, and a
     setTimeout-paced probe then times the clamp (measured: 3,156 ms for a 138-182 ms gesture).
     See ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting a throttled number. */
  await assertForeground(page, "zoom-smoothness-ab");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
  await page.waitForTimeout(3500);

  /* THE LATENCY PROBE. One wheel event, and the clock stops when the canvas's own `data-view-ppf`
   * changes — i.e. when the DOM actually reflects the zoom. Measured on its own, from a settled
   * canvas, so nothing else is queued in front of it. */
  const anchorPt = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
    return { x: r.x + r.width * 0.32, y: r.y + r.height * 0.38 };
  });
  const firstChangeMs = await page.evaluate((a) => new Promise((resolve) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const before = svg.getAttribute("data-view-ppf");
    const obs = new MutationObserver(() => {
      if (svg.getAttribute("data-view-ppf") !== before) { obs.disconnect(); resolve(performance.now() - t0); }
    });
    obs.observe(svg, { attributes: true, attributeFilter: ["data-view-ppf"] });
    setTimeout(() => { obs.disconnect(); resolve(-1); }, 3000);
    const t0 = performance.now();
    (document.elementFromPoint(a.x, a.y) || svg).dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, deltaMode: 0, clientX: a.x, clientY: a.y, bubbles: true, cancelable: true }));
  }), anchorPt);
  await page.waitForTimeout(900);

  /* THE SWEEP. Mutation records across a real multi-notch gesture, plus how long after the last
   * notch the frame re-bakes. */
  await page.evaluate(() => {
    window.__mut = 0;
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    window.__obs = new MutationObserver((recs) => { window.__mut += recs.length; });
    window.__obs.observe(svg, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  for (let i = 0; i < NOTCHES; i++) {
    await page.evaluate((a) => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      (document.elementFromPoint(a.x, a.y) || svg).dispatchEvent(
        new WheelEvent("wheel", { deltaY: -100, deltaMode: 0, clientX: a.x, clientY: a.y, bubbles: true, cancelable: true }));
    }, anchorPt);
    await page.waitForTimeout(NOTCH_MS);
  }
  const settleMs = await page.evaluate(() => new Promise((resolve) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const t0 = performance.now();
    if (Number(svg.getAttribute("data-pan-k")) === 1) return resolve(0);
    const obs = new MutationObserver(() => {
      if (Number(svg.getAttribute("data-pan-k")) === 1) { obs.disconnect(); resolve(performance.now() - t0); }
    });
    obs.observe(svg, { attributes: true, attributeFilter: ["data-pan-k"] });
    setTimeout(() => { obs.disconnect(); resolve(-1); }, 4000);
  }));
  await page.waitForTimeout(600);
  const mutations = await page.evaluate(() => { window.__obs.disconnect(); return window.__mut; });

  // …and a slow zoom back out, so the recording shows both directions of the same gesture.
  for (let i = 0; i < NOTCHES; i++) {
    await page.evaluate((a) => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      (document.elementFromPoint(a.x, a.y) || svg).dispatchEvent(
        new WheelEvent("wheel", { deltaY: 100, deltaMode: 0, clientX: a.x, clientY: a.y, bubbles: true, cancelable: true }));
    }, anchorPt);
    await page.waitForTimeout(NOTCH_MS);
  }
  await page.waitForTimeout(1200);

  const video = page.video();
  await ctx.close();                       // flushes the video file
  const file = video ? await video.path() : null;
  return { arm: on ? "on" : "off", firstChangeMs: Math.round(firstChangeMs), mutations, settleMs: Math.round(settleMs), video: file };
}

const off = await arm(false);
const on = await arm(true);
await browser.close();
server.kill();

const out = {
  notches: NOTCHES, notchMs: NOTCH_MS,
  before: off, after: on,
  mutationsRatio: off.mutations && on.mutations ? +(off.mutations / on.mutations).toFixed(1) : null,
};
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`\nSAME wheel gesture, ${NOTCHES} notches in and ${NOTCHES} back out, one build, one script.\n`);
  const row = (r) => `  ${r.arm === "on" ? "smooth zoom ON " : "smooth zoom OFF"} · wheel→DOM ${r.firstChangeMs} ms · ${r.mutations.toLocaleString()} DOM mutation records across the sweep · re-bakes ${r.settleMs} ms after the last notch`;
  console.log(row(off));
  console.log(row(on));
  if (out.mutationsRatio) console.log(`\n  ${out.mutationsRatio}× fewer DOM mutations with the anchor armed.`);
  console.log(`\n  videos:\n    before: ${off.video}\n    after:  ${on.video}`);
}
