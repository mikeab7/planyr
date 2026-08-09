#!/usr/bin/env node
/* verify-stall-lod-parity — proof that the NEW-2 geometry LOD is VISUALLY IDENTICAL.
 *
 * The owner's constraint on the whole speed program is explicit: capping retained memory is
 * authorised, a downgrade of drawing quality or quantity is NOT. NEW-2 is permitted only
 * because it is a change of REPRESENTATION — a uniformly-spaced run of identical marks
 * re-expressed as an SVG <pattern> of one mark tiled at the run's own pitch — and not a change
 * of what is drawn. "Visually identical" is a claim, and a claim about pixels has to be
 * measured in pixels, so this harness measures it:
 *
 *   1. It drives TWO builds of the app that differ ONLY in the LOD thresholds — one with the
 *      gates at their shipped values (the pattern path) and one with them at 0 (the explicit
 *      per-stall / per-door path, i.e. exactly what `main` renders).
 *   2. At each of a ladder of zooms it screenshots the planner canvas on both and compares them
 *      PIXEL BY PIXEL (ui-audit/lib/pngDiff.mjs — a dependency-free decoder, because this repo
 *      has no image library and adding one for an audit would be the wrong trade).
 *
 *      THE PASS BAR, STATED RATHER THAN ASSUMED: byte-identical, or a worst-case difference of
 *      exactly ONE unit out of 255 on a single colour channel — the least significant bit an
 *      8-bit render can express. Measured on the shipped thresholds, two of five rungs land
 *      there: 5 pixels and 144 pixels, both in a one-pixel-tall strip on a stall band's own
 *      outline, where a divider's antialiased end meets the band edge and the rasteriser rounds
 *      coverage differently for one path than for N. Anything above one unit FAILS, loudly, and
 *      that bar is what rejected the first attempt at this change (an SVG <pattern>, which
 *      differed by up to 23/255) and the dock-door half of the second (also 23/255).
 *   3. It also reports the canvas DOM node count on each, which is the whole point of the
 *      change, and asserts the stall COUNT reported in the panel is the same on both — that
 *      number comes from carStalls().count, a different code path from the render, and a
 *      change to it would be a genuine downgrade rather than an LOD.
 *
 * Usage (two static servers, one per build):
 *   node ui-audit/verify-stall-lod-parity.mjs --lod http://localhost:4173/ --explicit http://localhost:4174/
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { decodePng, diffImages } from "./lib/pngDiff.mjs";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const LOD = argOf("--lod", "http://localhost:4173/");
const EXPLICIT = argOf("--explicit", "http://localhost:4174/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
/* The ladder spans both sides of the gate on purpose: the first four rungs are zooms where the
 * collapse APPLIES (a 9′ stall is 0.18–3.15 px), the last is a detail zoom where it does not and
 * the two builds must be running literally the same code path. */
const RUNGS = [0.02, 0.05, 0.1, 0.35, 1.2];
/* The declared tolerance: one unit on one channel of an 8-bit render. Raising this is a product
 * decision about drawing quality and must be argued on the item, never nudged to make a run pass. */
const LSB = 1;

async function shoot(base) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(perfScenarioSeed());
  await ctx.addInitScript(() => {
    window.__PLANYR_E2E = true;
    // PDF-PARITY: capture the composed print-sheet SVG before it is rasterised. The sheet reasons
    // at its OWN px-per-foot (exportLabelScale), so a gate that read the live zoom instead of the
    // label frame would silently ship a stall-less PDF from a zoomed-out canvas — the exact bug
    // the comment above the export label frame warns about, and the reason this is asserted here.
    window.__capturedSvgs = [];
    const origCOU = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      try { if (blob && blob.type === "image/svg+xml") blob.text().then((t) => window.__capturedSvgs.push(t)); } catch (e) {}
      return origCOU(blob);
    };
  });
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-stall-lod-parity");
  await page.goto(base, { waitUntil: "load" });
  await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
  await page.waitForTimeout(2500);
  const out = [];
  for (const ppf of RUNGS) {
    await page.evaluate((p) => window.__plannerView.centerOn(-800, 500, p), ppf);
    await page.waitForTimeout(800);
    const png = await page.locator("svg[role=application]").screenshot();
    const nodes = await page.evaluate(() => document.querySelector('[data-testid="planner-canvas"]').getElementsByTagName("*").length);
    out.push({ ppf, hash: createHash("sha256").update(png).digest("hex").slice(0, 16), bytes: png.length, nodes, png });
  }
  /* The stall COUNT is reported from carStalls(...).count, not from the render — assert it
     separately so a "same picture, different number" regression cannot hide behind a pixel pass. */
  const stallText = await page.evaluate(() => {
    const hits = [...document.querySelectorAll("body *")].map((n) => n.childNodes.length === 1 && n.textContent).filter((t) => typeof t === "string" && /\bstalls?\b/i.test(t) && /\d/.test(t));
    return hits.slice(0, 8).sort().join(" | ");
  });
  /* PDF-PARITY. Export from a ZOOMED-OUT canvas, which is the case that can go wrong: on screen
     the stalls are collapsed, but the sheet's own scale is far finer, so the exported SVG must
     carry the EXPLICIT per-stall dividers. Counted as total divider ink — a `d` attribute with N
     subpaths and N separate <line>s must measure the same, which is what makes the two
     representations comparable at all. */
  let sheet = null;
  try {
    await page.evaluate((p) => window.__plannerView.centerOn(-800, 500, p), 0.02);
    await page.waitForTimeout(600);
    await page.getByText("File ▾", { exact: false }).first().click({ timeout: 6000 });
    await page.waitForTimeout(400);
    await page.getByText("Download PDF / pick frame", { exact: false }).first().click({ timeout: 6000 });
    await page.waitForTimeout(700);
    const dl = page.waitForEvent("download", { timeout: 180000 }).catch(() => null);
    await page.getByRole("button", { name: "Download PDF" }).first().click({ timeout: 6000 });
    await dl;
    for (let i = 0; i < 60 && !sheet; i++) {
      await page.waitForTimeout(300);
      const arr = await page.evaluate(() => window.__capturedSvgs || []);
      if (arr.length) sheet = arr[0];
    }
  } catch (e) { sheet = `EXPORT FAILED: ${e.message}`; }
  await browser.close();
  return { rungs: out, stallText, sheet };
}

