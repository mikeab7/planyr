/* 2026-09-23 hardening — NEW-1/NEW-2/NEW-3 (Site tab OVERLAYS "Crop…", ImageCropTool.jsx), driven
 * end to end in a real browser, logged out, against a REAL committed sheet (no external GIS —
 * ATTEMPT-BEFORE-YOU-PARK: this whole class is Claude-doable and none of it is deferred).
 *
 * The owner, live on the Goose Creek master site plan: "it only gives me four control points to
 * mess with, this defeats the whole purpose of the polygon" + "I can't zoom in to get the little
 * piece that I want" + "this is just a shitty workflow." This is NEW-3's own instruction — "run
 * through the workflow from end to end once you've built it and make sure it makes sense" — using
 * the real six-vertex L-shaped fixture from B1783329 (test/fixtures/site-plan-crop/l-shaped-plan.png)
 * uploaded through the real file input, on a throwaway in-sandbox plan (nothing signed-in, nothing
 * touches Supabase — see the session's own report for what that leaves for a live signed-in pass).
 *
 * ⚠ Everything before "Done" is committed is checked by MEASURING THE LIVE DOM (a vertex's on-screen
 * position, converted to image px via the image's OWN current bounding box, which is correct at any
 * pan/zoom) — NOT by reading the overlay's persisted `crop` field, which only updates on Done/Reset.
 * Reading storage mid-edit would silently read stale/null data and prove nothing.
 *
 * Covers what `ui-audit/verify-site-tab-overlay-crop.mjs` does not (that sibling harness already
 * proves rotate-weld / export parity / lock refusal / reload persistence / rect<->poly round-trip
 * and is re-run as a regression check alongside this one, not duplicated here):
 *   1. Trace the L-shape's real 6 vertices, ZOOMING IN about the pointer for two of them (the
 *      screen point under the cursor must still be the same image point after the zoom).
 *   2. Insert a vertex on an existing edge (press+drag in one gesture), then select it and delete
 *      it with the keyboard — the actual NEW-1 defect (four corners, no way to add a fifth).
 *   3. Shift-constrain a vertex drag to vertical.
 *   4. The tool's own Ctrl+Z steps back an insert, a drag, a delete, and a mid-draw placement.
 *   5. What's kept vs. dropped is visible WHILE drawing (before the ring closes), not only after.
 *   6. Fit / 100% controls, and the zoom % readout tracks a live wheel gesture.
 *   7. A real pan+zoom sequence leaves a vertex's position relative to the IMAGE unchanged, while
 *      its on-screen position visibly moves — proving the shape is welded to the picture, not the view.
 *   8. The dialog uses a big share of a normal desktop viewport, not a small fixed box.
 *  11. KNOWN-GOOD ARM: an uncropped overlay reads the fixture's fill colour, not scrim — if this
 *      fails the run is VOID.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const FIXTURE = new URL("../test/fixtures/site-plan-crop/l-shaped-plan.png", import.meta.url).pathname;

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

// The real fixture (1200×900) is an L: (80,80)(900,80)(900,375)(400,375)(400,775)(80,775) — a genuine
// six-vertex boundary, image px. As FRACTIONS of the image (what the walkthrough traces):
const IMG_W = 1200, IMG_H = 900;
const VERTS_PX = [[80, 80], [900, 80], [900, 375], [400, 375], [400, 775], [80, 775]];
const VERTS_FRAC = VERTS_PX.map(([x, y]) => [x / IMG_W, y / IMG_H]);

const site = { id: "C1", groupId: "C1", site: "CropPolyT", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -900, y: -700 }, { x: 900, y: -700 }, { x: 900, y: 700 }, { x: -900, y: 700 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  sheetOverlays: [], parcelDrawings: [], status: "active", updatedAt: Date.now() };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ C1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("dialog", async (dlg) => { console.log("  [DIALOG — never allowed]", dlg.message().slice(0, 100)); fail++; await dlg.accept().catch(() => {}); });
await assertMeasurable(page, "verify-crop-polygon-editing");

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
if (!(await page.locator("text=Overlays").count())) {
  await page.locator('[data-testid="module-tab-site-planner"]').first().click();
  await page.waitForTimeout(1200);
  await page.locator("text=CropPolyT").first().dblclick();
  await page.waitForTimeout(2200);
}
await page.locator("text=Overlays").first().click();
await page.waitForTimeout(500);
await page.locator('button[title^="Zoom to fit"]').first().click();
await page.waitForTimeout(700);

/* ---- upload the REAL sheet through the real file input (NEW-3: "a throwaway upload of a real
 * full-size sheet") --------------------------------------------------------------------------- */
