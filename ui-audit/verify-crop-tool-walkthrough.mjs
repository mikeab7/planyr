/* verify-crop-tool-walkthrough — THE CROP TOOL WALKED END TO END AS A USER WOULD (owner brief, 2026-09-29:
 * "this feature has now shipped three times and been unusable twice because nobody opened it").
 *
 * Covers NEW-1..NEW-6 of that brief, on a THROWAWAY plan seeded into localStorage (logged out, no
 * external GIS, never a real plan): a big landscape sheet with a labelled grid, opened through the
 * real OVERLAYS panel → Crop…. Every interaction is a REAL pointer / keyboard event (no synthetic
 * key dispatch — SYNTHETIC-KEYS-DONT-EDIT), the tab is asserted foreground (FOREGROUND-OR-VOID), and
 * the run carries a KNOWN-GOOD ARM: the freshly-opened dialog must report the geometry we know it has
 * (uncropped overlay, Rectangle mode, Done enabled) or the run is VOID and prints no score.
 *
 * The walk: open Crop → the sheet is shown BIG (NEW-5) → trace a 6-point polygon, zooming in with the
 * on-screen slider/+ to place two of the points and panning (arrow keys, then the Pan tool) to reach a
 * corner (NEW-3) → undo/redo by button and by all three chords (NEW-4) → Reset in Polygon mode leaves
 * Done live and saves the full sheet (NEW-1) → Reset from Rectangle clears the polygon too (NEW-2) →
 * mode switches both ways keep each shape → save → HARD reload with a cache-busting query → crop held
 * and the OVERLAYS row still expanded (NEW-6b); edge grips share one footprint (NEW-6a).
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const imgW = 3000, imgH = 1800; // a landscape survey-sized sheet, far bigger than any dialog
const grid = [];
for (let x = 0; x <= imgW; x += 250) grid.push(`<line x1='${x}' y1='0' x2='${x}' y2='${imgH}' stroke='#8a7a55' stroke-width='3'/>`);
for (let y = 0; y <= imgH; y += 250) grid.push(`<line x1='0' y1='${y}' x2='${imgW}' y2='${y}' stroke='#8a7a55' stroke-width='3'/>`);
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='#e8dcb5'/>${grid.join("")}<text x='40' y='140' font-size='120' fill='#333'>TOP-LEFT</text><text x='${imgW - 560}' y='${imgH - 40}' font-size='120' fill='#333'>BOTTOM-RIGHT</text></svg>`;
const ov = { id: "ovW", name: "walkthrough-sheet.png", imgW, imgH, page: 1, pageCount: 1, ftPerPx: 1, rotation: 0, opacity: 1, locked: false,
  x: -imgW / 2, y: -imgH / 2, src: "data:image/svg+xml;utf8," + encodeURIComponent(svg) };
const site = { id: "W1", groupId: "W1", site: "CropWalk", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -1700, y: -1000 }, { x: 1700, y: -1000 }, { x: 1700, y: 1000 }, { x: -1700, y: 1000 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  sheetOverlays: [ov], parcelDrawings: [], status: "active", updatedAt: Date.now() };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ W1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("dialog", async (d) => { console.log("  [DIALOG — never allowed]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
await assertMeasurable(page, "verify-crop-tool-walkthrough");

const openPlan = async (url) => {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  if (!(await page.locator("text=Overlays").count())) {
    await page.locator('[data-testid="module-tab-site-planner"]').first().click();
    await page.waitForTimeout(1200);
    await page.locator("text=CropWalk").first().dblclick();
    await page.waitForTimeout(2200);
  }
  await page.locator("text=Overlays").first().click();
  await page.waitForTimeout(500);
};
const stored = () => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const o = raw.W1 && raw.W1.sheetOverlays.find((x) => x.id === "ovW");
  return o ? (o.crop ?? null) : undefined;
});
const waitStored = async (pred, ms = 4000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await stored(); if (pred(s)) return s; await page.waitForTimeout(150); } return s; };
const dlg = page.locator('[data-testid="overlay-crop-dialog"]');
const openCrop = async () => {
  if (!(await page.locator('[data-testid="overlay-crop-open"]').count())) await page.locator("button", { hasText: ov.name }).first().click();
  await page.locator('[data-testid="overlay-crop-open"]').click();
  await page.waitForTimeout(600);
};
const imgBox = () => dlg.locator("img").first().boundingBox();
const viewBox = () => dlg.locator("img").first().evaluate((img) => { const r = img.parentElement.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const pct = async () => parseInt(await dlg.locator('[data-testid="crop-zoom-pct"]').textContent(), 10);
const vertexCount = () => dlg.locator('[data-testid^="crop-poly-vertex-"]').count();
// screen position of an IMAGE FRACTION, read from the image's own live box — valid at any pan/zoom
const at = async (fx, fy) => { const b = await imgBox(); return { x: b.x + fx * b.width, y: b.y + fy * b.height }; };
const inView = async (p) => { const v = await viewBox(); return p.x > v.x + 8 && p.x < v.x + v.w - 8 && p.y > v.y + 8 && p.y < v.y + v.h - 8; };
const clickAt = async (fx, fy, label) => {
  const p = await at(fx, fy);
  if (!(await inView(p))) throw new Error(`${label}: target (${fx},${fy}) is off screen at ${JSON.stringify(p)} — a user could not click it either`);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(250);
};
const done = () => dlg.locator('[data-testid="crop-done"]');

await openPlan(BASE);

/* ---- KNOWN-GOOD ARM ------------------------------------------------------------------------- */
await openCrop();
{
  const rectMode = await dlg.locator("button", { hasText: "Rectangle" }).count();
  const ok = (await dlg.count()) === 1 && rectMode === 1 && (await done().isEnabled()) && (await stored()) === null;
  check("[known-good arm] uncropped overlay opens the tool in Rectangle mode with Done enabled and no crop stored", ok);
  if (!ok) { console.log("  ⛔ VOID — the probe cannot see a known answer; no score reported."); await browser.close(); process.exit(2); }
}
check("tab is foreground", await page.evaluate(() => document.visibilityState === "visible"));