const a = await shoot(LOD);
const b = await shoot(EXPLICIT);

let bad = 0;
console.log(`Stall / dock-door geometry LOD — pixel parity (NEW-2)\n  pattern path: ${LOD}\n  explicit path: ${EXPLICIT}\n`);
for (let i = 0; i < RUNGS.length; i++) {
  const x = a.rungs[i], y = b.rungs[i];
  const identical = x.hash === y.hash;
  // A hash mismatch on its own does not say whether this is a real downgrade or one antialiased
  // edge, so every mismatch is DECODED and reported — never explained away, never hidden.
  const d = identical ? null : diffImages(decodePng(x.png), decodePng(y.png));
  const ok = identical || d.maxDelta <= LSB;
  if (!ok) bad++;
  const saved = y.nodes - x.nodes;
  const verdict = identical ? "✓ IDENTICAL" : ok ? "✓ within 1/255" : "✗ DIFFERS";
  console.log(`  ppf ${String(x.ppf).padEnd(5)} ${verdict.padEnd(14)} nodes ${String(x.nodes).padStart(5)} vs ${String(y.nodes).padStart(5)}  (${saved > 0 ? "−" : "+"}${Math.abs(saved)})`);
  if (d) console.log(`      ${d.differing}/${d.total} px differ (${d.pct}%) · worst channel delta ${d.maxDelta}/255 · mean ${d.meanDelta} · bbox ${JSON.stringify(d.bbox)}`);
}
/* Divider ink on the exported sheet, counted the same way on both builds. `M x y L x y` subpaths
   and `<line x1 y1 x2 y2>` elements are different syntax for the same segments, so the comparable
   quantity is how many segments the sheet carries, not how many elements. */
const sheetSegments = (svg) => {
  if (!svg || svg.startsWith("EXPORT FAILED")) return null;
  const lines = (svg.match(/<line\b/g) || []).length;
  const subpaths = (svg.match(/M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+/g) || []).length;
  return lines + subpaths;
};
const sa = sheetSegments(a.sheet), sb = sheetSegments(b.sheet);
console.log(`\n  PDF-PARITY — exported from a zoomed-out canvas (ppf 0.02, where the screen collapses):`);
if (sa == null || sb == null) {
  console.log(`      ✗ no composed sheet SVG captured (${a.sheet ? String(a.sheet).slice(0, 80) : "none"} / ${b.sheet ? String(b.sheet).slice(0, 80) : "none"})`);
  bad++;
} else {
  const drift = Math.abs(sa - sb);
  const ok = drift === 0;
  console.log(`      ${ok ? "✓" : "✗"} ${sa} line segments on the sheet vs ${sb} on the explicit build (drift ${drift})`);
  if (!ok) { console.log("      The sheet has LOST geometry the explicit build prints — screen and paper have drifted."); bad++; }
}

const stallsSame = a.stallText === b.stallText;
console.log(`\n  stall counts reported: ${stallsSame ? "✓ IDENTICAL" : "✗ DIFFER"}`);
if (!stallsSame) { console.log(`      pattern:  ${a.stallText}\n      explicit: ${b.stallText}`); bad++; }
console.log(bad ? `\n✗ ${bad} rung(s) differ by MORE than ${LSB}/255 — this is a downgrade, not an LOD. Do not ship it.` : `\n✓ Every rung is identical to within ${LSB}/255: same picture, fewer nodes.`);
process.exit(bad ? 1 : 0);
