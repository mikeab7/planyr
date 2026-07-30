/* NEW-1 / NEW-2 / NEW-3 / NEW-4 — parcel-chrome declutter, driven in a real browser.
 *
 * Reproduces the owner's 2026-07-30 report (Weld County CO, ~62.7 ac, Unincorporated, every edge
 * 25 ft): a parcel whose boundary follows a subdivision edge with a long curved run, so it
 * carries dozens of short segments. Before the fix one curved corner rendered ~12 vertex handles
 * and ~12 overlapping "25′" chips stacked into an illegible pile, the whole parcel carried 30+,
 * and the acreage badge floated off to the right of the parcel entirely.
 *
 * Logged out, no external GIS — everything here is Claude-verifiable in this sandbox.
 *
 * Checks, per the report:
 *   NEW-1  chips collapse to a handful of RUNS, none overlapping, and MORE appear on zoom-in
 *   NEW-2  handles are decimated by screen spacing (and shrunk), and MORE appear on zoom-in;
 *          an unselected parcel shows none at all
 *   NEW-3  the "Parcel 62.7 ac" badge sits INSIDE its own parcel ring
 *   NEW-4  boundary + setback ring default to indigo; the chip's border/text is near-black
 *
 * Run:  npm run build && npx vite preview --port 4178   (separate shell)
 *       BASE_URL=http://localhost:4178/ node ui-audit/verify-parcel-declutter.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4178/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

const INDIGO = "#534ab7";        // --canvas-parcel / --canvas-setback (light theme), NEW-4
const CHIP_INK = "#15171c";      // --canvas-chip-ink, NEW-4

// Arc of `n` segments — the digitized curve at the heart of the report.
const arc = (cx, cy, r, a0, sweep, n) =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = ((a0 + (sweep * k) / n) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

/* The Weld County shape: a long ~62 ac strip whose NORTH line is a 17-segment shallow curve
 * following the subdivision edge, and whose SE corner is a 90° fillet digitized as 12 short
 * segments (~7.5° of turn each — just past the ±7° tolerance the shipped side-grouping used,
 * which is precisely why that corner produced a dozen sides and a dozen stacked chips).
 * 32 vertices, every edge 25 ft. */
const weld = (() => {
  const W = 2300, H = 1180, R = 170, BULGE = 55, N = 17;
  const north = Array.from({ length: N + 1 }, (_, k) => {
    const t = k / N;
    return { x: t * W, y: -BULGE * Math.sin(Math.PI * t) };   // dense, monotonic in x
  });
  return [
    ...north,                       // (0,0) … (W,0), 17 short edges
    { x: W, y: H - R },
    ...arc(W - R, H - R, R, 0, 90, 12).slice(1, -1),
    { x: W - R, y: H },
    { x: 0, y: H },
  ];
})();

const sites = {
  weld: {
    id: "weld", groupId: "weld", site: "weld", name: "Concept A",
    origin: { lat: 40.348437, lon: -104.981121 }, county: "weld",
    parcels: [{ id: "p", points: weld, setbacks: weld.map(() => 25) }],
    els: [], measures: [], callouts: [], markups: [],
    settings: { showSetback: true, setback: 25 }, underlay: null, status: "active", updatedAt: now,
  },
};
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(sites)}));localStorage.removeItem('planarfit:currentSite:v1');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

// --- open the project + fit ---------------------------------------------------------------
await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("weld")').first().click();
await page.waitForTimeout(1400);
await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
await page.waitForTimeout(800);

