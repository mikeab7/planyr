#!/usr/bin/env node
/* diagnose-dock-leaf-fold — can the dock-door leaves reach the SAME pixel bar the stall stripes did?
 * (B1350, retried under NEW-4 of the speed program's phase 3)
 *
 * THE HISTORY, because this is the SECOND attempt and the third must not happen blind.
 * B1345 collapsed 1,550 stall-divider nodes into one <path> per band and proved it BYTE-IDENTICAL.
 * The identical fold applied to the dock-door leaves was measured at up to 23/255 on 0.02–0.41% of
 * canvas pixels and REJECTED — 424 nodes left on the table knowingly, because the owner's
 * constraint on this whole program is that a downgrade of drawing quality is not authorised.
 * The stated cause was a leaf's SEMI-TRANSPARENT fill (fillOpacity 0.95).
 *
 * WHAT THIS INSTRUMENT ADDS. The rejection was measured on two BUILDS, which is slow, and it
 * produced one verdict per zoom rung with no mechanism attached. This measures the same fold as a
 * page-side mutation on ONE build — so it can sweep rungs cheaply — and it reports, next to each
 * delta, the geometry that explains it: the leaf's own width in device pixels, the gap between
 * neighbouring leaves, and the stroke that straddles their edges. The question it exists to settle
 * is not "does it differ" (that is known) but "IS THERE A ZOOM BAND WHERE IT CANNOT", i.e. where
 * neighbouring leaves provably share no pixel and the transparency therefore cannot bite.
 *
 * ⚠ WHAT A PAGE-SIDE MUTATION IS AND IS NOT. It is the honest A/B of the RENDER: the same nodes,
 * same paint order, same rasteriser, one build. It is NOT a proof that a shipped gate behaves this
 * way — that still requires ui-audit/verify-stall-lod-parity.mjs against two real builds, which is
 * the instrument of record and the one that rejected this last time.
 *
 *   node ui-audit/diagnose-dock-leaf-fold.mjs
 *   node ui-audit/diagnose-dock-leaf-fold.mjs --json
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { decodePng, diffImages } from "./lib/pngDiff.mjs";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
/* The same ladder verify-stall-lod-parity.mjs uses, so a number here and a number there describe
 * the same zooms, plus two finer rungs: the whole question is where the fold stops differing. */
const RUNGS = [0.02, 0.05, 0.1, 0.35, 1.2, 3];
const LSB = 1;   // the declared bar: byte-identical, or one unit of 255 on one channel

/* THREE RENDERINGS OF THE SAME 432 LEAVES, so the difference can be ATTRIBUTED rather than
 * asserted. B1350 measured only the first against the third and named transparency as the cause;
 * with the middle arm in place that claim is testable, because it separates two things that were
 * being read as one:
 *
 *   A  rects      — what ships: N <rect> elements, fill-opacity 0.95, 0.6 px stroke
 *   B  perleaf    — N <path> elements, ONE rectangle subpath each: same count, same compositing,
 *                   same opacity — the ONLY change is <rect> → <path>
 *   C  fold       — ONE <path> with N rectangle subpaths: the collapse itself
 *
 * A→B isolates the RASTERISER (does Chromium draw a rect the same way it draws a rectangular
 * path?). B→C isolates the FOLD (does merging N shapes into one element change the picture — the
 * transparency-overlap claim). A→C is what B1350 measured and rejected. If B→C is clean and A→B is
 * not, the recorded cause is wrong and no amount of work on the fold can ever help.
 */
/* ABSOLUTE commands, deliberately. A relative form (`h w v h h -w z`) accumulates in the
 * rasteriser's own arithmetic and can shift an edge by a fraction of a pixel, which would show up
 * as a few units of antialiasing difference and be indistinguishable from the effect under test.
 * Every coordinate here is computed in the same doubles the <rect> attributes already carry. */
const RECT_SUBPATH = `(r) => { const x=+r.getAttribute("x"), y=+r.getAttribute("y"), w=+r.getAttribute("width"), h=+r.getAttribute("height"); return \`M\${x} \${y}L\${x + w} \${y}L\${x + w} \${y + h}L\${x} \${y + h}Z\`; }`;

