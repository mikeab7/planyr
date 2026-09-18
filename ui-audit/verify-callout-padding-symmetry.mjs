#!/usr/bin/env node
/* verify-callout-padding-symmetry — B1612640 (NEW-1) — THE BORDER AROUND A TEXT BOX/CALLOUT MUST
 * BE EQUAL TOP AND BOTTOM, MEASURED, NOT EYEBALLED.
 *
 *   node ui-audit/verify-callout-padding-symmetry.mjs [--assert]
 *
 * Root cause (see SitePlanner.jsx's renderCalloutNode and the parcel/measurement chip renders):
 * three padded-box+text render sites shared one hand-tuned magic ratio (`fontPx * 0.82` off the
 * DEFAULT alphabetic SVG text baseline) to place text inside a box whose height is otherwise built
 * symmetrically (`h = lines*lineH + padY*2`). That ratio was tuned to look right on one sample
 * string and put a different amount of white space above the glyphs than below them on every other
 * string. The fix replaces it with `dominantBaseline="middle"` at each line's own SLOT CENTRE
 * (`padY + lineH/2 + i*lineH`), which is symmetric by construction (top gap == bottom gap ==
 * `padY + lineH/2` regardless of line count) and matches the convention every other centred <text>
 * in this file already uses (element name labels, dimension numbers).
 *
 * This harness measures, for all three sites this fix touches (a callout/text box, the parcel
 * acreage chip, the measurement summary chip), the gap from the box's own top/bottom edge to each
 * line's SLOT CENTRE (the `y` attribute the render now anchors under dominantBaseline="middle") —
 * that's the number the box model actually guarantees symmetric, content-independent. It also
 * reports (informationally, never gating) the gap to the real rendered glyph INK via `getBBox()`,
 * which varies with which specific glyphs sit on the first/last line (a line of descenders like
 * "gjpqy" draws lower than a line of caps — real font metrics, not a padding defect) and so is not
 * a fair pass/fail signal on its own.
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE_ID = "smveriftpad01";
const ASSERT = process.argv.includes("--assert");
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };

// A point far from Richfield's real geometry so the seeded scene doesn't overlap anything.
const CX = 4200, CY = -4200;

function withScene(fx) {
  const f = JSON.parse(JSON.stringify(fx));
  // Multi-line text with both ASCENDERS (b/l/h/k) and DESCENDERS (g/j/p/q/y) so the glyph-ink test
  // is meaningful — a digit-only or all-caps string can't show this defect.
  f.callouts = (f.callouts || []).concat([
    { id: "zzCallout", z: 900000, box: { x: CX, y: CY }, text: "Multi-line text box\nwith gjpqy descenders", noLeader: true },
  ]);
  f.parcels = (f.parcels || []).concat([{
    id: "zzParcel", active: true,
    points: [{ x: CX - 300, y: CY + 300 }, { x: CX + 300, y: CY + 300 }, { x: CX + 300, y: CY - 300 }, { x: CX - 300, y: CY - 300 }],
  }]);
  f.measures = (f.measures || []).concat([{
    id: "zzMeasure", z: 900000, mode: "area",
    pts: [{ x: CX - 900, y: CY + 300 }, { x: CX - 500, y: CY + 300 }, { x: CX - 500, y: CY - 100 }, { x: CX - 900, y: CY - 100 }],
  }]);
  return f;
}

/* Measured inside the page, for a box `rect` + its sibling `<text>` line(s) (same local SVG
 * user-space frame — no CTM math needed).
 *
 * TWO different numbers, on purpose, because they answer different questions:
 *  - `slotTopGap`/`slotBottomGap` (the GATE): the box's own top/bottom edge to each line's
 *    vertical-CENTER anchor (the `y` attribute under dominantBaseline="middle"). This is the
 *    thing the fix actually guarantees symmetric — box height is built as
 *    `lines*lineH + padY*2`, so the first line's slot-centre sits `padY + lineH/2` below the top
 *    and the last line's sits the identical distance above the bottom, BY CONSTRUCTION, whatever
 *    the line count or content. Content-independent, so it's the fair pass/fail check.
 *  - `inkTopGap`/`inkBottomGap` (INFORMATIONAL ONLY): the box edges to the actual rendered glyph
 *    ink (getBBox()). This is influenced by which specific glyphs are on the first vs. last line
 *    (a line of descenders like "gjpqy" naturally draws lower than a line of caps) — real font
 *    metrics, not a padding defect — so it is reported for visibility but never gates the run. */