const readCanvas = () => page.evaluate(() => {
  const poly = document.querySelector('polygon[data-testid="parcel-outline"]');
  const ring = poly ? poly.getAttribute("points").trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; }) : [];
  const inRing = (pt) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const chips = [...document.querySelectorAll('rect[data-testid="setback-chip"]')].map((r) => ({
    x: +r.getAttribute("x") + 13, y: +r.getAttribute("y") + 9, stroke: (r.getAttribute("stroke") || "").toLowerCase(),
  }));
  const handles = [...document.querySelectorAll('rect[data-testid="vtx-handle"]')].map((r) => ({
    x: +r.getAttribute("x") + +r.getAttribute("width") / 2, y: +r.getAttribute("y") + +r.getAttribute("height") / 2,
  }));
  // The drawn (visible) handle square is the sibling with an rx — read its size for the "too big" check.
  const drawn = document.querySelector('[data-testid="vtx-handle"]')?.nextElementSibling;
  const badgeRect = document.querySelector('[data-print-chip="acre"] [data-chip-bg]');
  const badge = badgeRect ? { x: +badgeRect.getAttribute("x") + +badgeRect.getAttribute("width") / 2,
                              y: +badgeRect.getAttribute("y") + +badgeRect.getAttribute("height") / 2 } : null;
  const badgeText = document.querySelector('[data-print-chip="acre"] [data-chip-text]')?.textContent || "";
  const chipText = [...document.querySelectorAll("text")].find((t) => /^\d+′$/.test((t.textContent || "").trim()) && t.parentElement?.querySelector('[data-testid="setback-chip"]'));
  const minGap = (pts) => {
    let m = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    return pts.length < 2 ? Infinity : m;
  };
  return {
    ringLen: ring.length,
    parcelStroke: (poly?.getAttribute("stroke") || "").toLowerCase(),
    setbackStroke: (document.querySelector('[data-testid="setback-ring"]')?.getAttribute("stroke") || "").toLowerCase(),
    chips: chips.length, chipStroke: chips[0]?.stroke || "", chipMinGap: Math.round(minGap(chips)),
    chipTextFill: (chipText?.getAttribute("fill") || "").toLowerCase(),
    handles: handles.length, handleMinGap: Math.round(minGap(handles)),
    handleDrawPx: drawn ? +drawn.getAttribute("width") : null,
    badge, badgeText, badgeInside: badge ? inRing(badge) : null,
  };
});

// Select the parcel by clicking an edge midpoint (the fat boundary hit-stroke).
// Deselect first — NEW-2's "an unselected parcel shows a clean outline" is only a real check
// if nothing is selected (opening a plan can leave the sole parcel selected).
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const before = await readCanvas();
// Ring vertices are in the canvas SVG's OWN coordinate space; the SVG sits to the right of the
// docked panel, so page coordinates need its origin added (clicking raw SVG coords lands in the
// panel and presses whatever is there).
const { verts: vertsFor, svgOrigin } = await page.evaluate(() => {
  const p = document.querySelector('polygon[data-testid="parcel-outline"]');
  if (!p) return { verts: [], svgOrigin: { x: 0, y: 0 } };
  const r = p.ownerSVGElement.getBoundingClientRect();
  return {
    verts: p.getAttribute("points").trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; }),
    svgOrigin: { x: r.left, y: r.top },
  };
});
ok("parcel renders (32-edge Weld County boundary)", vertsFor.length >= 30, `${vertsFor.length} vertices`);

// NEW-2: an UNSELECTED parcel shows a clean outline — no handles at all.
ok("NEW-2 · an unselected parcel draws NO vertex handles (clean outline)", before.handles === 0, `${before.handles} handles`);

// NEW-3: the acreage badge sits inside its own parcel, before anything is selected.
await page.screenshot({ path: OUT + "parcel-declutter-unselected.png" });
ok(`NEW-3 · the "${before.badgeText}" badge sits INSIDE its own parcel`, before.badgeInside === true,
   before.badge ? `badge at ${Math.round(before.badge.x)},${Math.round(before.badge.y)}` : "no badge");

// NEW-4: the boundary + setback ring default to indigo.
ok("NEW-4 · parcel outline defaults to indigo", before.parcelStroke === INDIGO, before.parcelStroke);
ok("NEW-4 · setback ring defaults to indigo", before.setbackStroke === INDIGO, before.setbackStroke);

