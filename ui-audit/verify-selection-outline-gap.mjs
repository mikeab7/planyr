/* Self-verification for B848720 (V470032) — the selection outline for a box-kind markup and for
 * a selected site element used to be drawn EXACTLY ON TOP of the feature's own boundary, so a
 * user-coloured outline read as "a blue line painted on my shape" instead of a selection cue
 * (owner report: a MARKUP · RECT, orange outline weight 2, orange fill, 698×281, rotation 0).
 *
 * The fix grows the outline OUTWARD by a constant screen-px gap (SEL_OUTLINE_GAP_PX) before
 * drawing it, for all four call sites that used to trace the feature's own path:
 *   - markupHandles' MK_BOX_KINDS branch (rect/ellipse markups)
 *   - elSelOutline's polygon/rect-corners branch (a selected site element, e.g. a pond or a
 *     building with a user-set el.stroke override)
 *   - elSelOutline's locked-road elCorners branch
 *
 * This check drives the REAL app, logged out (no auth / no external GIS needed — every case is
 * Claude-doable per ATTEMPT-BEFORE-YOU-PARK), seeding:
 *   - a MARKUP RECT with the owner's exact repro: orange outline+fill, weight 2, 698×281, rot 0
 *   - a MARKUP ELLIPSE with a BLUE outline (#2563eb — the same hue as the selection chrome
 *     itself, the hardest case to tell apart from the selection cue)
 *   - an ELEMENT (type "building", no `points` → elCorners branch) with a custom ORANGE stroke
 *   - an ELEMENT (type "pond", irregular `points` polygon → the general polygon branch) with a
 *     custom BLUE stroke
 *
 * For each shape it asserts, at TWO zoom levels (fit + zoomed in) and in BOTH themes:
 *   1. the shape's own visible stroke colour is UNCHANGED while selected (still its own hue)
 *   2. a blue (#2563eb) selection-outline element exists
 *   3. that outline's screen-space bounding box is STRICTLY LARGER than the shape's own visible
 *      bounding box on every side — i.e. it never retraces the shape's own boundary
 *
 * Run: node ui-audit/verify-selection-outline-gap.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-sel-outline-gap";

const SEL_BLUE = "#2563eb";
// Each shape gets a UNIQUE stroke hex (even the two "orange" and two "blue" ones) so the DOM
// queries below can find each shape unambiguously by exact colour match — several shapes sit at
// a similar on-screen size, so matching by "largest box of this colour" would be ambiguous if any
// two shared a hex.
const ORANGE_RECT = "#f97316";     // the owner's exact repro colour
const BLUE_ELLIPSE = "#2563eb";    // deliberately the SAME hue as SEL_BLUE — the hardest case
const ORANGE_BUILDING = "#c2410c"; // a different orange (also this app's own MK_DEFAULT orange)
const BLUE_POND = "#0ea5e9";       // a different, sky blue

// The owner's exact repro: MARKUP · RECT, orange outline (weight 2), orange fill, 698×281, rot 0.
const mkRect = { id: "mkRect1", kind: "rect", cx: 0, cy: 0, w: 698, h: 281, rot: 0, stroke: ORANGE_RECT, weight: 2, dash: "solid", fill: ORANGE_RECT, fillOpacity: 0.18 };
// Hardest case: a markup whose own outline is the SAME hue as the selection chrome.
const mkEllipse = { id: "mkEll1", kind: "ellipse", cx: 1100, cy: 0, w: 420, h: 260, rot: 15, stroke: BLUE_ELLIPSE, weight: 2, dash: "solid", fill: BLUE_ELLIPSE, fillOpacity: 0.15 };

// elCorners branch: a rect element (no `points`) with a user-set stroke override.
const elBuilding = { id: "elB1", type: "building", cx: 0, cy: 700, w: 300, h: 180, rot: 10, stroke: ORANGE_BUILDING, fill: "#f3ece1", fillOpacity: 1 };
// General polygon branch: an irregular pond ring (never a plain rectangle) with a user override.
const pondCx = 800, pondCy = 700;
const pondPts = [
  { x: pondCx - 180, y: pondCy - 90 }, { x: pondCx + 40, y: pondCy - 130 }, { x: pondCx + 190, y: pondCy - 40 },
  { x: pondCx + 150, y: pondCy + 100 }, { x: pondCx - 60, y: pondCy + 140 }, { x: pondCx - 200, y: pondCy + 20 },
];
const elPond = { id: "elP1", type: "pond", cx: pondCx, cy: pondCy, w: 400, h: 280, rot: 0, points: pondPts, stroke: BLUE_POND, fill: "#5B97A5", fillOpacity: 0.5 };

// "Zoom to fit" (SitePlanner.jsx `fit`) frames only parcels + elements + underlay — NEVER
// markups (B494048: "frame what is on screen", and a markup is an annotation, not the site
// itself). Without a parcel bounding the whole seeded scene, fit would frame only the two
// elements and leave both markups off-screen, so a click at their (correct but unframed)
// screen position would land on nothing. One inactive-looking bounding parcel, sized around
// every shape below, keeps all four in frame — it plays no other part in the checks.
const boundingParcel = { id: "pcBound", locked: true, points: [
  { x: -400, y: -260 }, { x: 1420, y: -260 }, { x: 1420, y: 960 }, { x: -400, y: 960 },
] };

const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B848720", name: "Plan 1",
  origin: null, county: null, parcels: [boundingParcel], els: [elBuilding, elPond], measures: [],
  callouts: [], markups: [mkRect, mkEllipse], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seedSite = (theme) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

/* Find a shape's own VISIBLE boundary node by its unique stroke colour — any of rect/polygon/
 * path/ellipse, excluding the invisible hit-companion (stroke rgba(0,0,0,0.001)) and excluding
 * data-export="skip" chrome (which never carries the shape's OWN authored colour anyway, but the
 * blue-on-blue ellipse case needs the exclusion made explicit). Returns its CSS bounding box. */