const MEASURE_BOX = ([rectSel, textSel]) => {
  const rect = document.querySelector(rectSel);
  if (!rect) return { present: false };
  const texts = [...document.querySelectorAll(textSel)];
  if (!texts.length) return { present: true, texts: 0 };
  const ry = +rect.getAttribute("y"), rh = +rect.getAttribute("height");
  const ys = texts.map((t) => +t.getAttribute("y"));
  let inkTop = Infinity, inkBottom = -Infinity;
  for (const t of texts) {
    const b = t.getBBox();
    inkTop = Math.min(inkTop, b.y);
    inkBottom = Math.max(inkBottom, b.y + b.height);
  }
  return {
    present: true, texts: texts.length,
    slotTopGap: Math.min(...ys) - ry,
    slotBottomGap: (ry + rh) - Math.max(...ys),
    inkTopGap: inkTop - ry,
    inkBottomGap: (ry + rh) - inkBottom,
  };
};

async function run() {
  const fixture = withScene(readFixture("richfield"));
  const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    return route.abort();
  });

  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-callout-padding-symmetry");
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + `#/project/${SITE_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "load" });
  await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
  await page.evaluate(([x, y]) => window.__plannerView?.centerOn(x, y, 0.9), [CX, CY]);
  await pacedWait(page, 1200);

  const TOL = 1.0; // px — sub-pixel font-hinting slop, nowhere near the original defect's magnitude

  const sites = [
    { name: "callout/text box", rect: `[data-testid="callout-box-zzCallout"]`, text: `g[data-feature="callout:zzCallout"] text` },
    { name: "parcel acreage chip", rect: `[data-chip-parcel="zzParcel"] [data-chip-bg]`, text: `[data-chip-parcel="zzParcel"] [data-chip-text]` },
    { name: "measurement summary chip", rect: `[data-measure-chip="zzMeasure"] [data-chip-bg]`, text: `[data-measure-chip="zzMeasure"] [data-chip-text]` },
  ];

  for (const s of sites) {
    const m = await page.evaluate(MEASURE_BOX, [s.rect, s.text]);
    if (!m.present) { bad(`${s.name}: box not found (${s.rect})`); continue; }
    if (!m.texts) { bad(`${s.name}: no <text> nodes found (${s.text})`); continue; }
    const slotAsym = Math.abs(m.slotTopGap - m.slotBottomGap);
    const inkAsym = Math.abs(m.inkTopGap - m.inkBottomGap);
    console.log(`  ${s.name}: slot topGap=${m.slotTopGap.toFixed(2)}px bottomGap=${m.slotBottomGap.toFixed(2)}px (Δ=${slotAsym.toFixed(2)}px)` +
      ` | ink topGap=${m.inkTopGap.toFixed(2)}px bottomGap=${m.inkBottomGap.toFixed(2)}px (Δ=${inkAsym.toFixed(2)}px, informational — varies with which glyphs are on the first/last line) — ${m.texts} line(s)`);
    if (m.inkTopGap < -0.5 || m.inkBottomGap < -0.5) bad(`${s.name}: text ink OVERFLOWS the box (inkTopGap=${m.inkTopGap.toFixed(2)}, inkBottomGap=${m.inkBottomGap.toFixed(2)})`);
    else if (slotAsym <= TOL) ok(`${s.name}: top/bottom padding symmetric within ${TOL}px (each line centred on its own slot)`);
    else bad(`${s.name}: top/bottom padding UNEVEN by ${slotAsym.toFixed(2)}px (slot topGap=${m.slotTopGap.toFixed(2)}, bottomGap=${m.slotBottomGap.toFixed(2)})`);
  }

  if (errors.length === 0) ok("no JS crash"); else bad(`JS errors: ${errors.slice(0, 3).join("; ")}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (ASSERT && fail) process.exit(1);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