for (let e = 0; e < vertsFor.length; e++) {
  const a = vertsFor[e], b = vertsFor[(e + 1) % vertsFor.length];
  const mid = { x: svgOrigin.x + (a.x + b.x) / 2, y: svgOrigin.y + (a.y + b.y) / 2 };
  if (mid.y < 120 || mid.y > 860 || mid.x < svgOrigin.x + 8 || mid.x > 1420) continue;
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(350);
  if ((await readCanvas()).chips > 0) break;
}
const fit = await readCanvas();
await page.screenshot({ path: OUT + "parcel-declutter-fit.png" });
console.log(`  · at fit: ${fit.chips} chips, ${fit.handles} handles of ${fit.ringLen} vertices`);

// --- NEW-1: chips ---------------------------------------------------------------------------
ok("NEW-1 · chips collapse to a handful of runs (was one per edge)", fit.chips > 0 && fit.chips <= 8,
   `${fit.chips} chips for ${fit.ringLen} edges`);
ok("NEW-1 · no two drawn chips overlap", fit.chipMinGap >= 40, `closest pair ${fit.chipMinGap}px`);

// --- NEW-2: handles -------------------------------------------------------------------------
ok("NEW-2 · handles are decimated by screen spacing", fit.handles > 0 && fit.handles < fit.ringLen * 0.75,
   `${fit.handles} of ${fit.ringLen}`);
ok("NEW-2 · no two drawn handles are closer than the spacing threshold", fit.handleMinGap >= 22, `closest pair ${fit.handleMinGap}px`);
ok("NEW-2 · the handle mark itself is smaller than the old 10px square", fit.handleDrawPx != null && fit.handleDrawPx <= 8, `${fit.handleDrawPx}px`);

// --- NEW-4: chip ink ------------------------------------------------------------------------
ok("NEW-4 · the setback chip's border is near-black, not the band's colour", fit.chipStroke === CHIP_INK, fit.chipStroke);
ok("NEW-4 · the setback chip's numerals are near-black too", fit.chipTextFill === CHIP_INK, fit.chipTextFill);

// --- progressive reveal: zoom into the curved corner -----------------------------------------
// Wheel-zoom hard over the NE fillet, then re-read: more detail must appear, not less.
// The FILLETED corner (max x+y) — the exact spot in the owner's second screenshot.
const c0 = vertsFor.reduce((best, p) => (p.x + p.y > best.x + best.y ? p : best), vertsFor[0]);
const corner = { x: svgOrigin.x + c0.x, y: Math.max(140, svgOrigin.y + c0.y) };
for (let i = 0; i < 14; i++) { await page.mouse.move(corner.x, corner.y); await page.mouse.wheel(0, -240); await page.waitForTimeout(90); }
await page.waitForTimeout(600);
const zoomed = await readCanvas();
await page.screenshot({ path: OUT + "parcel-declutter-corner-zoomed.png" });
console.log(`  · zoomed on the corner: ${zoomed.chips} chips, ${zoomed.handles} handles`);
ok("NEW-1/NEW-2 · zooming in REVEALS more detail (chips or handles increase)",
   zoomed.handles > fit.handles || zoomed.chips > fit.chips,
   `handles ${fit.handles}→${zoomed.handles}, chips ${fit.chips}→${zoomed.chips}`);
ok("NEW-1 · chips still never overlap when zoomed in", zoomed.chips < 2 || zoomed.chipMinGap >= 40, `closest pair ${zoomed.chipMinGap}px`);
ok("NEW-2 · handles still never crowd when zoomed in", zoomed.handles < 2 || zoomed.handleMinGap >= 22, `closest pair ${zoomed.handleMinGap}px`);

ok("no JS errors during the whole run", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed  ·  screenshots in ui-audit/screens/`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.n).join("; ")); process.exit(1); }
console.log("ALL PASS");
