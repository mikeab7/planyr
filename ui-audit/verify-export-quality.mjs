/* Verifies the export-quality fixes (NEW-1/NEW-2/NEW-3, 2026-06-29) END-TO-END through
 * the REAL app: it seeds a located site with a parcel + building, drives File ▾ → Download
 * PDF → Download PDF, and captures the actual composed sheet SVG that exportPDF() builds
 * (by hooking URL.createObjectURL). From that real sheet it MEASURES, in inches on the page:
 *   NEW-1  the north-arrow + scale-bar PLATES are modest (~0.4–0.55 in, not the old ~0.75–0.9)
 *          and neither plate overlaps a building footprint (no-occlude corner placement).
 *   NEW-2  the building object line is thinned to a physical drafting weight (~0.6 pt), well
 *          below its authored 2 px, and far below what the old (un-thinned) clone baked in.
 *   NEW-3  the dark "X ac" acreage pill is gone (no data-chip-bg / dark pill fill) and the
 *          chip text is restyled to dark exhibit ink with a white halo; the building
 *          drop-shadow filter is dropped on paper.
 *
 * Runs logged-out against the built app (vite preview on :4173).
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const parcel = { id: "pc1", locked: false, active: true, points: [{ x: -460, y: -200 }, { x: 460, y: -200 }, { x: 460, y: 320 }, { x: -460, y: 320 }] };
const els = [
  { id: "b1", type: "building", cx: 0, cy: 20, w: 520, h: 300, rot: 0, dock: "single" },
];
const demoSite = {
  id: "exq-demo", groupId: "exq-demo", site: "Export Quality Demo", name: "Concept A",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

// Hook URL.createObjectURL so we keep a copy of every image/svg+xml blob's text — the
// composed print sheet is one of them, captured before it's rasterized.
const hook = `(() => { window.__svgs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => { try { if (obj && obj.type === 'image/svg+xml') obj.text().then((t) => window.__svgs.push(t)); } catch (e) {} return orig(obj); };
})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
await ctx.addInitScript(hook);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch {}
await page.waitForTimeout(700);

// File ▾ → Download PDF / pick frame… → (print frame UI) → Download PDF
await page.locator('button:has-text("File ▾")').first().click();
await page.waitForTimeout(250);
await page.locator('button:has-text("Download PDF / pick frame")').first().click();
await page.waitForTimeout(600);
await page.locator('button:has-text("Download PDF")').last().click();
await page.waitForTimeout(2500);

const sheet = await page.evaluate(() => (window.__svgs || []).find((s) => s.includes('data-furniture')) || null);
if (!sheet) { console.log("FAIL ❌ — never captured the composed sheet SVG"); console.log("errors:", errors); await browser.close(); process.exit(1); }

// Measure the real sheet geometry in the page (DOMParser handles nested SVG attrs).
const M = await page.evaluate((svg) => {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const out = { ok: true };
  const outer = doc.documentElement;
  const owv = outer.getAttribute("viewBox").split(/\s+/).map(Number); // 0 0 PW PH
  const wIn = parseFloat(outer.getAttribute("width")); // e.g. 11 (in)
  const inPerUnit = wIn / owv[2]; // sheet inches per outer unit (centi-inch → 0.01)
  // the nested plan <svg> = the inner svg that contains the furniture
  const furn = doc.querySelector('[data-furniture]');
  let plan = furn; while (plan && plan.tagName.toLowerCase() !== "svg") plan = plan.parentNode;
  const pw = parseFloat(plan.getAttribute("width")), ph = parseFloat(plan.getAttribute("height"));
  const pvb = plan.getAttribute("viewBox").split(/\s+/).map(Number); // x0 y0 w h (plan units)
  const unitToCi = Math.min(pw / pvb[2], ph / pvb[3]); // plan-units → outer units (meet)
  const unitToIn = unitToCi * inPerUnit; // plan units → inches on the page

  // Furniture plates: two translate groups inside [data-furniture]; first <rect> child = plate.
  const groups = [...furn.querySelectorAll(":scope > g")];
  const plateBoxes = [];
  let northPlateInchH = null, barPlateInchH = null;
  for (const g of groups) {
    const tr = (g.getAttribute("transform") || "").match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    const tx = tr ? parseFloat(tr[1]) : 0, ty = tr ? parseFloat(tr[2]) : 0;
    const rect = g.querySelector("rect");
    const bw = parseFloat(rect.getAttribute("width")), bh = parseFloat(rect.getAttribute("height"));
    plateBoxes.push({ x: tx, y: ty, w: bw, h: bh });
    const isNorth = g.innerHTML.includes(">N<");
    if (isNorth) northPlateInchH = bh * unitToIn; else barPlateInchH = bh * unitToIn;
  }

  // Building footprint rects (fill token #f3ece1), in plan units → bbox.
  const bldgBoxes = [];
  let buildingStrokeUnits = null;
  for (const r of doc.querySelectorAll("rect")) {
    const fill = (r.getAttribute("fill") || "").toLowerCase();
    if (fill !== "#f3ece1") continue;
    const x = parseFloat(r.getAttribute("x")), y = parseFloat(r.getAttribute("y"));
    const w = parseFloat(r.getAttribute("width")), h = parseFloat(r.getAttribute("height"));
    bldgBoxes.push({ x, y, w, h });
    const sw = parseFloat(r.getAttribute("stroke-width"));
    if (Number.isFinite(sw)) buildingStrokeUnits = sw;
  }
  // building stroke printed point weight = units × unitToIn × 72
  out.buildingStrokePt = buildingStrokeUnits != null ? buildingStrokeUnits * unitToIn * 72 : null;
  out.buildingStrokeUnits = buildingStrokeUnits;

  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  let furnitureOverlap = 0;
  for (const p of plateBoxes) for (const b of bldgBoxes) furnitureOverlap += overlap(p, b);

  out.northPlateInchH = northPlateInchH;
  out.barPlateInchH = barPlateInchH;
  out.furnitureOverlap = furnitureOverlap;
  out.nBuildings = bldgBoxes.length;
  // NEW-3 markers
  out.hasDarkPill = /rgba\(17,\s*24,\s*39/.test(svg);
  out.hasChipBg = /data-chip-bg/.test(svg);
  const chipText = doc.querySelector("[data-chip-text]");
  out.chipTextFill = chipText ? (chipText.getAttribute("fill") || "") : "(no chip)";
  out.chipTextHalo = chipText ? (chipText.getAttribute("stroke") || "") : "";
  out.hasShadowFilter = /filter="url\(#bldgShadow\)"/.test(svg);
  return out;
}, sheet);

// ---- assertions -----------------------------------------------------------
const checks = [
  ["captured a building footprint in the sheet", M.nBuildings >= 1],
  ["north-arrow plate is modest (≤ 0.6 in tall)", M.northPlateInchH != null && M.northPlateInchH <= 0.6],
  ["scale-bar plate is modest (≤ 0.6 in tall)", M.barPlateInchH != null && M.barPlateInchH <= 0.6],
  ["furniture does NOT overlap any building (no-occlude)", M.furnitureOverlap === 0],
  ["building line thinned below authored 2 px", M.buildingStrokeUnits != null && M.buildingStrokeUnits < 2],
  ["building line prints at a drafting weight (0.45–0.9 pt)", M.buildingStrokePt != null && M.buildingStrokePt >= 0.45 && M.buildingStrokePt <= 0.9],
  ["no dark acreage pill on paper (NEW-3)", M.hasDarkPill === false && M.hasChipBg === false],
  // chip text must be dark exhibit ink (low luminance), not the light-on-pill #e9edf2, + a white halo
  ["chip text restyled to dark ink + white halo", (() => {
    const m = /^#([0-9a-f]{6})$/i.exec(M.chipTextFill || "");
    if (!m) return false;
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum < 0.35 && /#ffffff/i.test(M.chipTextHalo);
  })()],
  ["building drop-shadow dropped on paper", M.hasShadowFilter === false],
  ["no console/page errors", errors.length === 0],
];

console.log("\n=== Export quality measurements (real sheet) ===");
console.log(`  north plate:   ${M.northPlateInchH?.toFixed(3)} in`);
console.log(`  scalebar plate:${M.barPlateInchH?.toFixed(3)} in`);
console.log(`  furniture↔building overlap: ${M.furnitureOverlap.toFixed(1)} (units²; want 0)`);
console.log(`  building stroke: ${M.buildingStrokeUnits?.toFixed(3)} units → ${M.buildingStrokePt?.toFixed(2)} pt on paper`);
console.log(`  chip: darkPill=${M.hasDarkPill} chipBg=${M.hasChipBg} textFill=${M.chipTextFill} halo=${M.chipTextHalo}`);
console.log(`  building shadow filter present: ${M.hasShadowFilter}`);
console.log("\n=== Checks ===");
let pass = true;
for (const [label, ok] of checks) { console.log(`  ${ok ? "✅" : "❌"} ${label}`); pass = pass && ok; }
if (errors.length) console.log("errors:", errors);

await browser.close();
console.log(`\n${pass ? "ALL PASS ✅" : "SOME CHECKS FAILED ❌"}`);
process.exit(pass ? 0 : 1);