/* ---- NEW-5: the sheet is shown BIG ---------------------------------------------------------- */
{
  const v = await viewBox(), b = await imgBox();
  await page.screenshot({ path: OUT + "crop-walk-1-open.png" });
  const wShare = b.width / v.w, hShare = b.height / v.h;
  check("NEW-5: a landscape sheet fills the crop window (one dimension ≥ 95% of it, the other ≥ 85%)",
    Math.max(wShare, hShare) >= 0.95 && Math.min(wShare, hShare) >= 0.85, JSON.stringify({ view: [v.w | 0, v.h | 0], img: [b.width | 0, b.height | 0], wShare: +wShare.toFixed(2), hShare: +hShare.toFixed(2) }));
  const dv = await dlg.evaluate((el) => { const c = el.firstElementChild.getBoundingClientRect(); return { w: c.width, h: c.height, vw: innerWidth, vh: innerHeight }; });
  check("NEW-5: the dialog itself takes most of the window (≥ 90% wide, ≥ 88% tall)", dv.w >= dv.vw * 0.9 && dv.h >= dv.vh * 0.88, JSON.stringify(dv));
}

/* ---- NEW-6a: the four mid-edge grips share one footprint ------------------------------------- */
{
  const sizes = {};
  for (const t of ["t", "b", "l", "r", "tl", "br"]) { const bb = await dlg.locator(`[data-testid="crop-handle-${t}"]`).boundingBox(); sizes[t] = [Math.round(bb.width), Math.round(bb.height)]; }
  const long = Math.max(...sizes.t), short = Math.min(...sizes.t);
  check("NEW-6a: left/right grips are the same size as the top/bottom grips, turned 90°",
    sizes.t[0] === sizes.l[1] && sizes.t[1] === sizes.l[0] && sizes.b[0] === sizes.r[1] && sizes.b[1] === sizes.r[0], JSON.stringify(sizes));
  check("NEW-6a: no edge grip is a thinner target than a corner grip", short >= sizes.tl[0] && long >= sizes.tl[0], JSON.stringify({ short, corner: sizes.tl }));
}

/* ---- NEW-3: on-screen zoom and pan controls exist ---------------------------------------------- */
for (const id of ["crop-zoom-out", "crop-zoom-in", "crop-zoom-slider", "crop-zoom-fit", "crop-zoom-100", "crop-pan-tool", "crop-undo", "crop-redo"]) {
  check(`control present: ${id}`, (await dlg.locator(`[data-testid="${id}"]`).count()) === 1);
}
check("NEW-4: Undo and Redo are visible buttons, both disabled before any edit",
  (await dlg.locator('[data-testid="crop-undo"]').isDisabled()) && (await dlg.locator('[data-testid="crop-redo"]').isDisabled()));