await page.locator('[data-testid="left-menu-panel"] input[type="file"][accept="application/pdf,image/*,.dxf,.dwg"]').setInputFiles(FIXTURE);
const ov = await page.waitForFunction(() => {
  const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const o = raw.C1 && raw.C1.sheetOverlays.find((x) => /l-shaped-plan/.test(x.name || ""));
  return o && o.imgW ? { id: o.id, name: o.name, imgW: o.imgW, imgH: o.imgH } : null;
}, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
check("[precondition] the real L-shaped sheet was placed through the real file input", !!(ov && ov.imgW === IMG_W && ov.imgH === IMG_H), JSON.stringify(ov));
if (!ov) { console.log("  ⛔ VOID — cannot continue without the fixture placed."); await browser.close(); process.exit(2); }
await page.locator('button[title^="Zoom to fit"]').first().click(); // frame the just-placed sheet
await page.waitForTimeout(700);

const storedCrop = () => page.evaluate((id) => {
  const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const o = raw.C1.sheetOverlays.find((x) => x.id === id);
  return o ? o.crop || null : null;
}, ov.id);

/* ---- 11. KNOWN-GOOD ARM ---------------------------------------------------------------------- */
{
  const pixelAt = async (x, y) => { const buf = await page.screenshot({ clip: { x: x - 1, y: y - 1, width: 3, height: 3 } });
    return page.evaluate(async (b64) => { const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
      const c = document.createElement("canvas"); c.width = 3; c.height = 3; const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      return Array.from(g.getImageData(1, 1, 1, 1).data.slice(0, 3)); }, buf.toString("base64")); };
  const client = await page.evaluate((id) => {
    const img = document.querySelector(`image[data-overlay-id="${id}"]`);
    const svg = img.ownerSVGElement;
    const x = +img.getAttribute("x") + 0.3 * +img.getAttribute("width"), y = +img.getAttribute("y") + 0.15 * +img.getAttribute("height");
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    const q = p.matrixTransform(img.getScreenCTM());
    return { x: q.x, y: q.y };
  }, ov.id);
  const px = await pixelAt(Math.round(client.x), Math.round(client.y));
  const isGray = Math.abs(px[0] - 188) < 25 && Math.abs(px[1] - 200) < 25 && Math.abs(px[2] - 212) < 25;
  check("[known-good arm] uncropped: a point inside the L reads the fixture's fill colour", isGray, JSON.stringify(px));
  if (!isGray) { console.log("  ⛔ VOID — the probe cannot see a known answer; no score reported."); await browser.close(); process.exit(2); }
}

if (!(await page.locator(`[data-testid="overlay-crop-${ov.id}"]`).count())) await page.locator("button", { hasText: ov.name }).first().click();
await page.waitForTimeout(400);
await page.locator(`[data-testid="overlay-crop-${ov.id}"] [data-testid="overlay-crop-open"]`).click();
await page.waitForTimeout(500);
const d = page.locator('[data-testid="overlay-crop-dialog"]');
check("Crop… opens the tool on the real sheet", (await d.count()) === 1);

/* ---- 8. the dialog uses a big share of the desktop viewport, not a small fixed box ------------- */
{
  const viewportBox = await d.locator("img").first().evaluate((img) => {
    const vp = img.parentElement.parentElement; // the fixed-size viewport box (NEW-2)
    const r = vp.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check("crop viewport is a real working size on a normal desktop window (not a ~small fixed box)",
    viewportBox.w >= 700 && viewportBox.h >= 500, JSON.stringify(viewportBox));
}

await d.locator("button", { hasText: "Polygon" }).click();
await d.locator("button", { hasText: "Clear polygon" }).click();
await page.waitForTimeout(150);

/* ---- helpers ------------------------------------------------------------------------------------ */
const doFit = async () => { await d.locator('[data-testid="crop-zoom-fit"]').click(); await page.waitForTimeout(150); };
const imgBox = async () => d.locator("img").first().boundingBox();
const zoomPct = () => d.locator('[data-testid="crop-zoom-pct"]').textContent();
// Live measurement — works at ANY pan/zoom, because it reads the image's OWN current on-screen box.
const imgPosOfTestid = async (testid) => {
  const ib = await imgBox();
  const vb = await d.locator(testid).boundingBox();
  const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
  return [(cx - ib.x) / ib.width * IMG_W, (cy - ib.y) / ib.height * IMG_H];
};
const vertexCount = () => d.locator('[data-testid^="crop-poly-vertex-"]').count();

await doFit();
let box = await imgBox();
const at = (fx, fy, b = box) => ({ x: b.x + fx * b.width, y: b.y + fy * b.height });

/* ---- 1. trace the real L-shape, zooming in about the pointer for two of the six vertices ------ */
for (let i = 0; i < VERTS_FRAC.length; i++) {
  const zoomThis = i === 0 || i === 2; // two of six, per NEW-3's own instruction
  // ALWAYS start each placement from a fresh Fit + freshly-measured box — a stale box captured
  // before a PRIOR vertex's zoom-in would place this one at the wrong image point once the view
  // has changed scale.
  await doFit();
  box = await imgBox();
  const p = at(...VERTS_FRAC[i]);
  if (zoomThis) {
    await page.mouse.move(p.x, p.y);
    const before = await zoomPct();
    for (let n = 0; n < 6; n++) await page.mouse.wheel(0, -140); // zoom IN about this exact pointer position
    await page.waitForTimeout(150);
    const after = await zoomPct();
    check(`vertex ${i}: wheel-zoom about the pointer actually zoomed in (${before} → ${after})`, parseInt(after) >= parseInt(before) * 2);
    await page.mouse.click(p.x, p.y); // the SAME screen point — must still be this exact image vertex
  } else {
    await page.mouse.click(p.x, p.y);
  }
  await page.waitForTimeout(120);
}
// close on the first vertex — back to Fit so its screen position is known again
await doFit();
box = await imgBox();
{ const p = at(...VERTS_FRAC[0]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); }

check("[setup] the ring closed into 6 real vertex handles", (await vertexCount()) === 6, `count=${await vertexCount()}`);
{
  const measured = [];
  for (let i = 0; i < 6; i++) measured.push(await imgPosOfTestid(`[data-testid="crop-poly-vertex-${i}"]`));
  const allClose = measured.every((p, i) => Math.hypot(p[0] - VERTS_PX[i][0], p[1] - VERTS_PX[i][1]) < 10);
  check("all 6 real vertices landed within a few image-px of where they were traced (even the two zoomed-in ones)",
    allClose, JSON.stringify({ traced: VERTS_PX, measured }));
}
await page.screenshot({ path: OUT + "crop-poly-lshape-traced.png" });

/* ---- 5. kept vs. dropped was visible WHILE drawing, not only after close ----------------------- */
{
  await d.locator("button", { hasText: "Clear polygon" }).click();
  await page.waitForTimeout(150);
  box = await imgBox();
  for (const [fx, fy] of VERTS_FRAC.slice(0, 4)) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); }
  await page.screenshot({ path: OUT + "crop-poly-lshape-midtrace-preview.png" });
  check("mid-draw (4 of 6 points placed, not yet closed) — the scrim mask already shows a live kept/dropped preview",
    (await d.locator("svg mask polygon").count()) === 1);
  // finish the trace again for the rest of the walkthrough
  for (const [fx, fy] of VERTS_FRAC.slice(4)) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); }
  { const p = at(...VERTS_FRAC[0]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); }
  check("[setup] re-closed into 6 vertices", (await vertexCount()) === 6);
}