const readOwnBox = (page, scope, color) => page.evaluate(({ scope, c }) => {
  const root = document.querySelector(scope);
  if (!root) return null;
  const els = [...root.querySelectorAll("rect, polygon, path, ellipse")]
    .filter((e) => (e.getAttribute("stroke") || "").toLowerCase() === c)
    .filter((e) => !e.closest('[data-export="skip"]'));
  if (!els.length) return null;
  // several nodes inside the scope can share a colour (e.g. the pond's centerline stroke); take
  // the largest box — the shape's own body, never a thinner sub-stroke.
  const boxes = els.map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
  if (!boxes.length) return null;
  const best = boxes.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
  return { x: best.x, y: best.y, w: best.width, h: best.height, cx: best.x + best.width / 2, cy: best.y + best.height / 2 };
}, { scope, c: color });

/* The selection outline: any polygon/polyline stamped SEL_BLUE, data-export="skip", fill="none"
 * (excludes resize/rotate handle rects+circles, which are separate nodes). */
const readSelOutlineBox = (page) => page.evaluate((blue) => {
  const els = [...document.querySelectorAll('svg polygon[stroke="' + blue + '"], svg polyline[stroke="' + blue + '"]')]
    .filter((e) => (e.getAttribute("fill") || "none") === "none")
    .filter((e) => e.closest('[data-export="skip"]'));
  if (!els.length) return null;
  const b = els[0].getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}, SEL_BLUE);

const clickCenter = async (page, box) => { await page.mouse.click(box.cx, box.cy); await page.waitForTimeout(300); };
const deselect = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(200); };

