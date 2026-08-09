#!/usr/bin/env node
/* profile-pond-ring — WHICH FUNCTION is superlinear in pond ring vertices? (B227888)
 *
 * ⛔ THIS INSTRUMENT FIXES NOTHING. It answers one question that `docs/PERF-REAL-PLANS.md` §5.5
 * left open and explicitly refused to guess at: the owner's slow Bain plan costs 55,760 ms of
 * main-thread work per pan against 5,955 ms for the same plan with its two pond rings coarsened
 * to 7 points — same 52 elements, same 2 ponds, same 752 canvas nodes, same bounding boxes. 54
 * vertices are worth 89.3% of a tenfold gap, which is ~920 ms per vertex, which no per-element
 * or per-node model produces. §5.5 named WHERE (ring vertices) and deliberately did not name
 * WHAT, because this programme has had a mechanism named early and refuted three times.
 *
 * So this takes a JS SELF-TIME PROFILE of the real pan, on the real fixture, and ranks functions
 * by self time — with the SAME arms §5.5 ran (`quiddity` at full fidelity vs `simple-ponds` at 7
 * points), so the answer is a DIFFERENCE between two profiles rather than a hot list that would
 * look identical on a fast plan.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/profile-pond-ring.mjs
 *   ... --arms quiddity,simple-ponds --reps 2 --json
 *
 * ⚠ HEADED, ON A REAL X SERVER — a hidden tab starves rAF and the profile becomes a measurement
 * of the tab's visibility (the B1086 trap).
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSeed, bainPairArmFixture, paintedRasters, rasterIdbPlan, idbPutInPage } from "./lib/planFixture.mjs";
import { pngDataUrl } from "./lib/synthRaster.mjs";
import { cachedRaster } from "./lib/fixtureSeeding.mjs";
import { selfTimeByFunction, diffProfiles } from "./lib/cpuProfile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const num = (f, d) => { const v = Number(arg(f, NaN)); return Number.isFinite(v) ? v : d; };
const JSON_OUT = process.argv.includes("--json");
const DPR = num("--dpr", 2.15);
const REPS = num("--reps", 2);
const TOP = num("--top", 25);
const ARMS = String(arg("--arms", "quiddity,simple-ponds")).split(",").map((s) => s.trim()).filter(Boolean);

const QUIDDITY = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-quiddity.json"), "utf8"));
const ORIGINAL = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-concept-original.json"), "utf8"));
const SITE_ID = "annotation-arms-site";
const CACHE = join(HERE, ".raster-cache");

const PAN_PX = 260, PAN_STEPS = 20;
const PRESS_POINT = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]'); if (!svg) return null;
  const r = svg.getBoundingClientRect();
  for (const fy of [0.5, 0.28, 0.72, 0.14, 0.86]) for (const fx of [0.28, 0.72, 0.14, 0.86, 0.5]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (document.elementFromPoint(x, y) === svg) return { x: Math.round(x), y: Math.round(y) };
  } return null; })()`;

async function pan(page, press) {
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(press.x + PAN_PX, press.y + PAN_PX / 2, { steps: PAN_STEPS });
  await page.mouse.move(press.x, press.y, { steps: PAN_STEPS });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function runArm(browser, arm) {
  const fixture = bainPairArmFixture(QUIDDITY, ORIGINAL, arm);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID }));
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));

  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "profile-pond-ring");
  const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
    const r = cachedRaster(spec, CACHE);
    const wrote = await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
    if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm`);
  }
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);

  const want = paintedRasters(fixture).length;
  const got = await page.evaluate(() => [...document.querySelectorAll('[data-testid="planner-canvas"] image')]
    .filter((im) => ((im.href && im.href.baseVal) || "").length > 1000).length);
  if (got < want) throw new Error(`SHEET OVERLAY NEVER REACHED THE CANVAS (${got}/${want}) — arm "${arm}" is void`);

  const press = (await page.evaluate(PRESS_POINT)) || { x: 500, y: 450 };
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await pan(page, press);
  const { profile } = await cdp.send("Profiler.stop");
  const nodes = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    return { canvasNodes: svg.getElementsByTagName("*").length, textNodes: svg.getElementsByTagName("text").length };
  });
  await ctx.close();
  return { arm, ...nodes, self: selfTimeByFunction(profile) };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const runs = [];
for (let rep = 1; rep <= REPS; rep++) {
  for (const arm of ARMS) {
    process.stderr.write(`  · rep ${rep} arm ${arm}\n`);
    runs.push(await runArm(browser, arm));
  }
}
await browser.close();

const byArm = new Map();
for (const r of runs) {
  if (!byArm.has(r.arm)) byArm.set(r.arm, []);
  byArm.get(r.arm).push(r);
}
const merged = [...byArm.entries()].map(([arm, rs]) => ({
  arm, canvasNodes: rs[0].canvasNodes, textNodes: rs[0].textNodes,
  self: rs.map((r) => r.self), reps: rs.length,
}));

if (JSON_OUT) { console.log(JSON.stringify({ arms: ARMS, reps: REPS, merged }, null, 2)); }
else {
  console.log(`\nPOND RING SELF-TIME PROFILE — Bain pair, ${REPS} rep(s) per arm, one neutral pan each`);
  for (const m of merged) console.log(`  ${m.arm.padEnd(14)} canvas ${m.canvasNodes} nodes / ${m.textNodes} text`);
  const table = diffProfiles(merged, ARMS[0], ARMS[1]);
  console.log(`\n${"function".padEnd(52)}${ARMS[0].padStart(12)}${ARMS[1].padStart(12)}${"Δ ms".padStart(12)}`);
  for (const row of table.slice(0, TOP)) {
    console.log(row.name.slice(0, 52).padEnd(52) + row.a.toFixed(1).padStart(12) + row.b.toFixed(1).padStart(12) + row.delta.toFixed(1).padStart(12));
  }
  console.log(`\ntotal sampled self time: ${ARMS[0]} ${table.reduce((s, r) => s + r.a, 0).toFixed(0)} ms · ${ARMS[1]} ${table.reduce((s, r) => s + r.b, 0).toFixed(0)} ms`);
}