/* ---- 2. insert a vertex on an edge (press+drag in one gesture), then select + delete it -------- */
{
  const edge0 = d.locator('[data-testid="crop-poly-edge-0"]');
  const eb = await edge0.boundingBox();
  const mx = eb.x + eb.width / 2, my = eb.y + eb.height / 2;
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx, my - 35, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  check("clicking an edge inserts a real 7th vertex (was 4-corners-only before this fix)", (await vertexCount()) === 7, `count=${await vertexCount()}`);
  const inserted = await imgPosOfTestid('[data-testid="crop-poly-vertex-1"]');
  check("the inserted vertex lands well above the edge it was inserted on (dragged into place, not stuck)",
    inserted[1] < VERTS_PX[0][1] - 20, JSON.stringify(inserted));
  await page.screenshot({ path: OUT + "crop-poly-edge-insert.png" });

  // it's already selected right out of the insert gesture — delete it via keyboard
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
  check("selecting the new vertex and pressing Delete removes exactly it (back to the traced 6)", (await vertexCount()) === 6, `count=${await vertexCount()}`);
  const v1 = await imgPosOfTestid('[data-testid="crop-poly-vertex-1"]');
  check("…and vertex 1 is back to its original traced corner", Math.hypot(v1[0] - VERTS_PX[1][0], v1[1] - VERTS_PX[1][1]) < 10, JSON.stringify(v1));
}

