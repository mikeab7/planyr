/* V254 / B741 — REPRO-FIRST: the orphaned / misfit selection handles on ANGLED elements.
 *
 * Drives the running app (logged-out, seeded site — no origin, so no network): selects a single
 * building rotated 35° and inspects the actual rendered selection handles. Checks the three
 * hypotheses from the backlog:
 *   A — a stale/duplicate handle layer (more than one grip set at once)
 *   B — an upright axis-aligned box around the angled shape (grips NOT on the rotated corners)
 *   C — the rotation stem pointing screen-up instead of normal to the rotated top edge
 *
 * PASS = one clean OBB grip set hugging the rotated footprint + the stem normal to the top edge.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const ROT = 35; // degrees

const site = {
  id: "uiaudit-v254", groupId: "uiaudit-v254", site: "Angled Handles Tract", name: "Plan 1",
  origin: null, county: "harris",
  parcels: [],
  // Two angled strips side-by-side (the truck-court repro geometry): selecting ONE must not
  // bleed grips onto the OTHER (the "two handle sets at once" report).
  els: [
    { id: "b1", type: "building", cx: 0, cy: 0, w: 320, h: 160, rot: ROT },
    { id: "b2", type: "parking", cx: 260, cy: 180, w: 300, h: 150, rot: ROT },
  ],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [],
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  ⚠ pageerror:", e.message));
await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
try { await page.getByRole("button", { name: /site planner/i }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(1500);

// Find the MAIN planner canvas SVG (the largest one on the page), click its center to select.
const box = await page.evaluate(() => {
  let best = null, bestA = 0;
  for (const s of document.querySelectorAll("svg")) {
    const r = s.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > bestA) { bestA = a; best = r; }
  }
  return best ? { x: best.x, y: best.y, width: best.width, height: best.height } : null;
});
if (!box) { console.log("  ❌ no planner canvas SVG found — seed may not have loaded"); await browser.close(); process.exit(1); }
console.log("  · canvas SVG box:", JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }));
// Try the canvas center first (the sole element sits at feet 0,0 → near the fitted center),
// then a small spiral of fallbacks until the transform grips appear.
const gripSel = 'rect[width="10"][height="10"][stroke="#2563eb"]';
let selected = false;
const cx0 = box.x + box.width / 2, cy0 = box.y + box.height / 2;
const spiral = [[0, 0]];
for (let r = 40; r <= 240; r += 40) for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) spiral.push([ax * r, ay * r]);
for (const [dx, dy] of spiral) {
  await page.mouse.click(cx0 + dx, cy0 + dy);
  await page.waitForTimeout(250);
  if (await page.locator(gripSel).count() >= 1) { selected = true; break; }
}
ok(selected, "clicking an angled element selects it (transform grips appear)");

// Read the 4 corner grips + the rotation stem line.
const grips = await page.locator(gripSel).evaluateAll((nodes) => nodes.map((n) => ({
  x: +n.getAttribute("x") + 5, y: +n.getAttribute("y") + 5, // center of the 10x10 grip
})));
console.log("  · grip centers:", JSON.stringify(grips.map((g) => ({ x: Math.round(g.x), y: Math.round(g.y) }))));

// Hypothesis A — exactly ONE grip set (a non-road building = 4 corner grips, no duplicates/stale).
ok(grips.length === 4, `A: exactly ONE clean grip set — 4 corner grips (got ${grips.length})`);

if (grips.length === 4) {
  // Order the grips by angle around their centroid so adjacent grips are true rectangle sides.
  const cxm = grips.reduce((a, g) => a + g.x, 0) / 4, cym = grips.reduce((a, g) => a + g.y, 0) / 4;
  const ordered = [...grips].sort((a, b) => Math.atan2(a.y - cym, a.x - cxm) - Math.atan2(b.y - cym, b.x - cxm));
  // The edges of a correctly-rotated rect are at ±35° (screen y-down: expect a non-axis-aligned slope).
  const edgeAngles = ordered.map((g, i) => {
    const h = ordered[(i + 1) % 4];
    let deg = Math.atan2(h.y - g.y, h.x - g.x) * 180 / Math.PI;
    return ((deg % 90) + 90) % 90; // fold into [0,90): 0 or 90 ⇒ axis-aligned
  });
  console.log("  · grip-rectangle edge angles (folded to [0,90)):", edgeAngles.map((a) => a.toFixed(1)));
  // B: an axis-aligned (upright) box would have every edge ≈ 0° or ≈ 90° (fold → ~0). A truly
  // rotated OBB has edges near the rotation angle (35° or its complement 55°), clearly off-axis.
  const offAxis = edgeAngles.some((a) => a > 8 && a < 82);
  ok(offAxis, "B: grips sit on the ROTATED corners (rectangle is off-axis, not an upright AABB)");

  // Cross-bleed guard: the grip rectangle must match ONE element's footprint, not span both
  // angled strips (the "handles on the other strip" report). Diagonal of one 320×160 element is
  // ~358 ft; both strips together span ~600+ ft. Compare the grip-rect diagonal to the element side.
  const diag = Math.max(...grips.map((g) => Math.max(...grips.map((h) => Math.hypot(g.x - h.x, g.y - h.y)))));
  const sideRatio = diag / (Math.hypot(grips[0].x - grips[2].x, grips[0].y - grips[2].y) || 1);
  const edgeLens = ordered.map((g, i) => { const h = ordered[(i + 1) % 4]; return Math.hypot(h.x - g.x, h.y - g.y); });
  const aspect = Math.max(...edgeLens) / (Math.min(...edgeLens) || 1);
  console.log("  · grip-rect edge lengths(px):", edgeLens.map((l) => Math.round(l)), "aspect:", aspect.toFixed(2));
  // One element is 320×160 (aspect 2.0). A box bleeding across both would be far more square or huge.
  ok(aspect > 1.4 && aspect < 3.0, "cross-bleed guard: grip rect matches ONE element's 2:1 footprint (not spanning both strips)");

  // C — the rotation stem: the blue <line> whose one end is a grip-free point outside the top edge.
  const stem = await page.locator('line[stroke="#2563eb"]').evaluateAll((lines) => lines.map((l) => ({
    x1: +l.getAttribute("x1"), y1: +l.getAttribute("y1"), x2: +l.getAttribute("x2"), y2: +l.getAttribute("y2"),
  })));
  // pick the short stem line (length ~26)
  const stemL = stem.map((s) => ({ s, len: Math.hypot(s.x2 - s.x1, s.y2 - s.y1) })).filter((o) => o.len > 10 && o.len < 60).map((o) => o.s);
  if (stemL.length) {
    const s = stemL[0];
    let stemDeg = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI;
    const foldedStem = ((stemDeg % 180) + 180) % 180;
    console.log("  · rotation-stem angle (deg, screen):", stemDeg.toFixed(1));
    // Screen-up would be ~ -90° (folded → 90). Normal to a 35°-rotated top edge is ~ -55°/125°
    // (folded → ~55/125→ not 90). So a stem clearly NOT vertical proves it tracks the rotated edge.
    const nearVertical = Math.abs(foldedStem - 90) < 8;
    ok(!nearVertical, "C: rotation stem is normal to the ROTATED top edge (not pinned screen-up)");
  } else {
    console.log("  · (no short rotation stem line found — skipping hypothesis C)");
  }
}

await page.screenshot({ path: "ui-audit/screens/v254-angled-handles.png", clip: { x: cx0 - 260, y: cy0 - 220, width: 520, height: 440 } }).catch(() => {});
console.log(`\nV254 angled-handle repro: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? "  → NO misfit reproduced: single-select handles are OBB-correct on an angled element." : "  → MISFIT reproduced — see failing hypothesis above.");
await browser.close();
process.exit(fail ? 1 : 0);
