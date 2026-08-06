#!/usr/bin/env node
/* verify-perceptual-parity — measure a rendering change against PERCEPTUAL-PARITY (/CLAUDE.md).
 *
 * This is the sibling of verify-stall-lod-parity.mjs and it deliberately reuses that harness's
 * shape: two builds of the app that differ ONLY in the change under test, driven side by side at a
 * ladder of zooms, screenshotted and compared. What differs is the BAR. That one measured
 * byte-identity (B1345); this one measures whether the owner could SEE the difference, using
 * ui-audit/lib/perceptualDiff.mjs — CIEDE2000 on an acuity-filtered pair, at two scales.
 *
 * The owner replaced the bar on 2026-08-06 after byte-identity rejected the dock-door leaf fold
 * twice for a difference of 12-23/255 that no human sees at working zoom. It did not abandon
 * measurement; it changed what is measured. The engine (the dependency-free PNG decoder) is the
 * same one, unchanged.
 *
 * Every run prints the FULL number set, never a bare verdict, plus the viewing geometry the bar was
 * computed against — because the two numbers this sandbox cannot verify (the physical width of the
 * owner's panel and how far he sits from it) are assumptions, and an assumption you cannot see is
 * an assumption nobody can argue with.
 *
 *   node ui-audit/verify-perceptual-parity.mjs --before http://localhost:4173/ --after http://localhost:4176/
 *   ... --rungs 0.02,0.1,0.35,1.2   --shots ui-audit/screens/parity   --json
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { decodePng } from "./lib/pngDiff.mjs";
import { perceptualParity, parityLine } from "./lib/perceptualDiff.mjs";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";

const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BEFORE = argOf("--before", "http://localhost:4173/");
const AFTER = argOf("--after", "http://localhost:4176/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");
const SHOTS = argOf("--shots", null);
/* The ladder spans the gate on purpose: rungs below it are where a change is armed, rungs above it
 * are where both builds must be running literally the same code path — a control that turns "the
 * change is invisible" into "the change is invisible AND it is actually armed". */
const RUNGS = argOf("--rungs", "0.02,0.05,0.1,0.35,1.2").split(",").map(Number);

async function shoot(base, label) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(perfScenarioSeed());
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const out = [];
  try {
    await page.goto(base, { waitUntil: "load" });
    await page.waitForSelector("svg[role=application]", { timeout: 60_000 });
    await page.waitForTimeout(2500);
    for (const ppf of RUNGS) {
      // Park the viewport on an EXACT world point at an EXACT scale, so the two builds are compared
      // at the same place rather than "wheel-scroll and hope" (the __plannerView E2E hook).
      await page.evaluate((z) => window.__plannerView?.centerOn(0, 0, z), ppf);
      await page.waitForTimeout(450);
      const png = await page.locator("svg[role=application]").screenshot();
      const nodes = await page.evaluate(() => document.querySelector('[data-testid="planner-canvas"]')?.querySelectorAll("*").length ?? -1);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); writeFileSync(`${SHOTS}/${label}-ppf${ppf}.png`, png); }
      out.push({ ppf, png, nodes });
    }
  } finally { await browser.close(); }
  return out;
}

const before = await shoot(BEFORE, "before");
const after = await shoot(AFTER, "after");

const rows = before.map((b, i) => {
  const a = after[i];
  const r = perceptualParity(decodePng(b.png), decodePng(a.png));
  return { ppf: b.ppf, nodesBefore: b.nodes, nodesAfter: a.nodes, ...r };
});
const failed = rows.filter((r) => !r.pass);

if (JSON_OUT) {
  console.log(JSON.stringify({ before: BEFORE, after: AFTER, geometry: rows[0]?.geometry, bars: rows[0]?.bars, rows: rows.map(({ ...r }) => r), pass: !failed.length }, null, 2));
} else {
  console.log("\nPERCEPTUAL-PARITY");
  console.log(`  before: ${BEFORE}\n  after:  ${AFTER}`);
  const g = rows[0]?.geometry;
  if (g) console.log(`  viewing geometry: ${g.cssPxMm} mm per CSS px at ${g.viewDistanceMm} mm → one CSS px subtends ${g.arcminPerCssPx}′ · filters σ ${g.sigmaDetail} / ${g.sigmaPerceived} px`);
  console.log(`  bars: detail ΔE00 ≤ ${rows[0]?.bars.DETAIL_MAX_DE} · perceived ΔE00 ≤ ${rows[0]?.bars.PERCEIVED_MAX_DE} · perceived mean ≤ ${rows[0]?.bars.PERCEIVED_MEAN_DE}\n`);
  for (const r of rows) {
    const dn = r.nodesAfter - r.nodesBefore;
    console.log(`  ppf ${String(r.ppf).padEnd(5)} nodes ${r.nodesBefore} → ${r.nodesAfter} (${dn >= 0 ? "+" : ""}${dn})`);
    console.log(`            ${r.identical ? "byte-identical" : parityLine(r)}`);
    for (const f of r.failures) console.log(`            ⚠ ${f}`);
  }
  console.log(failed.length ? `\n  ✖ FAIL on ${failed.length} of ${rows.length} rungs` : `\n  ✓ PASS on all ${rows.length} rungs`);
}
process.exit(failed.length ? 1 : 0);