/* ---- 4a. the tool's own Ctrl+Z steps back an insert ---------------------------------------------- */
{
  const edge0 = d.locator('[data-testid="crop-poly-edge-0"]');
  const eb = await edge0.boundingBox();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  check("[setup] insert happened (7 vertices)", (await vertexCount()) === 7);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  check("Ctrl+Z inside the crop editor steps back the insert (7 → 6)", (await vertexCount()) === 6, `count=${await vertexCount()}`);
  const v1 = await imgPosOfTestid('[data-testid="crop-poly-vertex-1"]');
  check("…the surviving vertex 1 is the original corner, not a renumbered leftover",
    Math.hypot(v1[0] - VERTS_PX[1][0], v1[1] - VERTS_PX[1][1]) < 10, JSON.stringify(v1));
}

/* ---- 3 & 4b. Shift-constrains a vertex drag to vertical, and Ctrl+Z steps that back too --------- */
{
  const pre = await imgPosOfTestid('[data-testid="crop-poly-vertex-0"]');
  const vb = await d.locator('[data-testid="crop-poly-vertex-0"]').boundingBox();
  const startX = vb.x + vb.width / 2, startY = vb.y + vb.height / 2;
  await page.keyboard.down("Shift");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 4, startY - 70, { steps: 8 }); // a few px of drift off-vertical — must snap
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(150);
  const dragged = await imgPosOfTestid('[data-testid="crop-poly-vertex-0"]');
  check("Shift-constrained drag snaps the edge to vertical (x barely moves despite the horizontal drift)",
    Math.abs(dragged[0] - pre[0]) < 3 && dragged[1] < pre[1] - 15, JSON.stringify({ before: pre, after: dragged }));
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  const undone = await imgPosOfTestid('[data-testid="crop-poly-vertex-0"]');
  check("Ctrl+Z steps back the constrained drag too", Math.hypot(undone[0] - pre[0], undone[1] - pre[1]) < 3, JSON.stringify({ before: pre, after: undone }));
}