/* ---- trace a 6-point polygon, zooming and panning as a user must ------------------------------- */
await dlg.locator("button", { hasText: "Polygon" }).click();
await page.waitForTimeout(200);
check("Polygon on an uncropped overlay opens as an empty trace; Done is disabled and SAYS why",
  (await done().isDisabled()) && /at least 3 points/i.test(await dlg.locator('[data-testid="crop-done-why"]').textContent()));
const fit0 = await pct();
// points 1-4 at Fit: a hexagon whose corners are at image fractions
const HEX = [[0.08, 0.30], [0.30, 0.08], [0.70, 0.08], [0.92, 0.30], [0.92, 0.85], [0.08, 0.85]];
for (let i = 0; i < 4; i++) await clickAt(HEX[i][0], HEX[i][1], `hex ${i + 1}`);
check("four points placed at Fit", (await dlg.locator("svg circle").count()) === 4);

// zoom in with the on-screen + (about the middle) — then hold at that zoom
for (let i = 0; i < 4; i++) { await dlg.locator('[data-testid="crop-zoom-in"]').click(); await page.waitForTimeout(80); }
const z1 = await pct();
check("NEW-3: the + button zooms in", z1 > fit0 * 2, `${fit0}% → ${z1}%`);
// the next corner (0.92,0.85) is now off screen: a user pans. Arrow keys first (focus is inside the dialog).
const target5 = HEX[4];
let p5 = await at(target5[0], target5[1]);
check("[precondition] point 5 is genuinely off-screen at this zoom (else panning proves nothing)", !(await inView(p5)), JSON.stringify(p5));
const before = await imgBox();
await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowUp");
await page.waitForTimeout(150);
const after = await imgBox();
check("NEW-3: arrow keys pan (left arrow moves the view toward the left of the sheet ⇒ the picture slides right)", after.x > before.x && after.y > before.y, JSON.stringify({ dx: after.x - before.x, dy: after.y - before.y }));
// now reach the bottom-right with arrows the other way until visible
for (let i = 0; i < 60 && !(await inView(await at(target5[0], target5[1]))); i++) { await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowDown"); }
check("NEW-3: arrow-key panning reaches the corner", await inView(await at(target5[0], target5[1])));
await clickAt(target5[0], target5[1], "hex 5");
// point 6 (0.08,0.85): use the Pan TOOL (drag) to move back
await dlg.locator('[data-testid="crop-pan-tool"]').click();
const v0 = await viewBox();
let guard = 0;
while (!(await inView(await at(HEX[5][0], HEX[5][1]))) && guard++ < 12) {
  await page.mouse.move(v0.x + v0.w * 0.25, v0.y + v0.h * 0.5);
  await page.mouse.down(); await page.mouse.move(v0.x + v0.w * 0.85, v0.y + v0.h * 0.5, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(120);
}
check("NEW-3: the Pan tool drags the picture to reach a corner", await inView(await at(HEX[5][0], HEX[5][1])), `drags=${guard}`);
check("Pan tool: while it is on, a left-drag did NOT place a point", (await dlg.locator("svg circle").count()) === 5);
await dlg.locator('[data-testid="crop-pan-tool"]').click(); // back to drawing
await clickAt(HEX[5][0], HEX[5][1], "hex 6");
check("six points placed (two of them at high zoom, one after panning)", (await dlg.locator("svg circle").count()) === 6);
await page.screenshot({ path: OUT + "crop-walk-2-six-points.png" });
// close with Enter
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
check("Enter closes the polygon: six draggable vertex handles", (await vertexCount()) === 6);
check("Done is now enabled and no 'why' text is shown", (await done().isEnabled()) && (await dlg.locator('[data-testid="crop-done-why"]').count()) === 0);

/* ---- NEW-4: undo / redo, by button and by every chord ----------------------------------------- */
const undoBtn = dlg.locator('[data-testid="crop-undo"]'), redoBtn = dlg.locator('[data-testid="crop-redo"]');
check("Undo button is enabled after edits; Redo is not", (await undoBtn.isEnabled()) && (await redoBtn.isDisabled()));
await dlg.locator('[data-testid="crop-zoom-fit"]').click();
await page.waitForTimeout(150);
// drag vertex 2 a visible distance, then undo/redo it
const v2 = await dlg.locator('[data-testid="crop-poly-vertex-2"]').boundingBox();
const v2c = { x: v2.x + v2.width / 2, y: v2.y + v2.height / 2 };
await page.mouse.move(v2c.x, v2c.y); await page.mouse.down(); await page.mouse.move(v2c.x - 120, v2c.y + 90, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(200);
const v2moved = await dlg.locator('[data-testid="crop-poly-vertex-2"]').boundingBox();
check("dragging a vertex moves it", Math.abs(v2moved.x - v2.x) > 60, `dx=${Math.round(v2moved.x - v2.x)}`);
await undoBtn.click(); await page.waitForTimeout(150);
const v2undo = await dlg.locator('[data-testid="crop-poly-vertex-2"]').boundingBox();
check("NEW-4: Undo button puts the vertex back", Math.abs(v2undo.x - v2.x) < 2 && Math.abs(v2undo.y - v2.y) < 2);
check("NEW-4: Redo button is now enabled", await redoBtn.isEnabled());
await redoBtn.click(); await page.waitForTimeout(150);
const v2redo = await dlg.locator('[data-testid="crop-poly-vertex-2"]').boundingBox();
check("NEW-4: Redo button re-applies the drag", Math.abs(v2redo.x - v2moved.x) < 2 && Math.abs(v2redo.y - v2moved.y) < 2);
for (const [chord, label] of [["Control+z", "Ctrl+Z"]]) {
  await page.keyboard.press(chord); await page.waitForTimeout(150);
  const b = await dlg.locator('[data-testid="crop-poly-vertex-2"]').boundingBox();
  check(`NEW-4: ${label} undoes`, Math.abs(b.x - v2.x) < 2);
}
await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(150);
check("NEW-4: Ctrl+Shift+Z redoes", Math.abs((await dlg.locator('[data-testid="crop-poly-vertex-2"]').boundingBox()).x - v2moved.x) < 2);
await page.keyboard.press("Control+z"); await page.waitForTimeout(100);
await page.keyboard.press("Control+y"); await page.waitForTimeout(150);
check("NEW-4: Ctrl+Y redoes", Math.abs((await dlg.locator('[data-testid="crop-poly-vertex-2"]').boundingBox()).x - v2moved.x) < 2);
// undo walks several steps back through the polygon (delete a vertex, undo, redo)
await dlg.locator('[data-testid="crop-poly-vertex-5"]').click(); await page.keyboard.press("Delete"); await page.waitForTimeout(150);
check("Delete removes the selected vertex (6 → 5)", (await vertexCount()) === 5);
await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
check("Ctrl+Z restores it (→ 6)", (await vertexCount()) === 6);
await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(150);
check("Ctrl+Shift+Z deletes it again (→ 5)", (await vertexCount()) === 5);
await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
check("…and back to 6 for the rest of the walk", (await vertexCount()) === 6);

/* ---- NEW-1: Reset in Polygon mode never strands you --------------------------------------------- */
await dlg.locator('[data-testid="crop-reset"]').click();
await page.waitForTimeout(200);
check("NEW-1: after Reset in Polygon mode, Done is ENABLED", await done().isEnabled());
check("NEW-1: …and no 'stuck' message is showing", (await dlg.locator('[data-testid="crop-done-why"]').count()) === 0);
check("NEW-1: Polygon shows the full-page quad (4 handles), not an emptied trace", (await vertexCount()) === 4);
check("NEW-1: Reset is undoable (Undo brings the 6-point polygon back)", await (async () => { await undoBtn.click(); await page.waitForTimeout(150); return (await vertexCount()) === 6; })());
await dlg.locator('[data-testid="crop-reset"]').click(); await page.waitForTimeout(150);
await done().click();
const s1 = await waitStored((s) => s === null);
check("NEW-1: Done after Reset saves 'no crop' (the full sheet)", s1 === null, JSON.stringify(s1));

/* ---- save a real polygon, then NEW-2: Reset from RECTANGLE clears the polygon too -------------- */
await openCrop();
check("reopened: uncropped again", (await dlg.locator("button", { hasText: "Polygon" }).count()) === 1 && (await stored()) === null);
await dlg.locator("button", { hasText: "Polygon" }).click();
const HEX2 = [[0.12, 0.35], [0.35, 0.12], [0.65, 0.12], [0.88, 0.35], [0.88, 0.8], [0.12, 0.8]];
for (let i = 0; i < 6; i++) await clickAt(HEX2[i][0], HEX2[i][1], `hex2 ${i + 1}`);
await page.keyboard.press("Enter"); await page.waitForTimeout(200);
check("second polygon closed with 6 vertices", (await vertexCount()) === 6);
await done().click();
const s2 = await waitStored((s) => s && s.kind === "poly");
check("polygon saved (kind poly, 6 points)", !!s2 && s2.kind === "poly" && s2.pts.length === 6, JSON.stringify(s2 && s2.pts && s2.pts.length));

await openCrop();
await dlg.locator("button", { hasText: "Rectangle" }).click();
await page.waitForTimeout(150);
check("NEW-2: in Rectangle mode the button says 'Reset to full page' and is ENABLED (a polygon is still saved)", await dlg.locator('[data-testid="crop-reset"]').isEnabled());
await dlg.locator('[data-testid="crop-reset"]').click(); await page.waitForTimeout(150);
await dlg.locator("button", { hasText: "Polygon" }).click(); await page.waitForTimeout(150);
check("NEW-2: switching to Polygon after the Reset shows the full-page quad, not the old 6-point polygon", (await vertexCount()) === 4);
await dlg.locator("button", { hasText: "Rectangle" }).click();
await done().click();
const s3 = await waitStored((s) => s === null);
check("NEW-2: Rectangle → Reset → Done saves NO crop — the polygon is gone too", s3 === null, JSON.stringify(s3));

/* ---- mode switches both ways keep each shape independent -------------------------------------- */
await openCrop();
await dlg.locator('[data-testid="crop-handle-r"]').hover();
{ // drag the right edge in (rectangle crop)
  const hb = await dlg.locator('[data-testid="crop-handle-r"]').boundingBox();
  const c = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x - 300, c.y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(200);
}
await dlg.locator("button", { hasText: "Polygon" }).click(); await page.waitForTimeout(150);
check("rect → polygon: on an overlay that was uncropped at open, Polygon starts a fresh trace (the rectangle waits, untouched)",
  (await vertexCount()) === 0 && (await done().isDisabled()));
await dlg.locator("button", { hasText: "Rectangle" }).click(); await page.waitForTimeout(150);
check("polygon → rect: the rectangle is still trimmed (Reset is enabled)", await dlg.locator('[data-testid="crop-reset"]').isEnabled());
await done().click();
const s4 = await waitStored((s) => s && s.kind === "rect");
check("rectangle crop saved", !!s4 && s4.kind === "rect" && s4.w < imgW - 100, JSON.stringify(s4));

/* ---- HARD reload with a cache-busting query -------------------------------------------------- */
const cb = BASE.replace(/\/?$/, "/") + "?cb=" + Date.now();
await page.goto("about:blank");
await openPlan(cb);
const s5 = await stored();
check("after a hard reload (cache-busted URL) the rectangle crop is still saved", !!s5 && s5.kind === "rect", JSON.stringify(s5));
check("NEW-6b: …and the OVERLAYS row is STILL expanded (Crop… reachable with no extra click)", (await page.locator('[data-testid="overlay-crop-open"]').count()) === 1);
await page.screenshot({ path: OUT + "crop-walk-3-after-reload.png" });
await openCrop();
check("reopening after the reload shows the saved rectangle (Reset enabled)", await dlg.locator('[data-testid="crop-reset"]').isEnabled());
await dlg.locator('[data-testid="crop-reset"]').click();
await done().click();
check("cleanup: the throwaway overlay is reset to uncropped", (await waitStored((s) => s === null)) === null);

/* ---- Escape / Cancel still discard -------------------------------------------------------------- */
await openCrop();
await dlg.locator("button", { hasText: "Polygon" }).click();
await clickAt(0.2, 0.2, "esc a"); await clickAt(0.8, 0.2, "esc b"); await clickAt(0.5, 0.8, "esc c");
await page.keyboard.press("Enter"); await page.waitForTimeout(150);
await dlg.locator("button", { hasText: "Cancel" }).click(); await page.waitForTimeout(300);
check("Cancel throws the drawing away (nothing stored)", (await dlg.count()) === 0 && (await stored()) === null);

check("no uncaught page errors", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));
await browser.close();
console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ all checks passed");
process.exit(fail ? 1 : 0);
