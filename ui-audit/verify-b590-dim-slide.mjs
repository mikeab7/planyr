/* Self-verification for B590 — the building DEPTH dimension callout slides ALONG the length and
 * STAYS ON the building, never floating off and never sliding onto a corner bump-out (where the
 * printed depth would no longer be true). Proves the constraint end-to-end through the real render
 * path (lib/dimSlide → renderElPx), which uses the SAME pure clamp the drag handler does.
 *
 * Each site seeds a LEGACY-style bad dimOffset (what the old free 2-D drag could produce) and the
 * harness asserts the rendered red dimension line (#dc2626) comes out clamped:
 *   A) on-building + perpendicular LOCKED — a {x:80, y:9999} offset: the vertical depth line stays
 *      full-height and vertically centred on the footprint (y dropped to 0), sitting in the interior.
 *   B) slide clamps at the footprint EDGE — a {x:9999} offset on a plain building lands the line on
 *      the right edge, never out in space.
 *   C) stops at a BUMP-OUT — same {x:9999} offset but a 100′ top-corner dog-ear at the +end: the
 *      line stops ~100′ short of the right edge (a clear gap vs B), so 620′ stays true under it.
 *   D) orientation symmetry — a long-VERTICAL building: the horizontal line slides along Y, X locked.
 *
 * Run:  node ui-audit/verify-b590-dim-slide.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const RED = "#dc2626";

const mkSite = (id, name, els) => ({
  id, groupId: id, site: name, name: "Plan 1",
  origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: [{ x: -900, y: -700 }, { x: 900, y: -700 }, { x: 900, y: 700 }, { x: -900, y: 700 }] }],
  els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
});
// A 620′(len) × 300′(depth) building. horizLong (w>=h): the depth dim is a VERTICAL line that
// slides along X (the length). A top-corner dog-ear (side top, sign +1) eats 100′ off the +X end.
const bldg = (dimOffset, extra = []) => [
  { id: "b1", type: "building", cx: 0, cy: 0, w: 620, h: 300, rot: 0, dock: "cross", dimOffset },
  ...extra,
];
const dogEar = () => ({ id: "de1", type: "building", attachedTo: "b1", dock: "none", noFit: true, noLabel: true,
  dogEar: { side: "top", sign: 1 }, cx: 260, cy: -180, w: 100, h: 60, rot: 0 }); // w=100 → along-span 100′

const SITES = {
  "b590-lock": mkSite("b590-lock", "B590 lock", bldg({ x: 80, y: 9999 })),               // A
  "b590-edge": mkSite("b590-edge", "B590 edge", bldg({ x: 9999, y: 0 })),                 // B
  "b590-bump": mkSite("b590-bump", "B590 bump", bldg({ x: 9999, y: 0 }, [dogEar()])),     // C
  "b590-vert": mkSite("b590-vert", "B590 vert", [{ id: "b1", type: "building", cx: 0, cy: 0, w: 300, h: 620, rot: 0, dock: "cross", dimOffset: { x: 9999, y: 80 } }]), // D
};
const seedFor = (cur) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(SITES)}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(cur)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const ok = (label, cond, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? "  (" + detail + ")" : ""}`); if (!cond) fail++; };

// Footprint bbox = the largest SVG rect; red dimension lines (the dl + its ticks).
const scene = (page) => page.evaluate((red) => {
  const rects = [...document.querySelectorAll("svg rect")];
  let fp = null, area = 0;
  for (const r of rects) { const b = r.getBoundingClientRect(); if (b.width > 40 && b.height > 40 && b.width * b.height > area) { area = b.width * b.height; fp = { x: b.x, y: b.y, w: b.width, h: b.height }; } }
  const reds = [...document.querySelectorAll("svg line")]
    .filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === red)
    .map((l) => { const b = l.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; });
  return { fp, reds };
}, RED);

async function run(cur, label, orient) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(cur));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(400);
  // Zoom in until the depth dimension clears its visibility gate (ppf >= 0.18) and renders.
  const mid = { x: 720, y: 450 };
  for (let i = 0; i < 7; i++) { await page.mouse.move(mid.x, mid.y); await page.mouse.wheel(0, -300); await page.waitForTimeout(80); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + `${cur}.png` });

  console.log(`\n== ${label} ==`);
  const { fp, reds } = await scene(page);
  if (!fp || reds.length === 0) { ok(`${label}: footprint + dimension line render`, false, `fp=${!!fp} reds=${reds.length}`); await ctx.close(); return null; }
  const ppf = orient === "horiz" ? fp.w / 620 : fp.h / 620; // long axis = 620′
  // The dimension line is the longest red line on the measured axis (the dl, not a tick).
  const dl = orient === "horiz"
    ? reds.slice().sort((a, b) => b.h - a.h)[0]   // vertical line → tallest
    : reds.slice().sort((a, b) => b.w - a.w)[0];  // horizontal line → widest
  await ctx.close();
  return { fp, dl, ppf, reds };
}

// A — on-building + perpendicular lock (vertical line stays full-height + centred despite y:9999)
{
  const r = await run("b590-lock", "A · stays on the building (perpendicular locked)", "horiz");
  if (r) {
    const { fp, dl } = r;
    ok("A: depth line spans ~full footprint height (not floated off)", dl.h > fp.h * 0.8, `line ${Math.round(dl.h)}px vs fp ${Math.round(fp.h)}px`);
    ok("A: depth line is vertically centred on the footprint (y offset dropped to 0)", Math.abs(dl.cy - (fp.y + fp.h / 2)) < fp.h * 0.15, `Δcy ${Math.round(dl.cy - (fp.y + fp.h / 2))}px`);
    ok("A: line sits ON the footprint horizontally (interior, not off in space)", dl.cx > fp.x && dl.cx < fp.x + fp.w);
  }
}
// B — slide clamps at the footprint edge (x:9999 → right edge, never beyond)
let edgeGapFt = null;
{
  const r = await run("b590-edge", "B · slide clamps at the footprint edge", "horiz");
  if (r) {
    const { fp, dl, ppf } = r;
    edgeGapFt = (fp.x + fp.w - dl.cx) / ppf;
    ok("B: line clamped onto the building, not out in space", dl.cx <= fp.x + fp.w + 6 * ppf && dl.cx > fp.x);
    ok("B: line reaches ~the right (+X) edge with a huge offset", Math.abs(edgeGapFt) < 25, `gap ${edgeGapFt?.toFixed(0)}′ from edge`);
  }
}
// C — stops at the bump-out (same offset, +end dog-ear of 100′ → line stops ~100′ short)
{
  const r = await run("b590-bump", "C · stops short of a corner bump-out", "horiz");
  if (r && edgeGapFt != null) {
    const { fp, dl, ppf } = r;
    const gapFt = (fp.x + fp.w - dl.cx) / ppf;
    ok("C: line stops ~100′ short of the +X edge (off the bump, so 620′ stays true)", gapFt > 70 && gapFt < 135, `gap ${gapFt.toFixed(0)}′ (bump = 100′)`);
    ok("C: that's a clear retreat vs the no-bump case (the bump exclusion is real)", gapFt - edgeGapFt > 60, `Δ ${(gapFt - edgeGapFt).toFixed(0)}′`);
    ok("C: line still ON the building (didn't snap off)", dl.cx > fp.x && dl.cx < fp.x + fp.w);
  } else if (r) { ok("C: needs the B baseline", false); }
}
// D — orientation symmetry (long-vertical building: horizontal line slides along Y, X locked)
{
  const r = await run("b590-vert", "D · long-vertical building (horizontal line, slides along Y)", "vert");
  if (r) {
    const { fp, dl } = r;
    ok("D: depth line spans ~full footprint width (X locked → full-width, on the building)", dl.w > fp.w * 0.8, `line ${Math.round(dl.w)}px vs fp ${Math.round(fp.w)}px`);
    ok("D: line is horizontally centred (X offset dropped to 0)", Math.abs(dl.cx - (fp.x + fp.w / 2)) < fp.w * 0.15, `Δcx ${Math.round(dl.cx - (fp.x + fp.w / 2))}px`);
    ok("D: line sits ON the footprint vertically", dl.cy > fp.y && dl.cy < fp.y + fp.h);
  }
}

console.log(fail === 0 ? "\n✓ ALL B590 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