/* ---- 4c. Ctrl+Z steps back a delete -------------------------------------------------------------- */
{
  const pre = await imgPosOfTestid('[data-testid="crop-poly-vertex-1"]');
  await d.locator('[data-testid="crop-poly-vertex-1"]').click({ force: true });
  await page.waitForTimeout(100);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(150);
  check("[setup] delete happened (6 → 5 vertices)", (await vertexCount()) === 5, `count=${await vertexCount()}`);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  check("Ctrl+Z steps back the delete (5 → 6 vertices)", (await vertexCount()) === 6, `count=${await vertexCount()}`);
  const undone = await imgPosOfTestid('[data-testid="crop-poly-vertex-1"]');
  check("…restored to the exact original vertex", Math.hypot(undone[0] - pre[0], undone[1] - pre[1]) < 10, JSON.stringify({ before: pre, after: undone }));
}

/* ---- 4d. Ctrl+Z steps back a placement made while still drawing (open ring) ---------------------- */
{
  await d.locator("button", { hasText: "Clear polygon" }).click();
  await page.waitForTimeout(150);
  box = await imgBox();
  for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100); }
  check("[setup] three points placed while drawing (open ring)", (await d.locator("svg polyline").count()) === 1 && (await d.locator("svg circle").count()) === 3);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  check("Ctrl+Z while still drawing steps back the last PLACEMENT, not just closed-mode edits", (await d.locator("svg circle").count()) === 2);
  // re-trace the real L-shape once more so later steps (pan/zoom, rect<->poly, reset) work on it —
  // clear the two leftover open points first, or the retrace lands on top of them
  await d.locator("button", { hasText: "Clear polygon" }).click();
  await page.waitForTimeout(150);
  box = await imgBox();
  for (const [fx, fy] of VERTS_FRAC) { const p = at(...[fx, fy]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); }
  { const p = at(...VERTS_FRAC[0]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); }
  check("[setup] re-closed into 6 vertices for the rest of the walkthrough", (await vertexCount()) === 6);
}

/* ---- 7. pan/zoom never moves a vertex relative to the IMAGE, only relative to the SCREEN --------- */
{
  const beforeFrac = await imgPosOfTestid('[data-testid="crop-poly-vertex-0"]');
  const beforeScreen = await d.locator('[data-testid="crop-poly-vertex-0"]').boundingBox();

  await page.mouse.move(600, 400);
  for (let n = 0; n < 4; n++) await page.mouse.wheel(0, -100);
  await page.waitForTimeout(150);
  await page.keyboard.down("Space");
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(300, 460, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(150);
  await page.mouse.move(350, 300);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);

  const afterScreen = await d.locator('[data-testid="crop-poly-vertex-0"]').boundingBox().catch(() => null);
  if (afterScreen) {
    const afterFrac = await imgPosOfTestid('[data-testid="crop-poly-vertex-0"]');
    check("panning + zooming leaves the vertex's position relative to the IMAGE unchanged",
      Math.hypot(afterFrac[0] - beforeFrac[0], afterFrac[1] - beforeFrac[1]) < 6, JSON.stringify({ before: beforeFrac, after: afterFrac }));
    const movedOnScreen = Math.hypot(afterScreen.x - beforeScreen.x, afterScreen.y - beforeScreen.y) > 15;
    check("…while the SAME vertex's on-screen position visibly moved (the view moved, not the shape)", movedOnScreen,
      JSON.stringify({ before: beforeScreen, after: afterScreen }));
  } else {
    check("vertex 0 stayed reachable after the pan/zoom sequence (still in the DOM)", false);
  }
  await page.screenshot({ path: OUT + "crop-poly-after-pan-zoom.png" });
  await doFit();
}

/* ---- 6. Fit / 100% controls -------------------------------------------------------------------- */
{
  await page.locator('[data-testid="crop-zoom-100"]').click();
  await page.waitForTimeout(150);
  check("100% control sets the zoom readout to exactly 100%", (await zoomPct()).trim() === "100%", await zoomPct());
  await doFit();
  const pct = await zoomPct();
  check("Fit control returns a sane, non-zero zoom level", parseInt(pct) > 0 && parseInt(pct) <= 100, pct);
}