const REPLACE = (mode) => new Function("mode", `
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const sub = ${RECT_SUBPATH};
  const leaves = [...svg.querySelectorAll('rect[fill="#c2c9d2"]')];
  const runs = [];
  for (const el of leaves) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].nextElementSibling === el) last.push(el);
    else runs.push([el]);
  }
  const carry = (from, to) => { for (const a of ["fill", "fill-opacity", "stroke", "stroke-width"]) { const v = from.getAttribute(a); if (v != null) to.setAttribute(a, v); } };
  const undo = [];
  for (const run of runs) {
    const groups = mode === "fold" ? [run] : run.map((r) => [r]);
    const made = [];
    for (const g of groups) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", g.map(sub).join(""));
      carry(g[0], path);
      g[0].parentNode.insertBefore(path, g[0]);
      made.push(path);
    }
    for (const r of run) r.remove();
    undo.push({ made, run });
  }
  window.__foldUndo = undo;
  return { runs: runs.length, leaves: leaves.length, nodesMade: undo.reduce((n, u) => n + u.made.length, 0) };
`);

const UNFOLD = () => {
  for (const { made, run } of window.__foldUndo || []) {
    for (const r of run) made[0].parentNode.insertBefore(r, made[0]);
    for (const p of made) p.remove();
  }
  window.__foldUndo = null;
};

/* THE DECISIVE CONTROL (NEW-4). B1350 recorded the cause as the leaf's SEMI-TRANSPARENT fill, so
 * the way to settle it is to take the transparency away from BOTH arms and fold again. If an
 * opaque fold still differs, opacity is exonerated and the recorded cause is wrong. */
const SET_OPAQUE = () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  window.__opaqueUndo = [...svg.querySelectorAll('rect[fill="#c2c9d2"]')].map((r) => {
    const prev = r.getAttribute("fill-opacity");
    r.setAttribute("fill-opacity", "1");
    return { r, prev };
  });
  return window.__opaqueUndo.length;
};
const UNSET_OPAQUE = () => {
  for (const { r, prev } of window.__opaqueUndo || []) { if (prev == null) r.removeAttribute("fill-opacity"); else r.setAttribute("fill-opacity", prev); }
  window.__opaqueUndo = null;
};

/* The geometry that decides whether the fold CAN be exact: two leaves that share no device pixel
 * cannot composite differently, whatever their opacity. Measured off the live DOM, never assumed
 * from the settings — a reshaped building's doors ride a shortened wall span. */
const GEOMETRY = () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const leaves = [...svg.querySelectorAll('rect[fill="#c2c9d2"]')];
  if (!leaves.length) return null;
  const sw = +(leaves[0].getAttribute("stroke-width") || 0);
  const horiz = +leaves[0].getAttribute("width") < +leaves[0].getAttribute("height");
  const wide = leaves.map((r) => Math.min(+r.getAttribute("width"), +r.getAttribute("height")));
  const along = leaves.map((r) => (horiz ? +r.getAttribute("x") : +r.getAttribute("y"))).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < along.length; i++) {
    const g = along[i] - along[i - 1] - wide[i - 1];
    if (g >= 0 && g < 1e4) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  return {
    count: leaves.length,
    leafPx: +Math.min(...wide).toFixed(3),
    strokePx: sw,
    minGapPx: gaps.length ? +gaps[0].toFixed(3) : null,
    medianGapPx: gaps.length ? +gaps[Math.floor(gaps.length / 2)].toFixed(3) : null,
    // Two leaves cannot share a pixel when the clear gap exceeds the stroke that straddles both
    // edges plus one pixel of antialiasing reach.
    disjoint: gaps.length ? gaps[0] > sw + 1 : true,
  };
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(perfScenarioSeed());
// The zoom ladder is driven through the planner's own `window.__plannerView` probe, which is gated
// behind this flag (it never exists in a normal session) — the same gate the parity verifier uses.
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "diagnose-dock-leaf-fold");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
await page.waitForTimeout(2500);

const shot = () => page.locator("svg[role=application]").screenshot();
const nodeCount = () => page.evaluate(() => document.querySelector('[data-testid="planner-canvas"]').getElementsByTagName("*").length);
const hashOf = (png) => createHash("sha256").update(png).digest("hex").slice(0, 16);
const compare = (x, y) => (hashOf(x.png) === hashOf(y.png) ? null : diffImages(decodePng(x.png), decodePng(y.png)));