const checkShape = async (page, label, scope, ownColor, tag) => {
  const before = await readOwnBox(page, scope, ownColor);
  if (!before) { log(false, `${tag}: ${label} not found in the SVG before selection`); return; }
  await clickCenter(page, before);
  const afterOwn = await readOwnBox(page, scope, ownColor);
  const outline = await readSelOutlineBox(page);
  log(!!afterOwn, `${tag}: ${label} still renders after selection`);
  if (afterOwn) {
    log(Math.abs(afterOwn.w - before.w) < 1 && Math.abs(afterOwn.h - before.h) < 1,
      `${tag}: ${label}'s own boundary box is unchanged by selection (own colour never repainted)`);
  }
  if (!outline) { log(false, `${tag}: ${label} — no blue selection outline found`); }
  else {
    // "outside the shape's own stroke": the outline's box must be strictly larger on every side,
    // by roughly the gap on each edge (2×gap across the box) — never merely equal (coincident).
    const growsL = outline.x < before.x - 0.5, growsT = outline.y < before.y - 0.5;
    const growsR = (outline.x + outline.w) > (before.x + before.w) + 0.5;
    const growsB = (outline.y + outline.h) > (before.y + before.h) + 0.5;
    log(growsL && growsT && growsR && growsB,
      `${tag}: ${label} — selection outline sits OUTSIDE the shape's own boundary on all sides ` +
      `(own ${before.w.toFixed(1)}×${before.h.toFixed(1)} @ ${before.x.toFixed(1)},${before.y.toFixed(1)} → ` +
      `outline ${outline.w.toFixed(1)}×${outline.h.toFixed(1)} @ ${outline.x.toFixed(1)},${outline.y.toFixed(1)})`);
    log(outline.w > before.w + 2 && outline.h > before.h + 2,
      `${tag}: ${label} — outline is not merely coincident (grew by >2px on each axis)`);
  }
  await deselect(page);
  return { before, afterOwn, outline };
};

const runPass = async (page, tag) => {
  await checkShape(page, "the owner's orange RECT (698×281, rot 0)", '[data-markup="mkRect1"]', ORANGE_RECT, tag);
  await checkShape(page, "a BLUE ellipse (same hue as the selection chrome)", '[data-markup="mkEll1"]', BLUE_ELLIPSE, tag);
  await checkShape(page, "a BUILDING element (elCorners branch) with an orange override", '[data-el-id="elB1"]', ORANGE_BUILDING, tag);
  await checkShape(page, "a POND element (irregular polygon branch) with a blue override", '[data-el-id="elP1"]', BLUE_POND, tag);
};

const fitView = async (page) => {
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
  await page.waitForTimeout(400);
};

/* The four shapes are spread across a wide scene, so a single shared "zoom in" (around one fixed
 * screen point) would push the far shapes off-screen — an artifact of the harness's wide layout,
 * not of the app. Zoom in AROUND EACH SHAPE'S OWN centre instead (re-fitting first so zoom never
 * compounds across shapes), which is also the more realistic repro: the owner zooms in on the ONE
 * thing he's editing. */
const checkShapeZoomedIn = async (page, label, scope, color, tag) => {
  await fitView(page);
  const center = await readOwnBox(page, scope, color);
  if (!center) { log(false, `${tag}: ${label} not found before zooming in`); return; }
  await page.mouse.move(center.cx, center.cy);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
  await page.waitForTimeout(300);
  await checkShape(page, label, scope, color, tag);
};

const runZoomedInPass = async (page, tag) => {
  await checkShapeZoomedIn(page, "the owner's orange RECT (698×281, rot 0)", '[data-markup="mkRect1"]', ORANGE_RECT, tag);
  await checkShapeZoomedIn(page, "a BLUE ellipse (same hue as the selection chrome)", '[data-markup="mkEll1"]', BLUE_ELLIPSE, tag);
  await checkShapeZoomedIn(page, "a BUILDING element (elCorners branch) with an orange override", '[data-el-id="elB1"]', ORANGE_BUILDING, tag);
  await checkShapeZoomedIn(page, "a POND element (irregular polygon branch) with a blue override", '[data-el-id="elP1"]', BLUE_POND, tag);
};

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedSite(theme));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-selection-outline-gap");
  const errors = [];
  const NETWORK_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await fitView(page);

  console.log(`\n--- ${theme} theme, zoom to fit ---`);
  await runPass(page, `${theme}/fit`);

  // Screenshot the owner's exact case, selected — the "would I ship this" side-by-side artifact.
  const rectBox = await readOwnBox(page, '[data-markup="mkRect1"]', ORANGE_RECT);
  if (rectBox) {
    await page.mouse.click(rectBox.cx, rectBox.cy);
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + `b848720-orange-rect-selected-${theme}.png` });
    await deselect(page);
    await page.screenshot({ path: OUT + `b848720-orange-rect-unselected-${theme}.png` });
  }

  console.log(`\n--- ${theme} theme, zoomed in (per-shape, close-in) ---`);
  await runZoomedInPass(page, `${theme}/zoomed-in`);

  log(errors.length === 0, `${theme}: no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""));
  await ctx.close();
}

console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