/* ---- commit and confirm the L-shape survives to storage ----------------------------------------- */
await d.locator("button", { hasText: "Done" }).click();
await page.waitForTimeout(400);
const committed = await storedCrop();
check("Done commits the real 6-vertex L-shape (kind:'poly', 6 vertices, close to the real trace)",
  !!(committed && committed.kind === "poly" && committed.pts.length === 6 &&
     committed.pts.every((p, i) => Math.hypot(p[0] - VERTS_PX[i][0], p[1] - VERTS_PX[i][1]) < 10)),
  JSON.stringify(committed));

/* ---- convert to rectangle and back — neither shape destroyed ------------------------------------ */
await page.locator(`[data-testid="overlay-crop-${ov.id}"] [data-testid="overlay-crop-open"]`).click();
await page.waitForTimeout(500);
await d.locator("button", { hasText: "Rectangle" }).click();
await d.locator("button", { hasText: "Polygon" }).click();
await page.waitForTimeout(150);
check("Rectangle -> Polygon in the same session recovers the exact 6-vertex trace (not the rect's 4 corners)", (await vertexCount()) === 6, `circles=${await vertexCount()}`);
await d.locator("button", { hasText: "Done" }).click();
await page.waitForTimeout(300);
const afterRoundTrip = await storedCrop();
check("the poly crop survives a Rectangle<->Polygon round trip unchanged", !!(afterRoundTrip && afterRoundTrip.kind === "poly" && afterRoundTrip.pts.length === 6));

/* ---- reset to the full sheet --------------------------------------------------------------------- */
await page.locator(`[data-testid="overlay-crop-${ov.id}"] [data-testid="overlay-crop-reset"]`).click();
await page.waitForTimeout(300);
const afterReset = await storedCrop();
check("Reset returns the full, uncropped sheet", afterReset === null);

/* ---- 8b. the dialog stays fully reachable on a short/narrow viewport (a laptop, not a monitor) --- */
{
  const shortCtx = await browser.newContext({ viewport: { width: 1024, height: 660 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await shortCtx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded2')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ C1: site }))});sessionStorage.setItem('seeded2','1');}}catch(e){}})();`);
  const p2 = await shortCtx.newPage();
  await p2.goto(BASE, { waitUntil: "load" });
  await p2.waitForTimeout(1500);
  if (!(await p2.locator("text=Overlays").count())) {
    await p2.locator('[data-testid="module-tab-site-planner"]').first().click();
    await p2.waitForTimeout(1200);
    await p2.locator("text=CropPolyT").first().dblclick();
    await p2.waitForTimeout(2200);
  }
  await p2.locator("text=Overlays").first().click();
  await p2.waitForTimeout(500);
  await p2.locator('[data-testid="left-menu-panel"] input[type="file"][accept="application/pdf,image/*,.dxf,.dwg"]').setInputFiles(FIXTURE);
  const ov2 = await p2.waitForFunction(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const o = raw.C1 && raw.C1.sheetOverlays.find((x) => /l-shaped-plan/.test(x.name || ""));
    return o && o.imgW ? { id: o.id, name: o.name } : null;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
  if (ov2) {
    if (!(await p2.locator(`[data-testid="overlay-crop-${ov2.id}"]`).count())) await p2.locator("button", { hasText: ov2.name }).first().click();
    await p2.waitForTimeout(400);
    await p2.locator(`[data-testid="overlay-crop-${ov2.id}"] [data-testid="overlay-crop-open"]`).click();
    await p2.waitForTimeout(500);
    const d2 = p2.locator('[data-testid="overlay-crop-dialog"]');
    const doneBtn = d2.locator("button", { hasText: "Done" });
    const db = await doneBtn.boundingBox().catch(() => null);
    check("on a short/narrow viewport (1024×660) the Done button is still on-screen and reachable",
      !!(db && db.y >= 0 && db.y + db.height <= 660 && db.x >= 0 && db.x + db.width <= 1024), JSON.stringify(db));
    await p2.screenshot({ path: OUT + "crop-poly-short-viewport.png" });
  } else {
    check("[precondition] short-viewport scenario got a placed overlay", false);
  }
  await shortCtx.close();
}

check("no uncaught page errors", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ all checks passed");
process.exit(fail ? 1 : 0);