const rows = [];
for (const ppf of RUNGS) {
  await page.evaluate((p) => window.__plannerView.centerOn(-800, 500, p), ppf);
  await page.waitForTimeout(700);
  const geom = await page.evaluate(GEOMETRY);
  const A = { png: await shot(), nodes: await nodeCount() };
  const perleafInfo = await page.evaluate(REPLACE("perleaf"), "perleaf");
  await page.waitForTimeout(150);
  const B = { png: await shot(), nodes: await nodeCount() };
  await page.evaluate(UNFOLD);
  const foldInfo = await page.evaluate(REPLACE("fold"), "fold");
  await page.waitForTimeout(150);
  const C = { png: await shot(), nodes: await nodeCount() };
  await page.evaluate(UNFOLD);
  await page.evaluate(SET_OPAQUE);
  await page.waitForTimeout(120);
  const D = { png: await shot() };
  await page.evaluate(REPLACE("fold"), "fold");
  await page.waitForTimeout(120);
  const E = { png: await shot() };
  await page.evaluate(UNFOLD);
  await page.evaluate(UNSET_OPAQUE);
  rows.push({
    opaqueFold: compare(D, E),
    ppf, geom, leaves: foldInfo.leaves, runs: foldInfo.runs,
    nodes: { rects: A.nodes, perleaf: B.nodes, fold: C.nodes },
    rectToPath: compare(A, B),      // A→B: the rasteriser
    pathToFold: compare(B, C),      // B→C: the fold itself
    rectToFold: compare(A, C),      // A→C: what B1350 measured
    perleafNodes: perleafInfo.nodesMade,
  });
}
await browser.close();

const verdict = (d) => (d === null ? "IDENTICAL" : d.maxDelta <= LSB ? `within ${LSB}/255` : `DIFFERS ${d.maxDelta}/255`);
const detail = (d) => (d === null ? "byte-identical" : `${d.differing} px (${d.pct}%) · worst ${d.maxDelta}/255 · mean ${d.meanDelta}`);

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, rungs: rows }, null, 2)); process.exit(0); }

console.log(`Dock-door leaf fold — pixel parity, ATTRIBUTED (B1350 retry, NEW-4)\n  target: ${BASE}  ·  bar: byte-identical, or ${LSB}/255 on one channel\n`);
for (const r of rows) {
  const g = r.geom;
  console.log(`  ppf ${String(r.ppf).padEnd(5)} ${r.leaves} leaves in ${r.runs} runs · nodes ${r.nodes.rects} → ${r.nodes.fold} (−${r.nodes.rects - r.nodes.fold})`);
  if (g) console.log(`             leaf ${g.leafPx} px wide · stroke ${g.strokePx} px · clear gap min ${g.minGapPx} px → neighbours ${g.disjoint ? "CANNOT share a pixel" : "SHARE pixels"}`);
  console.log(`             A→B  <rect> → N <path>   ${verdict(r.rectToPath).padEnd(16)} ${detail(r.rectToPath)}`);
  console.log(`             B→C  N <path> → 1 <path> ${verdict(r.pathToFold).padEnd(16)} ${detail(r.pathToFold)}`);
  console.log(`             A→C  the shipped fold    ${verdict(r.rectToFold).padEnd(16)} ${detail(r.rectToFold)}`);
  console.log(`             D→E  the SAME fold, both arms fully OPAQUE  ${verdict(r.opaqueFold).padEnd(16)} ${detail(r.opaqueFold)}`);
}
const ok = (d) => d === null || d.maxDelta <= LSB;
const foldClean = rows.filter((r) => ok(r.pathToFold)).length;
const rasterClean = rows.filter((r) => ok(r.rectToPath)).length;
console.log(`\n  THE FOLD ITSELF (path → one path) meets the bar on ${foldClean}/${rows.length} rungs.`);
console.log(`  THE <rect> → <path> CONVERSION meets it on ${rasterClean}/${rows.length}.`);
const opaqueClean = rows.filter((r) => ok(r.opaqueFold)).length;
console.log(`  WITH THE TRANSPARENCY REMOVED from both arms it meets it on ${opaqueClean}/${rows.length}.`);
console.log(`  Whichever of those is dirty is the real blocker; the other is innocent, whatever the combined A→C says.`);
