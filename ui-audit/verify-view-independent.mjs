#!/usr/bin/env node
/* verify-view-independent — THE STANDING GUARD for VIEW-INDEPENDENT-ONCE (NEW-3).
 *
 * ⛔ WHY THIS HAS TO BE A COUNTER AND CANNOT BE A SCREENSHOT.
 * #926 said it plainly, and it is the reason this class was found twice by accident rather than
 * once by a test: *"a pan that silently goes back to baking the view is invisible to every
 * screenshot and behavioural test in this repo; only a frame counter would notice."* Both known
 * instances DRAW THE IDENTICAL PICTURE when broken. A pixel diff, a DOM assertion, an e2e click
 * path and the perceptual-parity harness all pass on the defect. What changes is how many times
 * the app answers a question it already knew the answer to — so that is what this counts.
 *
 * WHAT IT ASSERTS. It drives a PURE PAN (constant px-per-foot, model and settings frozen) on the
 * committed reference plan, through the same probe build the detector uses
 * (`ui-audit/detect-view-recompute.mjs`), and fails if any computation in `REGISTRY` below ran
 * more than ONCE across the whole gesture.
 *
 * ⛔ AND IT FAILS IF A REGISTERED COMPUTATION WAS NEVER OBSERVED AT ALL. That is how a guard of
 * this shape rots: the memo is renamed or deleted, the probe records nothing, and a guard that
 * only checks the sites it happens to see reports green forever. `guardVerdict` treats a missing
 * registration as a failure and names it (`test/recomputeProbe.test.js` pins that).
 *
 * The registry is keyed on `file:NAME`, never `file:line` — a line number moves on every unrelated
 * edit above it, so a line-keyed registry would either go stale silently or fail on every commit.
 *
 *   node ui-audit/verify-view-independent.mjs --build     # build the probe bundle first
 *   node ui-audit/verify-view-independent.mjs --json
 *
 * Exits non-zero on a violation. This one IS a gate.
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { classifyGesture, guardVerdict } from "./lib/viewIndependence.mjs";
import { REGISTRY } from "./lib/viewIndependentRegistry.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";


const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const DO_BUILD = process.argv.includes("--build");
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = Number(argOf("--port", 4189));
const BASE = `http://localhost:${PORT}/`;
const DIST = path.resolve("dist-probe");

if (DO_BUILD) {
  execFileSync("npx", ["vite", "build", "--outDir", "dist-probe", "--emptyOutDir"], {
    stdio: JSON_OUT ? "ignore" : "inherit", env: { ...process.env, PLANYR_PROBE: "1" },
  });
}
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`⛔ No probe build at ${DIST}. Run with --build.`);
  process.exit(2);
}

const server = spawn("npx", ["vite", "preview", "--outDir", "dist-probe", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch { /* already gone */ } });
const up = await (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    try { const r = await fetch(BASE); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})();
if (!up) { server.kill(); console.error(`⛔ preview server never came up on ${BASE}`); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(perfScenarioSeed());
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-view-independent");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(3000);

if (!(await page.evaluate(() => !!window.__VPROBE__))) {
  await browser.close(); server.kill();
  console.error("⛔ window.__VPROBE__ is absent — this is not a probe build. Re-run with --build.");
  process.exit(2);
}

/* THE CONTROL: press on BARE canvas (a centre press drags an element and is not a view gesture),
 * then pan at constant px-per-foot with nothing else touched. */
const at = await page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.3, 0.7, 0.85]) for (const fx of [0.25, 0.5, 0.75, 0.12, 0.9]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    const hit = document.elementFromPoint(x, y);
    if (hit && svg.contains(hit) && !hit.closest("[data-el-id]")) return { x, y };
  }
  return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.85 };
});
const before = await page.evaluate(() => window.__plannerView.get());
await page.evaluate(() => window.__VPROBE__.begin("pan"));
await page.mouse.move(at.x, at.y);
await page.mouse.down();
for (let i = 0; i < 60; i++) await page.mouse.move(at.x + Math.sin(i / 6) * 300, at.y + Math.cos(i / 8) * 180);
await page.mouse.up();
await page.waitForTimeout(250);
const report = await page.evaluate(() => window.__VPROBE__.end());
const after = await page.evaluate(() => window.__plannerView.get());
await browser.close();
server.kill();

/* ⛔ THE CONTROL MUST HAVE HELD. If the gesture changed the zoom, this was not a pure pan and its
 * numbers mean nothing — a rung that did not take is worse than a missing one. */
const zoomDrift = Math.abs(after.ppf - before.ppf) > 1e-9;
const panned = Math.abs(after.offX - before.offX) + Math.abs(after.offY - before.offY);

const sites = classifyGesture(report.sites);
const verdict = guardVerdict(sites, REGISTRY);
const ok = verdict.ok && !zoomDrift && panned > 1;

if (JSON_OUT) {
  console.log(JSON.stringify({ ok, zoomDrift, pannedPx: panned, ...verdict }, null, 2));
} else {
  console.log(`\nVIEW-INDEPENDENT-ONCE guard (NEW-3)`);
  console.log(`  pure pan of ${Math.round(panned)} px at ppf ${before.ppf}${zoomDrift ? "  ⛔ ZOOM DRIFTED — not a pure pan" : ""}`);
  console.log(`  ${verdict.checked} of ${REGISTRY.length} registered computations observed\n`);
  if (verdict.missing.length) {
    console.log(`  ⛔ NEVER OBSERVED (renamed, removed, or no longer reached — this is a FAILURE, not a pass):`);
    for (const m of verdict.missing) console.log(`     ${m}`);
  }
  for (const f of verdict.failures) console.log(`  ⛔ ${f.key}\n       ${f.why}`);
  if (ok) console.log(`  ✅ every registered computation ran at most once across the whole gesture`);
  console.log("");
}
process.exit(ok ? 0 : 1);
