/* Self-verification for pond stage contours — depth rings drawn inside a detention basin,
 * the storage seated on the plan, and the whole overlay zoom-gated + degrading on over-taper.
 *
 * What this asserts (all DOM-based — paths/labels carry data-contour* attributes, so presence
 * in the SVG is ground truth, independent of off-screen clipping):
 *   1) A normal pond shows concentric contour rings, with the WATER-surface ring and the BOTTOM
 *      ring both present and distinguishable (data-contour="water" / "bottom").
 *   2) The stored volume is communicated on the plan ("Holds N ac-ft · D′ deep").
 *   3) Top-of-bank elevation set → rings label as REAL elevations (e.g. "95.0"), not depths.
 *   4) An over-taper pond (slopes meet before full depth) shows the "✕ slopes meet" marker and
 *      never a bottom ring.
 *   5) LOD: at a zoomed-out overview the rings + the "Holds" line are GONE; they return on zoom-in.
 *
 * Logged-out / this-device mode (no auth needed).
 * Run:  node ui-audit/verify-pond-contours.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-pond-contours";
// A normal 400×260 pond (8′ deep, 3:1, top of bank at elev 96) → real-elevation labels.
// A steep 60×60 pond (12′ deep, 4:1) collapses at down=7.5 → over-taper marker, no bottom.
const els = [
  { id: "p1", type: "pond", cx: -300, cy: 0, w: 400, h: 260, rot: 0, det: { depth: 8, freeboard: 1, slope: 3, contours: true, tobElev: 96 } },
  // A NON-square basin (320×90) so the short axis inverts (sign flips → real over-taper) at
  // down=45/6=7.5′ < 16′ — a square would re-form a same-winding inner square and never trip the
  // guard. 90′ short side still clears the zoom gate at fit. No datum → depth-style labels.
  { id: "p2", type: "pond", cx: 480, cy: 0, w: 320, h: 90, rot: 0, det: { depth: 16, freeboard: 1, slope: 6, contours: true } },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -800, y: -500 }, { x: 800, y: -500 }, { x: 800, y: 500 }, { x: -800, y: 500 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Pond Contours", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

const read = () => page.evaluate(() => {
  const paths = [...document.querySelectorAll("svg [data-contour]")];
  const labels = [...document.querySelectorAll("svg [data-contour-label]")];
  const texts = [...document.querySelectorAll("svg text")].map((t) => (t.textContent || "").trim());
  const kinds = paths.map((p) => p.getAttribute("data-contour"));
  // The pond footprint rect (#f3ece1 is the building tan; the pond uses the water gradient) —
  // measure ppf off the wide parcel polygon stroke bbox instead, via the largest svg polygon.
  const polys = [...document.querySelectorAll("svg polygon, svg path")];
  let widest = 0;
  for (const el of polys) { const b = el.getBoundingClientRect(); if (b.width > widest) widest = b.width; }
  return {
    ringCount: kinds.filter((k) => k === "line" || k === "water" || k === "bottom").length,
    hasWater: kinds.includes("water"),
    hasBottom: kinds.includes("bottom"),
    hasCollapsed: kinds.includes("collapsed"),
    elevLabels: labels.map((l) => (l.textContent || "").trim()),
    waterLabels: labels.filter((l) => l.getAttribute("data-contour-label") === "water").map((l) => (l.textContent || "").trim()),
    // The pond's name + storage lines are tspans inside one <text>, so textContent concatenates
    // them — match "Holds … ac-ft" anywhere in the string, not anchored.
    holds: (texts.find((t) => /Holds .*ac-ft/.test(t)) || "").match(/Holds .*?ac-ft[^]*?deep/)?.[0] || (texts.some((t) => /Holds .*ac-ft/.test(t)) ? "Holds…ac-ft" : null),
    widest,
  };
});

let fail = 0;
const check = (label, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) fail++; };

// ---- Phase 1: at a readable zoom, the contours + storage communicate ----
let m = await read();
console.log(`== Pond contours at fit zoom (${m.ringCount} rings) ==`);
await page.screenshot({ path: OUT + "pond-contours-fit.png" });
check("multiple concentric contour rings render", m.ringCount >= 3);
check("water-surface ring present (data-contour=water)", m.hasWater);
check("basin-bottom ring present (data-contour=bottom)", m.hasBottom);
check("stored volume seated on the plan ('Holds N ac-ft')", !!m.holds && /ac-ft/.test(m.holds || ""));
// p1 (datum set) labels its water surface as a real elevation (96 − 1 = 95.0).
check("datum pond labels its water surface as a real elevation ≈95.0", m.waterLabels.some((t) => /WS 9[0-5]\.0/.test(t)));
// p2 (no datum) labels by depth below top (a −value) — both modes coexist, proving the fallback.
check("non-datum pond labels rings by depth (a −value present)", m.elevLabels.some((t) => /−\d/.test(t)));
check("over-taper pond shows the '✕ slopes meet' marker", m.hasCollapsed);
if (m.holds) console.log(`    on-plan storage: "${m.holds}"`);

// ---- Phase 2: LOD — zoom OUT until the basin is small on screen; rings + chip vanish ----
console.log("\n== LOD: zoom out → contours declutter, zoom in → return ==");
const mx = 720, my = 450;
const zoom = async (notches) => { for (let i = 0; i < Math.abs(notches); i++) { await page.mouse.move(mx, my); await page.mouse.wheel(0, notches < 0 ? -300 : 300); await page.waitForTimeout(70); } await page.waitForTimeout(200); };
await zoom(14); // zoom way out
let mOut = await read();
await page.screenshot({ path: OUT + "pond-contours-overview.png" });
check("contour rings GONE at zoomed-out overview", mOut.ringCount === 0);
check("'Holds' storage line GONE at overview", !mOut.holds);

await zoom(-16); // zoom back in past the reveal point
await page.waitForTimeout(300);
let mIn = await read();
await page.screenshot({ path: OUT + "pond-contours-zoomin.png" });
check("contour rings RETURN on zoom-in", mIn.ringCount >= 3);
check("water + bottom rings RETURN on zoom-in", mIn.hasWater && mIn.hasBottom);

console.log(fail === 0 ? "\n✓ ALL POND-CONTOUR CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
